import { TranscriptServiceError } from "./errors";

export type PlaylistVideo = {
  videoId: string;
  title: string;
  lengthSeconds: number;
  position: number;
};

export type PlaylistResult = {
  playlistId: string;
  title: string;
  count: number;
  truncated: boolean;
  videos: PlaylistVideo[];
};

type JsonRecord = Record<string, unknown>;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_PLAYLIST_VIDEOS = 500;
const MAX_CONTINUATION_PAGES = 12;
const REQUEST_TIMEOUT_MS = 15000;

function walk(node: unknown, visit: (record: JsonRecord) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visit);
    }

    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  const record = node as JsonRecord;
  visit(record);

  for (const value of Object.values(record)) {
    walk(value, visit);
  }
}

function readText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as JsonRecord;

  if (typeof record.simpleText === "string") {
    return record.simpleText.trim();
  }

  if (Array.isArray(record.runs)) {
    return record.runs
      .map((run) => (typeof (run as JsonRecord)?.text === "string" ? ((run as JsonRecord).text as string) : ""))
      .join("")
      .trim();
  }

  return "";
}

function readDurationBadge(value: unknown): number {
  if (!value || typeof value !== "object") {
    return 0;
  }

  const container = value as JsonRecord;
  const thumbnail = (container.thumbnailViewModel as JsonRecord | undefined) ?? container;
  const badges = (thumbnail.overlays as JsonRecord[] | undefined)
    ?.map((overlay) => (overlay.thumbnailBottomOverlayViewModel as JsonRecord | undefined)?.badges)
    .filter((value): value is JsonRecord[] => Array.isArray(value))
    .flat();

  if (!badges) {
    return 0;
  }

  for (const badge of badges) {
    const badgeView = badge.thumbnailBadgeViewModel as JsonRecord | undefined;
    const text = typeof badgeView?.text === "string" ? badgeView.text : "";

    if (/^\d{1,2}(:\d{2}){1,2}$/.test(text)) {
      const seconds = text
        .split(":")
        .map(Number)
        .reduce((total, part) => total * 60 + part, 0);

      return Number.isFinite(seconds) ? seconds : 0;
    }
  }

  return 0;
}

function readContinuationToken(node: JsonRecord): string | null {
  const candidates = [node.continuationItemRenderer, node.continuationItemViewModel];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const renderer = candidate as JsonRecord;
    const endpoint = renderer.continuationEndpoint as JsonRecord | undefined;
    const endpointCommand = endpoint?.continuationCommand as JsonRecord | undefined;

    if (typeof endpointCommand?.token === "string") {
      return endpointCommand.token;
    }

    const command = renderer.continuationCommand as JsonRecord | undefined;
    const inner = command?.innertubeCommand as JsonRecord | undefined;
    const innerCommand = inner?.continuationCommand as JsonRecord | undefined;

    if (typeof innerCommand?.token === "string") {
      return innerCommand.token;
    }

    const button = renderer.button as JsonRecord | undefined;
    const buttonData = button?.buttonData as JsonRecord | undefined;
    const buttonCommand = buttonData?.command as JsonRecord | undefined;

    if (typeof buttonCommand?.token === "string") {
      return buttonCommand.token;
    }
  }

  return null;
}

function readPlaylistTitle(payload: unknown): string {
  let title = "";

  walk(payload, (record) => {
    if (title) {
      return;
    }

    const header = record.playlistHeaderRenderer as JsonRecord | undefined;
    const metadata = record.playlistMetadataRenderer as JsonRecord | undefined;
    const pageHeader = record.pageHeaderViewModel as JsonRecord | undefined;
    const pageHeaderTitle = pageHeader?.title as JsonRecord | undefined;
    const dynamicText = pageHeaderTitle?.dynamicTextViewModel as JsonRecord | undefined;

    title =
      readText(header?.title) ||
      readText(metadata?.title) ||
      (typeof dynamicText?.text === "string" ? dynamicText.text.trim() : "");
  });

  return title;
}

function readLockupTitle(lockup: JsonRecord | undefined): string {
  if (!lockup) {
    return "";
  }

  const title = lockup.title as JsonRecord | undefined;

  return typeof title?.content === "string" ? title.content.trim() : "";
}

function readLockupVideo(lockup: JsonRecord): { videoId: string; title: string; lengthSeconds: number } | null {
  const contentId = lockup.contentId;

  if (typeof contentId !== "string" || !/^[\w-]{11}$/.test(contentId)) {
    return null;
  }

  const contentType = lockup.contentType;

  if (typeof contentType === "string" && !contentType.toUpperCase().includes("VIDEO")) {
    return null;
  }

  const metadata = lockup.metadata as JsonRecord | undefined;

  return {
    videoId: contentId,
    title: readLockupTitle(metadata?.lockupMetadataViewModel as JsonRecord | undefined) || "Unknown video",
    lengthSeconds: readDurationBadge(lockup.contentImage),
  };
}

