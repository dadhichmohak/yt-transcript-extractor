type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MAX_REQUESTS = 120;

const buckets = new Map<string, RateLimitBucket>();
let requestCount = 0;

function readPositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }

  return Math.min(parsed, max);
}

export function getRateLimitConfig(): RateLimitConfig {
  return {
    maxRequests: readPositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_MAX_REQUESTS, 1, 100000),
    windowMs: readPositiveInt(process.env.RATE_LIMIT_WINDOW_MS, RATE_LIMIT_WINDOW_MS, 1000, 24 * 60 * 60 * 1000),
  };
}

function removeExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function checkRateLimit(
  key: string,
  now = Date.now(),
  maxRequests = RATE_LIMIT_MAX_REQUESTS,
  windowMs = RATE_LIMIT_WINDOW_MS,
): RateLimitResult {
  requestCount += 1;

  if (requestCount % 100 === 0) {
    removeExpiredBuckets(now);
  }

  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(maxRequests - 1, 0),
      retryAfterSeconds: 0,
    };
  }

  if (current.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;

  return {
    allowed: true,
    remaining: Math.max(maxRequests - current.count, 0),
    retryAfterSeconds: 0,
  };
}

export function resetRateLimits(): void {
  buckets.clear();
  requestCount = 0;
}
