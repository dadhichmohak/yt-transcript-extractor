import { describe, expect, it } from "vitest";

import { cleanTranscriptText } from "@/lib/transcript";

type Segment = Parameters<typeof cleanTranscriptText>[0][number];

function segment(text: string, offset: number, duration = 2): Segment {
  return { text, offset, duration };
}

describe("cleanTranscriptText", () => {
  it("joins non-overlapping segments with single spaces", () => {
    expect(cleanTranscriptText([segment("Hello there", 0), segment("friend", 4)])).toBe("Hello there friend");
  });

  it("strips caption markup and decodes entities", () => {
    expect(cleanTranscriptText([segment("<c>Tom &amp; Jerry</c>", 0)])).toBe("Tom & Jerry");
  });

  it("collapses whitespace", () => {
    expect(cleanTranscriptText([segment("  spaced   out  ", 0)])).toBe("spaced out");
  });

  it("drops empty segments", () => {
    expect(cleanTranscriptText([segment("   ", 0), segment("real", 4)])).toBe("real");
  });

  it("removes exact duplicate rolling captions", () => {
    expect(cleanTranscriptText([segment("the quick brown", 0, 3), segment("the quick brown", 2, 3)])).toBe(
      "the quick brown",
    );
  });

  it("keeps the longer version when a rolling caption grows", () => {
    expect(cleanTranscriptText([segment("hello world", 0, 3), segment("hello world again", 2, 3)])).toBe(
      "hello world again",
    );
  });

  it("keeps repeated words when segments do not overlap", () => {
    expect(cleanTranscriptText([segment("yes", 0), segment("yes", 5)])).toBe("yes yes");
  });

  it("keeps repeated non-overlapping captions such as sound labels", () => {
    expect(cleanTranscriptText([segment("[music]", 0), segment("[music]", 7)])).toBe("[music] [music]");
  });

  it("keeps unrelated text even when captions overlap", () => {
    expect(cleanTranscriptText([segment("alpha", 0, 3), segment("beta", 2, 3)])).toBe("alpha beta");
  });

  it("handles a long rolling caption sequence without losing words", () => {
    const segments = [
      segment("we were discussing about the", 0, 4),
      segment("we were discussing about the efficiency", 3, 4),
      segment("we were discussing about the efficiency calculations", 6, 4),
    ];

    expect(cleanTranscriptText(segments)).toBe("we were discussing about the efficiency calculations");
  });

  it("returns an empty string for no content", () => {
    expect(cleanTranscriptText([])).toBe("");
  });
});
