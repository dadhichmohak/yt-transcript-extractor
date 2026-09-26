export type TranscriptErrorCode =
  | "INVALID_VIDEO"
  | "VIDEO_UNAVAILABLE"
  | "CAPTIONS_DISABLED"
  | "CAPTIONS_UNAVAILABLE"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "TIMEOUT"
  | "ASR_UNAVAILABLE"
  | "ASR_FAILED"
  | "PLAYLIST_UNAVAILABLE"
  | "TRANSCRIPT_FAILED";

export class TranscriptServiceError extends Error {
  readonly code: TranscriptErrorCode;
  readonly status: number;

  constructor(code: TranscriptErrorCode, message: string, status: number) {
    super(message);
    this.name = "TranscriptServiceError";
    this.code = code;
    this.status = status;
  }
}
