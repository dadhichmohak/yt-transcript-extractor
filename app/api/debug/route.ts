import { NextResponse } from "next/server";

import { parseYoutubeInput, VideoInputError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const INNERTUBE_API_KEY_PATTERN = /"INNERTUBE_API_KEY":"([^"]+)"/;

type Step = Record<string, unknown>;

function isEnabled(): boolean {
  return process.env.DEBUG_UPSTREAM === "true";
}

async function readEgressIp(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return `unavailable (status ${response.status})`;
    }

    const body = (await response.json()) as { ip?: string };
    return body.ip ?? "unknown";
  } catch (error) {
    return `unavailable (${error instanceof Error ? error.message : "unknown error"})`;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isEnabled()) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }

  let url: unknown;

  try {
    const body = (await request.json()) as unknown;
    url = typeof body === "object" && body !== null && "url" in body ? (body as { url: unknown }).url : undefined;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Send a JSON body with a url field." } }, { status: 400 });
  }

  let videoId: string;

  try {
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new VideoInputError("Send a JSON body with a url field.");
    }

    videoId = parseYoutubeInput(url).videoId;
  } catch (error) {
    if (error instanceof VideoInputError) {
      return NextResponse.json({ error: { code: "INVALID_VIDEO", message: error.message } }, { status: 400 });
    }

    throw error;
  }

  const report: Step[] = [];
  const timeout = AbortSignal.timeout(20000);

  report.push({ step: "egressIp", value: await readEgressIp() });

  try {
    const watchResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: timeout,
    });

    const watchBody = await watchResponse.text();
    const apiKey = watchBody.match(INNERTUBE_API_KEY_PATTERN)?.[1] ?? null;

    report.push({
      step: "watchPage",
      status: watchResponse.status,
      finalUrl: watchResponse.url,
      bodyLength: watchBody.length,
      hasRecaptcha: watchBody.includes('class="g-recaptcha"'),
      hasConsentInterstitial: /consent\.youtube\.com|consent\.google\.com/.test(watchResponse.url),
      hasInnertubeApiKey: Boolean(apiKey),
      hasCaptionTracksInPage: watchBody.includes('"captionTracks"'),
    });

    if (!apiKey) {
      return NextResponse.json({ videoId, report, conclusion: "No Innertube API key in the watch page. The server is being served a bot or consent page instead of the video." });
    }

    const playerResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
        videoId,
      }),
      signal: timeout,
    });

    const playerText = await playerResponse.text();
    let playerJson: Record<string, unknown> = {};

    try {
      playerJson = JSON.parse(playerText) as Record<string, unknown>;
    } catch {
      report.push({ step: "player", status: playerResponse.status, parseError: true, bodyPreview: playerText.slice(0, 300) });
      return NextResponse.json({ videoId, report, conclusion: "The player endpoint did not return JSON." });
    }

    const captions = playerJson.captions as
      | { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } }
      | undefined;
    const tracklist = captions?.playerCaptionsTracklistRenderer;
    const rawTracks = (tracklist?.captionTracks ?? []) as {
      languageCode?: string;
      kind?: string;
      baseUrl?: string;
      vssId?: string;
    }[];
    const playability = playerJson.playabilityStatus as { status?: string; reason?: string } | undefined;

    report.push({
      step: "player",
      status: playerResponse.status,
      playabilityStatus: playability?.status,
      playabilityReason: playability?.reason,
      hasCaptionsBlock: Boolean(playerJson.captions),
      trackCount: rawTracks.length,
      tracks: rawTracks.map((track) => ({
        languageCode: track.languageCode,
        kind: track.kind ?? "manual",
        vssId: track.vssId,
      })),
    });

    const track = rawTracks[0];

    if (!track?.baseUrl) {
      return NextResponse.json({
        videoId,
        report,
        conclusion: playability?.status === "OK"
          ? "The player says the video is playable but returned no caption tracks. YouTube is withholding captions from this IP, or the video genuinely has none."
          : `The video is not playable (${playability?.status ?? "unknown"}).`,
      });
    }

    const transcriptUrl = track.baseUrl.replace(/&fmt=[^&]+/, "");
    const transcriptResponse = await fetch(transcriptUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: timeout,
    });
    const transcriptBody = await transcriptResponse.text();
    const segmentCount = [...transcriptBody.matchAll(/<text[^>]*>/g)].length;

    report.push({
      step: "transcriptXml",
      status: transcriptResponse.status,
      contentType: transcriptResponse.headers.get("content-type"),
      bodyLength: transcriptBody.length,
      segmentCount,
      bodyPreview: transcriptBody.slice(0, 200),
    });

    return NextResponse.json({
      videoId,
      report,
      conclusion: segmentCount > 0
        ? "Captions are reachable from this deployment."
        : "Caption tracks were listed but the transcript XML came back empty.",
    });
  } catch (error) {
    return NextResponse.json({
      videoId,
      report,
      conclusion: `Diagnostic failed: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
}
