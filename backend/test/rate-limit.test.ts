import { beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../lib/http.js";
import { __resetRateLimitsForTests, enforceRateLimit } from "../lib/rate-limit.js";

beforeEach(() => {
  process.env.NODE_ENV = "test";
  __resetRateLimitsForTests();
});

describe("instance rate limiter", () => {
  it("fails closed once a subject consumes its endpoint budget", () => {
    const limit = { name: "ask_test", requests: 2, windowMs: 1000 };
    enforceRateLimit("owner", limit, undefined, 1000);
    enforceRateLimit("owner", limit, undefined, 1000);
    expect(() => enforceRateLimit("owner", limit, undefined, 1000)).toThrowError(HttpError);
  });

  it("keeps endpoint and subject buckets separate", () => {
    const limit = { name: "summarize_test", requests: 1, windowMs: 1000 };
    enforceRateLimit("owner-a", limit, undefined, 1000);
    expect(() => enforceRateLimit("owner-b", limit, undefined, 1000)).not.toThrow();
  });
});
