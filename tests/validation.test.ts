import { describe, expect, it } from "vitest";

import {
  hasPlaylistMarker,
  isValidYoutubeInput,
  parsePlaylistInput,
  parseYoutubeInput,
  VideoInputError,
} from "@/lib/validation";

describe("parseYoutubeInput", () => {
  it("parses a standard watch URL", () => {
    const result = parseYoutubeInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(result.videoId).toBe("dQw4w9WgXcQ");
    expect(result.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("parses short youtu.be URLs", () => {
    expect(parseYoutubeInput("https://youtu.be/dQw4w9WgXcQ?si=abc").videoId).toBe("dQw4w9WgXcQ");
  });

  it("parses shorts, embed, and live URLs", () => {
    expect(parseYoutubeInput("https://www.youtube.com/shorts/dQw4w9WgXcQ").videoId).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeInput("https://www.youtube.com/embed/dQw4w9WgXcQ").videoId).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeInput("https://www.youtube.com/live/dQw4w9WgXcQ").videoId).toBe("dQw4w9WgXcQ");
  });

  it("parses a bare video ID", () => {
    expect(parseYoutubeInput("  dQw4w9WgXcQ  ").videoId).toBe("dQw4w9WgXcQ");
  });

  it("rejects empty input", () => {
    expect(() => parseYoutubeInput("   ")).toThrow(VideoInputError);
  });

  it("rejects non-YouTube hosts", () => {
    expect(() => parseYoutubeInput("https://vimeo.com/12345")).toThrow(VideoInputError);
  });

  it("rejects unsupported protocols", () => {
    expect(() => parseYoutubeInput("ftp://youtube.com/watch?v=dQw4w9WgXcQ")).toThrow(VideoInputError);
  });

  it("rejects lookalike hosts", () => {
    expect(() => parseYoutubeInput("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toThrow(VideoInputError);
  });

  it("rejects watch URLs without a v parameter", () => {
    expect(() => parseYoutubeInput("https://www.youtube.com/watch?list=PL123")).toThrow(VideoInputError);
  });

  it("rejects malformed video IDs", () => {
    expect(() => parseYoutubeInput("https://youtu.be/short")).toThrow(VideoInputError);
  });
});

describe("isValidYoutubeInput", () => {
  it("returns true for valid input", () => {
    expect(isValidYoutubeInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("returns false for invalid input", () => {
    expect(isValidYoutubeInput("not a link")).toBe(false);
  });
});

describe("hasPlaylistMarker", () => {
  it("detects a list parameter", () => {
    expect(hasPlaylistMarker("https://www.youtube.com/playlist?list=PLabc123")).toBe(true);
    expect(hasPlaylistMarker("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123")).toBe(true);
  });

  it("ignores links without a list parameter", () => {
    expect(hasPlaylistMarker("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(hasPlaylistMarker("dQw4w9WgXcQ")).toBe(false);
  });
});

describe("parsePlaylistInput", () => {
  it("parses a playlist URL", () => {
    const result = parsePlaylistInput("https://www.youtube.com/playlist?list=PLabc123");

    expect(result?.playlistId).toBe("PLabc123");
    expect(result?.canonicalUrl).toBe("https://www.youtube.com/playlist?list=PLabc123");
  });

  it("parses a watch URL that carries a list parameter", () => {
    expect(parsePlaylistInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123")?.playlistId).toBe(
      "PLabc123",
    );
  });

  it("parses youtu.be links with a list parameter", () => {
    expect(parsePlaylistInput("https://youtu.be/dQw4w9WgXcQ?list=PLabc123")?.playlistId).toBe("PLabc123");
  });

  it("returns null when no playlist is present", () => {
    expect(parsePlaylistInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parsePlaylistInput("dQw4w9WgXcQ")).toBeNull();
    expect(parsePlaylistInput("https://example.com/playlist?list=PLabc123")).toBeNull();
  });

  it("rejects an empty list parameter", () => {
    expect(() => parsePlaylistInput("https://www.youtube.com/playlist?list=")).toThrow(VideoInputError);
  });

  it("rejects an invalid list value", () => {
    expect(() => parsePlaylistInput("https://www.youtube.com/playlist?list=" + "x".repeat(80))).toThrow(
      VideoInputError,
    );
  });
});
