import { NextResponse } from "next/server";

import { TranscriptServiceError } from "@/lib/errors";
import { fetchPlaylist } from "@/lib/playlist";
import { checkRateLimit, getRateLimitConfig } from "@/lib/rate-limit";
import { parsePlaylistInput, VideoInputError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUT_LENGTH = 500;

function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();

  return first || request.headers.get("x-real-ip") || "anonymous";
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

  if (typeof url !== "string" || url.trim().length === 0 || url.length > MAX_INPUT_LENGTH) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Send a valid playlist url." } },
      { status: 400 },
    );
  }

  let playlistId: string;

  try {
    const parsed = parsePlaylistInput(url);

    if (!parsed) {
      throw new VideoInputError("This link does not contain a YouTube playlist. Try a link with a list= parameter.");
    }

    playlistId = parsed.playlistId;
  } catch (error) {
    if (error instanceof VideoInputError) {
      return NextResponse.json({ error: { code: "INVALID_VIDEO", message: error.message } }, { status: 400 });
    }

    throw error;
  }

  try {
    const playlist = await fetchPlaylist(playlistId, request.signal);

    return NextResponse.json(playlist, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    if (error instanceof TranscriptServiceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: { code: "PLAYLIST_UNAVAILABLE", message: "The playlist could not be loaded." } },
      { status: 500 },
    );
  }
}
