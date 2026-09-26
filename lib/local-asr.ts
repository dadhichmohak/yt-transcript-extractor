import { spawn } from "node:child_process";
import path from "node:path";

import { TranscriptServiceError } from "./errors";
import type { TranscriptPayload } from "./transcript";

type LocalAsrResult = {
  text: string;
  language?: string;
  durationSeconds?: number;
  title?: string;
  channel?: string;
};

const OUTPUT_MARKER = "TRANSCRIPT_JSON:";
const MAX_OUTPUT_LENGTH = 5_000_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export function isLocalAsrEnabled(): boolean {
  return process.env.LOCAL_ASR_ENABLED === "true";
}

function getLocalTimeoutMs(): number {
  const configured = Number.parseInt(process.env.LOCAL_ASR_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= 60000
    ? Math.min(configured, 60 * 60 * 1000)
    : DEFAULT_TIMEOUT_MS;
}

export async function transcribeLocally(
  videoId: string,
  parentSignal?: AbortSignal,
): Promise<TranscriptPayload> {
  if (!isLocalAsrEnabled()) {
    throw new TranscriptServiceError(
      "ASR_UNAVAILABLE",
      "Local transcription is not enabled for this deployment.",
      501,
    );
  }

  const pythonBin = process.env.PYTHON_BIN || "python";
  const scriptPath = path.join(process.cwd(), "scripts", "local_asr.py");
  const timeoutMs = getLocalTimeoutMs();

  return new Promise<TranscriptPayload>((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath, videoId], {
      env: {
        ...process.env,
        WHISPER_MODEL: process.env.WHISPER_MODEL || "base",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
      callback();
    };

    const abortFromParent = () => {
      aborted = true;
      child.kill();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    if (parentSignal) {
      if (parentSignal.aborted) {
        abortFromParent();
      } else {
        parentSignal.addEventListener("abort", abortFromParent, { once: true });
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_LENGTH) {
        stdout += chunk.toString();
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 100_000) {
        stderr += chunk.toString();
      }
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(() => {
        if (error.code === "ENOENT") {
          reject(
            new TranscriptServiceError(
              "ASR_UNAVAILABLE",
              "Python was not found. Install Python and the local ASR dependencies to enable fallback transcription.",
              501,
            ),
          );
          return;
        }

        reject(
          new TranscriptServiceError(
            "ASR_FAILED",
            "The local transcription process could not start.",
            502,
          ),
        );
      });
    });

    child.once("close", (code: number | null) => {
      finish(() => {
        if (aborted) {
          reject(new TranscriptServiceError("TIMEOUT", "The request was cancelled.", 499));
          return;
        }

        if (timedOut) {
          reject(
            new TranscriptServiceError(
              "ASR_FAILED",
              "Local transcription took too long and was stopped.",
              504,
            ),
          );
          return;
        }

        if (code !== 0) {
          reject(
            new TranscriptServiceError(
              "ASR_FAILED",
              "Local transcription failed. Check the ASR dependencies and ffmpeg installation.",
              502,
            ),
          );
          return;
        }

        const markerIndex = stdout.lastIndexOf(OUTPUT_MARKER);

        if (markerIndex < 0) {
          reject(
            new TranscriptServiceError(
              "ASR_FAILED",
              "Local transcription returned no readable result.",
              502,
            ),
          );
          return;
        }

        try {
          const raw = stdout.slice(markerIndex + OUTPUT_MARKER.length).trim();
          const result = JSON.parse(raw) as LocalAsrResult;
          const text = result.text.replace(/\s+/g, " ").trim();

          if (!text) {
            reject(
              new TranscriptServiceError(
                "ASR_FAILED",
                "Local transcription returned an empty transcript.",
                502,
              ),
            );
            return;
          }

          resolve({
            videoId,
            title: result.title || "YouTube video",
            channel: result.channel || "Unknown channel",
            durationSeconds: result.durationSeconds || 0,
            thumbnail: null,
            language: result.language || "unknown",
            text,
            segmentCount: 0,
            source: "asr",
            fetchedAt: new Date().toISOString(),
          });
        } catch {
          reject(
            new TranscriptServiceError(
              "ASR_FAILED",
              "Local transcription returned an invalid result.",
              502,
            ),
          );
        }
      });
    });
  });
}
