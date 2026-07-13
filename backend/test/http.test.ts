import { beforeEach, describe, expect, it } from "vitest";
import health from "../api/health.js";
import { __resetRateLimitsForTests } from "../lib/rate-limit.js";
import type { ApiRequest, ApiResponse } from "../lib/vercel.js";

interface Result {
  status: number;
  body: string;
  headers: Map<string, string>;
}

function responseDouble(): { response: ApiResponse; result: Result } {
  const result: Result = { status: 200, body: "", headers: new Map() };
  const response = {
    setHeader(name: string, value: string | number) {
      result.headers.set(name.toLowerCase(), String(value));
      return response;
    },
    status(code: number) {
      result.status = code;
      return response;
    },
    send(body: string) {
      result.body = body;
      return response;
    },
  } as unknown as ApiResponse;
  return { response, result };
}

function request(method: string, origin?: string): ApiRequest {
  return {
    method,
    headers: origin ? { origin } : {},
    query: {},
  } as unknown as ApiRequest;
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.ALLOWED_ORIGIN = "https://harsh.bet";
  __resetRateLimitsForTests();
});

describe("HTTP boundary", () => {
  it("sets an exact CORS origin and no-store security headers", async () => {
    const { response, result } = responseDouble();
    await health(request("GET", "https://harsh.bet"), response);
    expect(result.status).toBe(200);
    expect(result.headers.get("access-control-allow-origin")).toBe("https://harsh.bet");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects an unconfigured browser origin before executing the handler", async () => {
    const { response, result } = responseDouble();
    await health(request("GET", "https://evil.example"), response);
    expect(result.status).toBe(403);
    expect(JSON.parse(result.body)).toMatchObject({ error: { code: "origin_not_allowed" } });
    expect(result.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("answers an allowed preflight without exposing service configuration", async () => {
    const { response, result } = responseDouble();
    await health(request("OPTIONS", "https://harsh.bet"), response);
    expect(result.status).toBe(204);
    expect(result.body).toBe("");
  });
});
