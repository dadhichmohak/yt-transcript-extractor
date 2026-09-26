import { describe, expect, it } from "vitest";

import { collectPlaylistVideos, extractJsonAssignment } from "@/lib/playlist";
import { TranscriptServiceError } from "@/lib/errors";

const SAMPLE = {
  header: {
    playlistHeaderRenderer: { title: { simpleText: "Fuels and fuel cells" }, ownerText: { simpleText: "NPTEL" } },
  },
  contents: [
    {
      richItemRenderer: {
        content: {
          playlistVideoRenderer: {
            videoId: "aaaaaaaaaaa",
            title: { runs: [{ text: "Lecture 1" }] },
            lengthSeconds: 1800,
          },
        },
      },
    },
    {
      richItemRenderer: {
        content: {
          playlistVideoRenderer: {
            videoId: "bbbbbbbbbbb",
            title: { runs: [{ text: "Lecture 2" }] },
            lengthSeconds: 1900,
            isPlayable: false,
          },
        },
      },
    },
    {
      richItemRenderer: {
        content: {
          playlistVideoRenderer: {
            videoId: "ccccccccccc",
            title: { simpleText: "Lecture 3" },
            lengthSeconds: 2000,
          },
        },
      },
    },
    {
      continuationItemRenderer: {
        continuationEndpoint: { continuationCommand: { token: "TOKEN_1" } },
      },
    },
  ],
};

describe("extractJsonAssignment", () => {
  it("extracts a balanced JSON object after a marker", () => {
    const html = `<script>var ytInitialData = ${JSON.stringify({ a: { b: "}" } })};</script>`;

    expect(extractJsonAssignment(html, "ytInitialData")).toEqual({ a: { b: "}" } });
  });

  it("handles escaped quotes inside strings", () => {
    const html = `x = ${JSON.stringify({ text: 'say "hi"' })};`;

    expect(extractJsonAssignment(html, "x")).toEqual({ text: 'say "hi"' });
  });

  it("throws when the marker is missing", () => {
    expect(() => extractJsonAssignment("<html></html>", "ytInitialData")).toThrow(TranscriptServiceError);
  });

  it("throws when the object is unterminated", () => {
    expect(() => extractJsonAssignment('ytInitialData = {"a":1', "ytInitialData")).toThrow(TranscriptServiceError);
  });
});

describe("collectPlaylistVideos", () => {
  it("collects playable videos with titles and positions", () => {
    const { videos } = collectPlaylistVideos(SAMPLE);

    expect(videos).toHaveLength(2);
    expect(videos[0]).toEqual({
      videoId: "aaaaaaaaaaa",
      title: "Lecture 1",
      lengthSeconds: 1800,
      position: 1,
    });
    expect(videos[1].videoId).toBe("ccccccccccc");
    expect(videos[1].position).toBe(2);
  });

  it("skips unplayable entries", () => {
    const { videos } = collectPlaylistVideos(SAMPLE);

    expect(videos.some((video) => video.videoId === "bbbbbbbbbbb")).toBe(false);
  });

  it("finds the continuation token", () => {
    expect(collectPlaylistVideos(SAMPLE).nextToken).toBe("TOKEN_1");
  });

  it("deduplicates repeated video ids", () => {
    const duplicated = {
      contents: [SAMPLE.contents[0], SAMPLE.contents[0], SAMPLE.contents[2]],
    };

    expect(collectPlaylistVideos(duplicated).videos).toHaveLength(2);
  });

  it("continues numbering from a starting index", () => {
    expect(collectPlaylistVideos(SAMPLE, 10).videos[0].position).toBe(11);
  });

  it("falls back to a placeholder title", () => {
    const { videos } = collectPlaylistVideos({
      contents: [{ playlistVideoRenderer: { videoId: "ddddddddddd" } }],
    });

    expect(videos[0].title).toBe("Unknown video");
    expect(videos[0].lengthSeconds).toBe(0);
  });

  it("returns nothing for unrelated payloads", () => {
    expect(collectPlaylistVideos({ foo: "bar" })).toEqual({ videos: [], nextToken: null });
  });
});

const LOCKUP_SAMPLE = {
  header: {
    pageHeaderViewModel: {
      title: { dynamicTextViewModel: { text: "Stanford University CS231n, Spring 2017" } },
    },
  },
  items: [
    {
      lockupViewModel: {
        contentId: "vT1JzLTH4G4",
        contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
        contentImage: {
          thumbnailViewModel: {
            overlays: [
              {
                thumbnailBottomOverlayViewModel: {
                  badges: [{ thumbnailBadgeViewModel: { text: "57:57" } }],
                },
              },
            ],
          },
        },
        metadata: { lockupMetadataViewModel: { title: { content: "Lecture 1" } } },
      },
    },
    {
      lockupViewModel: {
        contentId: "OoUX-nOEjG0",
        contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
        contentImage: {
          thumbnailViewModel: {
            overlays: [
              {
                thumbnailBottomOverlayViewModel: {
                  badges: [{ thumbnailBadgeViewModel: { text: "59:32" } }],
                },
              },
            ],
          },
        },
        metadata: { lockupMetadataViewModel: { title: { content: "Lecture 2" } } },
      },
    },
    {
      lockupViewModel: {
        contentId: "notavideoidxx",
        contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
        metadata: { lockupMetadataViewModel: { title: { content: "A channel" } } },
      },
    },
  ],
  continuation: {
    continuationItemViewModel: {
      continuationCommand: {
        innertubeCommand: { continuationCommand: { token: "TOKEN_LOCKUP" } },
      },
    },
  },
};

describe("collectPlaylistVideos with lockupViewModel items", () => {
  it("reads the current YouTube item format", () => {
    const { videos } = collectPlaylistVideos(LOCKUP_SAMPLE);

    expect(videos).toHaveLength(2);
    expect(videos[0]).toEqual({
      videoId: "vT1JzLTH4G4",
      title: "Lecture 1",
      lengthSeconds: 3477,
      position: 1,
    });
    expect(videos[1].lengthSeconds).toBe(3572);
  });

  it("skips non-video lockups", () => {
    const ids = collectPlaylistVideos(LOCKUP_SAMPLE).videos.map((video) => video.videoId);

    expect(ids).not.toContain("notavideoidxx");
  });

  it("finds the nested continuation token", () => {
    expect(collectPlaylistVideos(LOCKUP_SAMPLE).nextToken).toBe("TOKEN_LOCKUP");
  });

  it("defaults a missing title", () => {
    const { videos } = collectPlaylistVideos({
      items: [{ lockupViewModel: { contentId: "aaaaaaaaaaa", contentType: "LOCKUP_CONTENT_TYPE_VIDEO" } }],
    });

    expect(videos[0].title).toBe("Unknown video");
    expect(videos[0].lengthSeconds).toBe(0);
  });

  it("ignores hour-long badges only when malformed", () => {
    const { videos } = collectPlaylistVideos({
      items: [
        {
          lockupViewModel: {
            contentId: "aaaaaaaaaaa",
            contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
            contentImage: {
              thumbnailViewModel: {
                overlays: [
                  { thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: "LIVE" } }] } },
                ],
              },
            },
          },
        },
      ],
    });

    expect(videos[0].lengthSeconds).toBe(0);
  });
});