export function collectPlaylistVideos(
  payload: unknown,
  startIndex = 0,
): { videos: PlaylistVideo[]; nextToken: string | null } {
  const videos: PlaylistVideo[] = [];
  const seen = new Set<string>();
  let nextToken: string | null = null;

  walk(payload, (record) => {
    const token = readContinuationToken(record);

    if (token && !nextToken) {
      nextToken = token;
    }

    const legacy = record.playlistVideoRenderer as JsonRecord | undefined;
    const lockup = record.lockupViewModel as JsonRecord | undefined;
    const candidate = legacy
      ? {
          videoId: typeof legacy.videoId === "string" ? legacy.videoId : null,
          title: readText(legacy.title) || "Unknown video",
          lengthSeconds: typeof legacy.lengthSeconds === "number" ? legacy.lengthSeconds : 0,
        }
      : lockup
        ? readLockupVideo(lockup)
        : null;

    if (!candidate?.videoId || seen.has(candidate.videoId)) {
      return;
    }

    if (legacy && legacy.isPlayable === false) {
      return;
    }

    seen.add(candidate.videoId);
    videos.push({
      videoId: candidate.videoId,
      title: candidate.title,
      lengthSeconds: candidate.lengthSeconds,
      position: startIndex + videos.length + 1,
    });
  });

  return { videos, nextToken };
}

export function extractJsonAssignment(html: string, variableName: string): unknown {
  const marker = html.indexOf(variableName);

  if (marker < 0) {
    throw new TranscriptServiceError(
      "PLAYLIST_UNAVAILABLE",
      "YouTube did not return playlist data for this link.",
      404,
    );
  }

  const start = html.indexOf("{", marker);

  if (start < 0) {
    throw new TranscriptServiceError("PLAYLIST_UNAVAILABLE", "The playlist data could not be read.", 404);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const character = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1)) as unknown;
        } catch {
          throw new TranscriptServiceError("PLAYLIST_UNAVAILABLE", "The playlist data could not be parsed.", 502);
        }
      }
    }
  }

  throw new TranscriptServiceError("PLAYLIST_UNAVAILABLE", "The playlist data was incomplete.", 502);
}

function readInnertubeConfig(html: string): { apiKey: string; clientVersion: string; visitorData?: string } | null {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? "";
  const visitorData = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1];

  if (!apiKey) {
    return null;
  }

  return { apiKey, clientVersion, visitorData };
}

function createSignal(parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

export async function fetchPlaylist(
  playlistId: string,
  parentSignal?: AbortSignal,
): Promise<PlaylistResult> {
  const request = createSignal(parentSignal);
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: request.signal,
    });

    if (!response.ok) {
      throw new TranscriptServiceError(
        response.status === 404 ? "PLAYLIST_UNAVAILABLE" : "UPSTREAM_UNAVAILABLE",
        response.status === 404
          ? "This playlist is unavailable or private."
          : "YouTube could not be reached right now.",
        response.status === 404 ? 404 : 502,
      );
    }

    const html = await response.text();
    const initialData = extractJsonAssignment(html, "ytInitialData");
    const config = readInnertubeConfig(html);
    const firstPage = collectPlaylistVideos(initialData);
    const videos = [...firstPage.videos];
    const seen = new Set(videos.map((video) => video.videoId));
    let token = firstPage.nextToken;
    let pages = 0;

    while (token && config && pages < MAX_CONTINUATION_PAGES && videos.length < MAX_PLAYLIST_VIDEOS) {
      pages += 1;

      const continuationResponse = await fetch(
        `https://www.youtube.com/youtubei/v1/browse?key=${config.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "WEB",
                clientVersion: config.clientVersion,
                hl: "en",
                visitorData: config.visitorData,
              },
            },
            continuation: token,
          }),
          signal: request.signal,
        },
      );

      if (!continuationResponse.ok) {
        break;
      }

      const page = (await continuationResponse.json()) as unknown;
      const next = collectPlaylistVideos(page, videos.length);

      for (const video of next.videos) {
        if (seen.has(video.videoId)) {
          continue;
        }

        seen.add(video.videoId);
        videos.push(video);
      }

      token = next.nextToken;
    }

    const hasMore = Boolean(token) || videos.length >= MAX_PLAYLIST_VIDEOS;

    return {
      playlistId,
      title: readPlaylistTitle(initialData) || `Playlist ${playlistId}`,
      count: videos.length,
      truncated: hasMore,
      videos: videos.slice(0, MAX_PLAYLIST_VIDEOS),
    };
  } catch (error) {
    if (error instanceof TranscriptServiceError) {
      throw error;
    }

    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new TranscriptServiceError("TIMEOUT", "YouTube took too long to load this playlist.", 504);
    }

    throw new TranscriptServiceError("PLAYLIST_UNAVAILABLE", "The playlist could not be loaded.", 502);
  } finally {
    request.cleanup();
  }
}
