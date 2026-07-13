import type { IncomingMessage, ServerResponse } from "node:http";

/** Structural types for Vercel's Node request/response extensions; no runtime package is needed. */
export interface ApiRequest extends IncomingMessage {
  body?: unknown;
  query: Record<string, string | string[] | undefined>;
}

export interface ApiResponse extends ServerResponse {
  status(statusCode: number): this;
  send(body: string): this;
}
