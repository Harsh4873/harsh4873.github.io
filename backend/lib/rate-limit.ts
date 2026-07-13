import { HttpError } from "./http.js";
import type { ApiResponse } from "./vercel.js";

interface Bucket {
  count: number;
  resetsAt: number;
}

const buckets = new Map<string, Bucket>();
let callsSinceCleanup = 0;

export interface RateLimit {
  name: string;
  requests: number;
  windowMs: number;
}

function cleanup(now: number): void {
  callsSinceCleanup += 1;
  if (callsSinceCleanup < 100) return;
  callsSinceCleanup = 0;
  for (const [key, bucket] of buckets) {
    if (bucket.resetsAt <= now) buckets.delete(key);
  }
}

export function enforceRateLimit(
  subject: string,
  limit: RateLimit,
  res?: ApiResponse,
  now = Date.now(),
): void {
  cleanup(now);
  const key = `${limit.name}:${subject}`;
  const existing = buckets.get(key);
  const bucket = !existing || existing.resetsAt <= now
    ? { count: 0, resetsAt: now + limit.windowMs }
    : existing;

  if (bucket.count >= limit.requests) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000));
    res?.setHeader("Retry-After", String(retryAfter));
    throw new HttpError(429, "rate_limited", "Too many requests. Please wait and try again.");
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  if (res) {
    res.setHeader("RateLimit-Limit", String(limit.requests));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit.requests - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetsAt / 1000)));
  }
}

export function __resetRateLimitsForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  buckets.clear();
  callsSinceCleanup = 0;
}
