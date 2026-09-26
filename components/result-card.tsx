"use client";

import { formatDuration } from "@/lib/format";
import type { TranscriptPayload } from "@/lib/transcript";

type ResultCardProps = {
  transcript: TranscriptPayload;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onToggleExpand: () => void;
  expanded: boolean;
};

export function buildTranscriptFile(transcript: TranscriptPayload): string {
  const header = [
    transcript.title,
    `${transcript.channel} - ${formatDuration(transcript.durationSeconds)}`,
    `https://www.youtube.com/watch?v=${transcript.videoId}`,
    `Source: ${transcript.source === "captions" ? "YouTube captions" : "local speech-to-text"}`,
    "",
  ].join("\n");

  return `${header}${transcript.text}\n`;
}

export function downloadTranscriptFile(transcript: TranscriptPayload): void {
  const blob = new Blob([buildTranscriptFile(transcript)], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `transcript-${transcript.videoId}.txt`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function ResultCard({
  transcript,
  copied,
  onCopy,
  onDownload,
  onToggleExpand,
  expanded,
}: ResultCardProps) {
  const wordCount = transcript.text.split(/\s+/).filter(Boolean).length;

  return (
    <section className="result">
      <div className="resultHeader">
        <div>
          <h2>{transcript.title}</h2>
          <p className="meta">
            {transcript.channel} &middot; {formatDuration(transcript.durationSeconds)} &middot;{" "}
            {transcript.language}
          </p>
        </div>
        <div className="actions">
          <button className="button secondary" type="button" onClick={onCopy}>
            {copied ? "Copied" : "Copy transcript"}
          </button>
          <button className="button secondary" type="button" onClick={onDownload}>
            Download .txt
          </button>
        </div>
      </div>

      <article className={expanded ? "transcript expanded" : "transcript"}>{transcript.text}</article>

      <div className="resultFooter">
        <button className="link" type="button" onClick={onToggleExpand}>
          {expanded ? "Collapse" : "Show full transcript"}
        </button>
        <p className="footnote">
          Source: {transcript.source === "captions" ? "YouTube captions" : "local speech-to-text"} &middot;{" "}
          {wordCount.toLocaleString("en-US")} words &middot; {transcript.text.length.toLocaleString("en-US")} characters
        </p>
      </div>
    </section>
  );
}
