import { randomUUID } from "node:crypto";
import { getPublicConfig } from "./config.js";
import type { ApiRequest, ApiResponse } from "./vercel.js";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export interface RequestContext {
  requestId: string;
}

export type ApiHandler = (
  req: ApiRequest,
  res: ApiResponse,
  context: RequestContext,
) => Promise<void>;

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function setBaseHeaders(res: ApiResponse, requestId: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Request-Id", requestId);
}

function applyCors(req: ApiRequest, res: ApiResponse): void {
  const origin = oneHeader(req.headers.origin);
  const { allowedOrigin } = getPublicConfig();
  res.setHeader("Vary", "Origin");

  if (origin && origin !== allowedOrigin) {
    throw new HttpError(403, "origin_not_allowed", "This request origin is not allowed.");
  }

  if (origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Upload-Id, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "600");
}

export function sendJson(res: ApiResponse, status: number, body: unknown): void {
  res.status(status);
  res.setHeader("Content-Type", JSON_CONTENT_TYPE);
  res.send(JSON.stringify(body));
}

export function sendError(
  res: ApiResponse,
  requestId: string,
  error: unknown,
): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, requestId },
    });
    return;
  }

  // Do not serialize thrown objects: upstream responses and configuration may contain secrets.
  console.error("sift_api_unhandled", { requestId, errorName: error instanceof Error ? error.name : "unknown" });
  sendJson(res, 500, {
    error: {
      code: "internal_error",
      message: "The request could not be completed.",
      requestId,
    },
  });
}

export function endpoint(handler: ApiHandler): ApiHandler {
  return async (req, res, context) => {
    try {
      await handler(req, res, context);
    } catch (error) {
      sendError(res, context.requestId, error);
    }
  };
}

export function api(handler: ApiHandler): (req: ApiRequest, res: ApiResponse) => Promise<void> {
  const guarded = endpoint(handler);
  return async (req, res) => {
    const requestId = randomUUID();
    setBaseHeaders(res, requestId);

    try {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
    } catch (error) {
      sendError(res, requestId, error);
      return;
    }

    await guarded(req, res, { requestId });
  };
}

export function requireMethod(req: ApiRequest, res: ApiResponse, method: "GET" | "POST"): void {
  if (req.method !== method) {
    res.setHeader("Allow", `${method}, OPTIONS`);
    throw new HttpError(405, "method_not_allowed", `Use ${method} for this endpoint.`);
  }
}

function contentLength(req: ApiRequest): number | undefined {
  const raw = oneHeader(req.headers["content-length"]);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function collectStream(req: ApiRequest, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > maximumBytes) {
      throw new HttpError(413, "body_too_large", "The request body is too large.");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

export async function readRawBody(req: ApiRequest, maximumBytes: number): Promise<Buffer> {
  const declared = contentLength(req);
  if (declared !== undefined && declared > maximumBytes) {
    throw new HttpError(413, "body_too_large", "The request body is too large.");
  }

  const body: unknown = req.body;
  let bytes: Buffer;
  if (Buffer.isBuffer(body)) {
    bytes = body;
  } else if (body instanceof Uint8Array) {
    bytes = Buffer.from(body);
  } else if (typeof body === "string") {
    bytes = Buffer.from(body, "binary");
  } else if (body === undefined || body === null) {
    bytes = await collectStream(req, maximumBytes);
  } else {
    throw new HttpError(415, "invalid_body", "Expected a binary request body.");
  }

  if (bytes.length > maximumBytes) {
    throw new HttpError(413, "body_too_large", "The request body is too large.");
  }
  return bytes;
}

export async function readJsonBody(req: ApiRequest, maximumBytes: number): Promise<unknown> {
  const declared = contentLength(req);
  if (declared !== undefined && declared > maximumBytes) {
    throw new HttpError(413, "body_too_large", "The request body is too large.");
  }

  const body: unknown = req.body;
  if (body !== undefined && body !== null && typeof body === "object" && !Buffer.isBuffer(body)) {
    let serialized: string;
    try {
      serialized = JSON.stringify(body);
    } catch {
      throw new HttpError(400, "invalid_json", "The JSON request body is invalid.");
    }
    if (Buffer.byteLength(serialized) > maximumBytes) {
      throw new HttpError(413, "body_too_large", "The request body is too large.");
    }
    return body;
  }

  const bytes = await readRawBody(req, maximumBytes);
  if (bytes.length === 0) throw new HttpError(400, "empty_body", "A JSON request body is required.");
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "The JSON request body is invalid.");
  }
}

export function headerValue(req: ApiRequest, name: string): string | undefined {
  return oneHeader(req.headers[name.toLowerCase()]);
}

export function queryValue(req: ApiRequest, name: string): string | undefined {
  const value = req.query[name];
  return Array.isArray(value) ? value[0] : value;
}
