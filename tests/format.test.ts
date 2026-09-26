import { describe, expect, it } from "vitest";

import { formatDuration } from "@/lib/format";

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(42)).toBe("42s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatDuration(3725)).toBe("1h 2m 5s");
  });

  it("handles unknown lengths", () => {
    expect(formatDuration(0)).toBe("Unknown length");
    expect(formatDuration(Number.NaN)).toBe("Unknown length");
    expect(formatDuration(-5)).toBe("Unknown length");
  });
});
