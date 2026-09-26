export type ParsedVideo = {
  videoId: string;
  canonicalUrl: string;
};

export type ParsedPlaylist = {
  playlistId: string;
  canonicalUrl: string;
};

export class VideoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoInputError";
  }
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const PATH_VIDEO_TYPES = new Set(["shorts", "embed", "live", "v"]);

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function assertVideoId(value: string | null | undefined): string {
  if (!value || !VIDEO_ID_PATTERN.test(value)) {
    throw new VideoInputError("Enter a valid YouTube video link or 11-character video ID.");
  }

  return value;
}

function idFromPathname(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const first = parts[0]?.toLowerCase();

  if (first && PATH_VIDEO_TYPES.has(first)) {
    return parts[1] ?? null;
  }

  return null;
}

export function parseYoutubeInput(input: string): ParsedVideo {
  const value = input.trim();

  if (!value) {
    throw new VideoInputError("Paste a YouTube video link first.");
  }

  if (VIDEO_ID_PATTERN.test(value)) {
    return {
      videoId: value,
      canonicalUrl: `https://www.youtube.com/watch?v=${value}`,
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new VideoInputError("That does not look like a YouTube link.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new VideoInputError("Use an http or https YouTube link.");
  }

  const host = normalizeHost(parsed.hostname);
  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (parsed.pathname === "/watch" || parsed.pathname === "/watch/") {
      videoId = parsed.searchParams.get("v");
    } else {
      videoId = idFromPathname(parsed.pathname);
    }
  } else {
    throw new VideoInputError("Only youtube.com and youtu.be links are supported.");
  }

  const validVideoId = assertVideoId(videoId);

  return {
    videoId: validVideoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${validVideoId}`,
  };
}

export function isValidYoutubeInput(input: string): boolean {
  try {
    parseYoutubeInput(input);
    return true;
  } catch {
    return false;
  }
}

function assertPlaylistId(value: string | null | undefined): string {
  if (!value || !PLAYLIST_ID_PATTERN.test(value)) {
    throw new VideoInputError("Enter a valid YouTube playlist link.");
  }

  return value;
}

function isYoutubeHost(host: string): boolean {
  return host === "youtu.be" || YOUTUBE_HOSTS.has(host);
}

export function parseYoutubeUrl(input: string): URL | null {
  const value = input.trim();

  if (!value || VIDEO_ID_PATTERN.test(value)) {
    return null;
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    return isYoutubeHost(normalizeHost(parsed.hostname)) ? parsed : null;
  } catch {
    return null;
  }
}

export function hasPlaylistMarker(input: string): boolean {
  const parsed = parseYoutubeUrl(input);
  return Boolean(parsed?.searchParams.get("list"));
}

export function parsePlaylistInput(input: string): ParsedPlaylist | null {
  const parsed = parseYoutubeUrl(input);

  if (!parsed) {
    return null;
  }

  const listId = parsed.searchParams.get("list") || (parsed.pathname === "/playlist" ? "" : null);

  if (listId === null) {
    return null;
  }

  const playlistId = assertPlaylistId(listId || undefined);

  return {
    playlistId,
    canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
  };
}
