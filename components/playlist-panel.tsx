"use client";

import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";

import { ResultCard, buildTranscriptFile, downloadTranscriptFile } from "@/components/result-card";
import { formatDuration } from "@/lib/format";
import type { PlaylistResult, PlaylistVideo } from "@/lib/playlist";
import type { TranscriptPayload } from "@/lib/transcript";

type ApiError = { code: string; message: string };

type ItemState = {
  status: "pending" | "loading" | "done" | "failed";
  transcript?: TranscriptPayload;
  error?: string;
};

const CONCURRENCY = 3;

async function postJson<T extends object>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const payload = (await response.json()) as T | { error: ApiError };

  if (!response.ok || "error" in payload) {
    const message = "error" in payload ? payload.error.message : "Request failed.";
    throw new Error(message);
  }

  return payload as T;
}

function safeFileName(value: string): string {
  return value.replace(/[^\w\-. ]+/g, "").trim().slice(0, 60) || "playlist";
}

export function PlaylistPanel() {
  const [url, setUrl] = useState("");
  const [playlist, setPlaylist] = useState<PlaylistResult | null>(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [running, setRunning] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const chosen = useMemo(
    () => (playlist ? playlist.videos.filter((video) => selected.has(video.videoId)) : []),
    [playlist, selected],
  );

  const completed = useMemo(
    () =>
      Object.values(items).filter((item) => item.status === "done" && item.transcript) as {
        status: "done";
        transcript: TranscriptPayload;
      }[],
    [items],
  );

  const failed = useMemo(
    () => Object.entries(items).filter(([, item]) => item.status === "failed"),
    [items],
  );

  const handleLoad = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingPlaylist(true);
    setPlaylistError(null);
    setPlaylist(null);
    setItems({});
    setSelected(new Set());
    setExpandedIds(new Set());

    try {
      const result = await postJson<PlaylistResult>("/api/playlist", { url: url.trim() }, controller.signal);

      setPlaylist(result);
      setSelected(new Set(result.videos.map((video) => video.videoId)));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setPlaylistError(error instanceof Error ? error.message : "The playlist could not be loaded.");
    } finally {
      setLoadingPlaylist(false);
    }
  }, [url]);

  const toggleVideo = useCallback((videoId: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }

      return next;
    });
  }, []);

  const runTranscription = useCallback(async () => {
    if (!playlist || chosen.length === 0) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setItems(
      Object.fromEntries(
        chosen.map((video) => [video.videoId, { status: "pending" } as ItemState]),
      ),
    );

    const queue = [...chosen];
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        if (controller.signal.aborted) {
          return;
        }

        const video = queue[cursor];
        cursor += 1;

        if (!video) {
          return;
        }

        setItems((current) => ({ ...current, [video.videoId]: { status: "loading" } }));

        try {
          const transcript = await postJson<TranscriptPayload>(
            "/api/transcript",
            { url: video.videoId },
            controller.signal,
          );

          setItems((current) => ({
            ...current,
            [video.videoId]: { status: "done", transcript },
          }));
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }

          setItems((current) => ({
            ...current,
            [video.videoId]: {
              status: "failed",
              error: error instanceof Error ? error.message : "Transcript failed.",
            },
          }));
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setRunning(false);
  }, [chosen, playlist]);

  const handleCopyAll = useCallback(async () => {
    if (completed.length === 0) {
      return;
    }

    const combined = completed
      .map((item) => buildTranscriptFile(item.transcript).trim())
      .join("\n\n========================================\n\n");

    try {
      await navigator.clipboard.writeText(combined);
      setCopiedId("all");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  }, [completed]);

  const handleDownloadAll = useCallback(() => {
    if (!playlist || completed.length === 0) {
      return;
    }

    const combined = completed
      .map((item) => buildTranscriptFile(item.transcript).trim())
      .join("\n\n========================================\n\n");

    const blob = new Blob([`${combined}\n`], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${safeFileName(playlist.title)}.txt`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }, [completed, playlist]);

  const toggleExpanded = useCallback((videoId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }

      return next;
    });
  }, []);

  const copyVideoTranscript = useCallback(async (videoId: string, transcript: TranscriptPayload) => {
    try {
      await navigator.clipboard.writeText(transcript.text);
      setCopiedId(videoId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  }, []);

  return (
    <>
      <form className="form" onSubmit={handleLoad}>
        <label className="label" htmlFor="playlist-url">
          YouTube playlist link
        </label>
        <div className="row">
          <input
            id="playlist-url"
            className="input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.youtube.com/playlist?list=..."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={loadingPlaylist || running}
          />
          <button className="button" type="submit" disabled={loadingPlaylist || running}>
            {loadingPlaylist ? "Loading..." : "Load playlist"}
          </button>
        </div>
        <p className="hint">
          Paste a link containing a <code>list=</code> parameter. Videos are transcribed one by one, so long playlists
          take a while.
        </p>
      </form>

      <div className="status" aria-live="polite">
        {playlistError ? (
          <p className="error" role="alert">
            {playlistError}
          </p>
        ) : null}
      </div>

      {playlist ? (
        <section className="playlist">
          <div className="playlistHeader">
            <div>
              <h2>{playlist.title}</h2>
              <p className="meta">
                {playlist.count} videos loaded &middot; {selected.size} selected
              </p>
            </div>
            <div className="actions">
              <button
                className="link"
                type="button"
                onClick={() =>
                  setSelected((current) =>
                    current.size === playlist.videos.length
                      ? new Set()
                      : new Set(playlist.videos.map((video) => video.videoId)),
                  )
                }
              >
                {selected.size === playlist.videos.length ? "Clear selection" : "Select all"}
              </button>
              <button
                className="button"
                type="button"
                onClick={runTranscription}
                disabled={running || chosen.length === 0}
              >
                {running ? "Transcribing..." : `Transcribe ${chosen.length} video${chosen.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          {playlist.truncated ? (
            <p className="hint">
              YouTube only exposes the first batch of a long playlist to anonymous requests, so later videos may be
              missing. Transcribe the ones listed here, then paste any remaining video links individually.
            </p>
          ) : null}

          <ol className="videoList">
            {playlist.videos.map((video: PlaylistVideo) => {
              const item = items[video.videoId];
              const doneTranscript = item?.status === "done" ? item.transcript : undefined;
              const wordCount = doneTranscript ? doneTranscript.text.split(/\s+/).filter(Boolean).length : 0;

              return (
                <li key={video.videoId} className="videoRow">
                  <label className="videoPick">
                    <input
                      type="checkbox"
                      checked={selected.has(video.videoId)}
                      onChange={() => toggleVideo(video.videoId)}
                      disabled={running}
                    />
                    <span className="videoTitle">
                      {video.position}. {video.title}
                    </span>
                  </label>
                  <span className="videoMeta">
                    {formatDuration(video.lengthSeconds)} &middot;{" "}
                    {item?.status === "loading"
                      ? "working..."
                      : item?.status === "pending"
                        ? "queued"
                        : item?.status === "failed"
                          ? "failed"
                          : doneTranscript
                            ? `${wordCount} words`
                            : "not started"}
                  </span>
                  {doneTranscript ? (
                    <div className="videoActions">
                      <button className="link" type="button" onClick={() => toggleExpanded(video.videoId)}>
                        {expandedIds.has(video.videoId) ? "Hide" : "View"}
                      </button>
                      <button
                        className="link"
                        type="button"
                        onClick={() => copyVideoTranscript(video.videoId, doneTranscript)}
                      >
                        {copiedId === video.videoId ? "Copied" : "Copy"}
                      </button>
                      <button className="link" type="button" onClick={() => downloadTranscriptFile(doneTranscript)}>
                        .txt
                      </button>
                    </div>
                  ) : null}
                  {item?.status === "failed" ? <p className="videoError">{item.error}</p> : null}
                  {doneTranscript && expandedIds.has(video.videoId) ? (
                    <ResultCard
                      transcript={doneTranscript}
                      copied={copiedId === video.videoId}
                      onCopy={() => copyVideoTranscript(video.videoId, doneTranscript)}
                      onDownload={() => downloadTranscriptFile(doneTranscript)}
                      onToggleExpand={() => toggleExpanded(video.videoId)}
                      expanded
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {completed.length > 0 ? (
            <div className="playlistFooter">
              <button className="button secondary" type="button" onClick={handleCopyAll}>
                {copiedId === "all" ? "Copied all" : "Copy all transcripts"}
              </button>
              <button className="button secondary" type="button" onClick={handleDownloadAll}>
                Download all as one .txt
              </button>
              <span className="meta">
                {completed.length} ready
                {failed.length > 0 ? `, ${failed.length} failed` : ""}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
