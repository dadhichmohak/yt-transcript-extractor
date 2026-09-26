import { beforeEach, describe, expect, it } from "vitest";

import { checkRateLimit, RATE_LIMIT_MAX_REQUESTS, resetRateLimits } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows requests under the limit", () => {
    const result = checkRateLimit("client", 1000, 3, 1000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("blocks once the limit is reached", () => {
    const now = 1000;

    expect(checkRateLimit("client", now, 2, 1000).allowed).toBe(true);
    expect(checkRateLimit("client", now, 2, 1000).allowed).toBe(true);

    const blocked = checkRateLimit("client", now, 2, 1000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
  });

  it("resets after the window elapses", () => {
    checkRateLimit("client", 1000, 1, 1000);

    expect(checkRateLimit("client", 1500, 1, 1000).allowed).toBe(false);
    expect(checkRateLimit("client", 2100, 1, 1000).allowed).toBe(true);
  });

  it("tracks clients independently", () => {
    checkRateLimit("a", 1000, 1, 1000);

    expect(checkRateLimit("b", 1000, 1, 1000).allowed).toBe(true);
  });

  it("uses a sane default limit", () => {
    expect(RATE_LIMIT_MAX_REQUESTS).toBeGreaterThan(0);
  });
});
