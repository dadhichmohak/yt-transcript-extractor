import { NextResponse } from "next/server";

import { TranscriptServiceError } from "@/lib/errors";
import { checkRateLimit, getRateLimitConfig } from "@/lib/rate-limit";
import { getTranscript } from "@/lib/transcript";
import { parseYoutubeInput, VideoInputError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUT_LENGTH = 500;

function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();

  return first || request.headers.get("x-real-ip") || "anonymous";
}

function errorResponse(error: TranscriptServiceError): NextResponse {
  const headers: Record<string, string> = {};

  if (error.status === 429) {
    headers["Retry-After"] = "60";
  }

  return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { maxRequests, windowMs } = getRateLimitConfig();
  const limit = checkRateLimit(getClientKey(request), Date.now(), maxRequests, windowMs);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Try again in ${limit.retryAfterSeconds} seconds.`,
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let url: unknown;

  try {
    const body = (await request.json()) as unknown;
    url = typeof body === "object" && body !== null && "url" in body ? (body as { url: unknown }).url : undefined;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Send a JSON body with a url field." } },
      { status: 400 },
    );
  }

  if (typeof url !== "string" || url.trim().length === 0) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Send a JSON body with a url field." } },
      { status: 400 },
    );
  }

  if (url.length > MAX_INPUT_LENGTH) {
    return NextResponse.json(
      { error: { code: "INVALID_VIDEO", message: "The link is too long to be a YouTube URL." } },
      { status: 400 },
    );
  }

  let videoId: string;

  try {
    videoId = parseYoutubeInput(url).videoId;
  } catch (error) {
    if (error instanceof VideoInputError) {
      return NextResponse.json(
        { error: { code: "INVALID_VIDEO", message: error.message } },
        { status: 400 },
      );
    }

    throw error;
  }

  try {
    const transcript = await getTranscript(videoId, request.signal);

    return NextResponse.json(transcript, {
      headers: {
        "Cache-Control": "private, max-age=600",
        "X-RateLimit-Remaining": String(limit.remaining),
      },
    });
  } catch (error) {
    if (error instanceof TranscriptServiceError) {
      return errorResponse(error);
    }

    return NextResponse.json(
      {
        error: {
          code: "TRANSCRIPT_FAILED",
          message: "Something went wrong while fetching the transcript. Please try again.",
        },
      },
      { status: 500 },
    );
  }
}
