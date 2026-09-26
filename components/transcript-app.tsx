"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { PlaylistPanel } from "@/components/playlist-panel";
import { ResultCard, downloadTranscriptFile } from "@/components/result-card";
import { hasPlaylistMarker } from "@/lib/validation";
import type { TranscriptPayload } from "@/lib/transcript";

type Status = "idle" | "loading" | "success" | "error";
type Mode = "single" | "playlist";
type ApiError = { code: string; message: string };

const LOADING_STAGES = [
  "Reading captions...",
  "Fetching caption tracks...",
  "Cleaning up the text...",
  "Almost there...",
];

const STAGE_INTERVAL_MS = 2600;

function ResultSkeleton() {
  return (
    <section className="result" aria-hidden="true">
      <div className="resultHeader">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="skeleton" data-width="title" />
          <div className="skeleton" data-width="meta" />
        </div>
      </div>
      <div className="skeletonStack">
        <div className="skeleton" data-width="long" />
        <div className="skeleton" data-width="full" />
        <div className="skeleton" data-width="medium" />
        <div className="skeleton" data-width="full" />
        <div className="skeleton" data-width="short" />
      </div>
    </section>
  );
}

export function TranscriptApp() {
  const [mode, setMode] = useState<Mode>("single");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [stage, setStage] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (status !== "loading") {
      return;
    }

    const timer = setInterval(() => {
      setStage((current) => (current + 1) % LOADING_STAGES.length);
    }, STAGE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [status]);

  const handleUrlChange = useCallback((value: string) => {
    setUrl(value);

    if (mode === "single" && hasPlaylistMarker(value)) {
      setMode("playlist");
    }
  }, [mode]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const value = url.trim();

      if (!value) {
        setStatus("error");
        setError({ code: "INVALID_REQUEST", message: "Paste a YouTube link first." });
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("loading");
      setError(null);
      setCopied(false);
      setExpanded(false);
      setStage(0);

      try {
        const response = await fetch("/api/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: value }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as TranscriptPayload | { error: ApiError };

        if (!response.ok || "error" in payload) {
          const failure =
            "error" in payload ? payload.error : { code: "TRANSCRIPT_FAILED", message: "Request failed." };
          setStatus("error");
          setError(failure);
          return;
        }

        setTranscript(payload);
        setStatus("success");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }

        setStatus("error");
        setError({
          code: "NETWORK_ERROR",
          message: "Could not reach the server. Check your connection and try again.",
        });
      }
    },
    [url],
  );

  const handleCopy = useCallback(async () => {
    if (!transcript) {
      return;
    }

    try {
      await navigator.clipboard.writeText(transcript.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [transcript]);

  return (
    <main className="page">
      <section className="hero">
        <p className="badge">Free, no sign-up, no API key</p>
        <h1>YouTube transcript extractor</h1>
        <p className="subtitle">
          Paste a public YouTube link for the full transcript, or a playlist link to transcribe every video in it.
          Captions are used when available, with an optional local speech-to-text fallback.
        </p>

        <div className="tabs" role="tablist">
          <button
            className={mode === "single" ? "tab active" : "tab"}
            type="button"
            role="tab"
            aria-selected={mode === "single"}
            onClick={() => setMode("single")}
          >
            Single video
          </button>
          <button
            className={mode === "playlist" ? "tab active" : "tab"}
            type="button"
            role="tab"
            aria-selected={mode === "playlist"}
            onClick={() => setMode("playlist")}
          >
            Playlist
          </button>
        </div>

        {mode === "single" ? (
          <>
            <form className="form" onSubmit={handleSubmit}>
              <label className="label" htmlFor="youtube-url">
                YouTube link or video ID
              </label>
              <div className="row">
                <input
                  id="youtube-url"
                  className="input"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={(event) => handleUrlChange(event.target.value)}
                  disabled={status === "loading"}
                />
                <button className="button" type="submit" disabled={status === "loading"}>
                  {status === "loading" ? <span className="spinner onAccent" aria-hidden="true" /> : null}
                  {status === "loading" ? "Fetching..." : "Get transcript"}
                </button>
              </div>
            </form>

            <div className="status" aria-live="polite">
              {status === "error" && error ? (
                <p className="error" role="alert">
                  {error.message}
                </p>
              ) : null}
              {status === "loading" ? (
                <p className="loadingRow">
                  <span className="spinner" aria-hidden="true" />
                  {LOADING_STAGES[stage]}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <PlaylistPanel />
        )}
      </section>

      {mode === "single" && status === "loading" ? <ResultSkeleton /> : null}

      {mode === "single" && status === "success" && transcript ? (
        <ResultCard
          transcript={transcript}
          copied={copied}
          onCopy={handleCopy}
          onDownload={() => downloadTranscriptFile(transcript)}
          onToggleExpand={() => setExpanded((value) => !value)}
          expanded={expanded}
        />
      ) : null}

      <section className="notes">
        <h3>Good to know</h3>
        <ul>
          <li>Only public or otherwise authorized videos can be transcribed.</li>
          <li>Private, members-only, age-restricted, or captionless videos may fail.</li>
          <li>YouTube occasionally blocks automated requests; retrying later usually helps.</li>
          <li>Playlists are transcribed one video at a time, so a long playlist takes a few minutes.</li>
        </ul>
      </section>
    </main>
  );
}
