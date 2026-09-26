import {
  fetchTranscript,
  InMemoryCache,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  type TranscriptSegment,
} from "youtube-transcript-plus";

import { transcribeLocally } from "./local-asr";
import { TranscriptServiceError } from "./errors";

export { TranscriptServiceError } from "./errors";
export type { TranscriptErrorCode } from "./errors";

export type TranscriptSource = "captions" | "asr";

export type TranscriptPayload = {
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number;
  thumbnail: string | null;
  language: string;
  text: string;
  segmentCount: number;
  source: TranscriptSource;
  fetchedAt: string;
};

type TextSegment = Pick<TranscriptSegment, "text" | "offset" | "duration">;

const CACHE_TTL_MS = 10 * 60 * 1000;
const transcriptCache = new InMemoryCache(CACHE_TTL_MS);
const MAX_TRANSCRIPT_LENGTH = 2_000_000;
const OVERLAP_TOLERANCE_SECONDS = 0.05;

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function cleanSegmentText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function overlapsPrevious(segment: TextSegment, previous: TextSegment | null): boolean {
  if (!previous) {
    return false;
  }

  const previousEnd = previous.offset + previous.duration;

  return segment.offset < previousEnd - OVERLAP_TOLERANCE_SECONDS;
}

export function cleanTranscriptText(segments: TextSegment[]): string {
  const parts: string[] = [];
  let previous: TextSegment | null = null;
  let previousText = "";

  for (const segment of segments) {
    const text = cleanSegmentText(segment.text);

    if (!text) {
      continue;
    }

    if (overlapsPrevious(segment, previous)) {
      if (text === previousText) {
        continue;
      }

      if (text.startsWith(previousText)) {
        parts[parts.length - 1] = text;
        previousText = text;
        previous = segment;
        continue;
      }

      if (previousText.endsWith(text)) {
        continue;
      }
    }

    parts.push(text);
    previousText = text;
    previous = segment;
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function selectThumbnail(thumbnails: { url: string }[]): string | null {
  return thumbnails.at(-1)?.url ?? null;
}

function getTimeoutMs(): number {
  const configured = Number.parseInt(process.env.TRANSCRIPT_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= 5000 && configured <= 120000
    ? configured
    : 20000;
}

function createRequestSignal(parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
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

function mapProviderError(error: unknown): TranscriptServiceError {
  if (error instanceof YoutubeTranscriptTooManyRequestError) {
    return new TranscriptServiceError(
      "RATE_LIMITED",
      "YouTube is temporarily rate-limiting transcript requests. Please try again in a few minutes.",
      429,
    );
  }

  if (error instanceof YoutubeTranscriptDisabledError) {
    return new TranscriptServiceError(
      "CAPTIONS_DISABLED",
      "This video does not have captions available.",
      404,
    );
  }

  if (error instanceof YoutubeTranscriptNotAvailableError) {
    return new TranscriptServiceError(
      "CAPTIONS_UNAVAILABLE",
      "No readable transcript is available for this video.",
      404,
    );
  }

  if (error instanceof YoutubeTranscriptVideoUnavailableError) {
    return new TranscriptServiceError(
      "VIDEO_UNAVAILABLE",
      "This video is unavailable, private, or restricted.",
      404,
    );
  }

  if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return new TranscriptServiceError(
      "CAPTIONS_UNAVAILABLE",
      "No transcript is available in the selected language.",
      404,
    );
  }

  if (error instanceof YoutubeTranscriptInvalidVideoIdError) {
    return new TranscriptServiceError("INVALID_VIDEO", "The YouTube video ID is invalid.", 400);
  }

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new TranscriptServiceError(
      "TIMEOUT",
      "YouTube took too long to respond. Please try again.",
      504,
    );
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("429") || message.includes("too many requests")) {
    return new TranscriptServiceError(
      "RATE_LIMITED",
      "YouTube is temporarily rate-limiting transcript requests. Please try again in a few minutes.",
      429,
    );
  }

  if (message.includes("fetch failed") || message.includes("enotfound") || message.includes("network")) {
    return new TranscriptServiceError(
      "UPSTREAM_UNAVAILABLE",
      "The transcript service could not reach YouTube right now.",
      502,
    );
  }

  return new TranscriptServiceError(
    "TRANSCRIPT_FAILED",
    "The transcript could not be fetched right now. Please try again.",
    502,
  );
}

function canTryLocalAsr(error: TranscriptServiceError): boolean {
  return error.code === "CAPTIONS_DISABLED" || error.code === "CAPTIONS_UNAVAILABLE";
}

async function fetchCaptionTranscript(
  videoId: string,
  parentSignal?: AbortSignal,
): Promise<TranscriptPayload> {
  const result = await fetchTranscript(videoId, {
    videoDetails: true,
    retries: 1,
    retryDelay: 500,
    cache: transcriptCache,
    signal: parentSignal,
  });

  const segments = result.segments;
  const text = cleanTranscriptText(segments);

  if (!text) {
    throw new TranscriptServiceError(
      "CAPTIONS_UNAVAILABLE",
      "No readable transcript is available for this video.",
      404,
    );
  }

  if (text.length > MAX_TRANSCRIPT_LENGTH) {
    throw new TranscriptServiceError(
      "TRANSCRIPT_FAILED",
      "This transcript is too large to display at once.",
      413,
    );
  }

  const details = result.videoDetails;

  return {
    videoId: details.videoId || videoId,
    title: details.title || "YouTube video",
    channel: details.author || "Unknown channel",
    durationSeconds: details.lengthSeconds || 0,
    thumbnail: selectThumbnail(details.thumbnails),
    language: segments[0]?.lang || "unknown",
    text,
    segmentCount: segments.length,
    source: "captions",
    fetchedAt: new Date().toISOString(),
  };
}

export async function getTranscript(
  videoId: string,
  parentSignal?: AbortSignal,
): Promise<TranscriptPayload> {
  const request = createRequestSignal(parentSignal);

  try {
    return await fetchCaptionTranscript(videoId, request.signal);
  } catch (error) {
    const mapped = error instanceof TranscriptServiceError ? error : mapProviderError(error);

    if (canTryLocalAsr(mapped) && process.env.LOCAL_ASR_ENABLED === "true") {
      try {
        return await transcribeLocally(videoId, request.signal);
      } catch (localError) {
        if (localError instanceof TranscriptServiceError) {
          throw localError;
        }

        throw new TranscriptServiceError(
          "ASR_FAILED",
          "Local transcription failed. Check the local ASR setup and try again.",
          502,
        );
      }
    }

    throw mapped;
  } finally {
    request.cleanup();
  }
}
