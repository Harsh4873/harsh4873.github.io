import { getOpenAIConfig } from "./config.js";
import { HttpError } from "./http.js";
import { ASK_SYSTEM_PROMPT, buildAskRequest, buildSummaryRequest, SUMMARY_SYSTEM_PROMPT } from "./prompts.js";
import {
  contextualAnswerJsonSchema,
  paperAnalysisJsonSchema,
  parsePaperAnalysisResult,
  StructuredOutputValidationError,
} from "./schemas.js";
import type { AskInput, SummarizeInput, UploadStartInput } from "./validation.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_UPSTREAM_RESPONSE_BYTES = 8 * 1024 * 1024;

interface OpenAIErrorBody {
  error?: {
    code?: unknown;
    type?: unknown;
  };
}

interface OpenAIResponseBody {
  id?: unknown;
  model?: unknown;
  output_text?: unknown;
  output?: unknown;
  usage?: unknown;
}

interface OpenAIUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UploadRecord {
  id: string;
  expiresAt: number | null;
  bytes: number;
  filename: string;
}

export interface UploadPartRecord {
  id: string;
  uploadId: string;
  createdAt: number | null;
}

export interface FileRecord {
  id: string;
  bytes: number;
  filename: string;
  status: string;
  createdAt: number | null;
}

export interface StructuredResponse<T> {
  value: T;
  responseId: string | null;
  model: string;
  usage: OpenAIUsage | null;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function responseText(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_UPSTREAM_RESPONSE_BYTES) {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_UPSTREAM_RESPONSE_BYTES) {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  }
  return text;
}

function upstreamError(
  status: number,
  rawBody: string,
  requestId: string,
  upstreamRequestId: string | null,
  path: string,
): HttpError {
  let code: string | undefined;
  let type: string | undefined;
  try {
    const parsed = JSON.parse(rawBody) as OpenAIErrorBody;
    code = nonEmptyString(parsed.error?.code);
    type = nonEmptyString(parsed.error?.type);
  } catch {
    // Deliberately ignore the upstream text. It must never be reflected to the browser or logs.
  }

  console.error("sift_openai_request_failed", {
    requestId,
    upstreamRequestId,
    status,
    upstreamCode: code,
    upstreamType: type,
  });

  if (code === "insufficient_quota" || type === "insufficient_quota") {
    return new HttpError(
      503,
      "openai_quota_required",
      "AI analysis is unavailable until API billing is enabled.",
    );
  }
  if (status === 404 && (path === "/responses" || path.startsWith("/files/"))) {
    return new HttpError(
      409,
      "ai_file_unavailable",
      "The private AI copy of this PDF is no longer available.",
    );
  }
  if (status === 429) {
    return new HttpError(503, "ai_busy", "The AI service is busy. Please try again shortly.");
  }
  if (status === 401 || status === 403) {
    return new HttpError(503, "ai_configuration_error", "AI analysis is not configured correctly.");
  }
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return new HttpError(422, "ai_rejected_request", "The AI service could not process this PDF request.");
  }
  return new HttpError(502, "ai_unavailable", "The AI service could not complete the request.");
}

async function openAIRequest(
  path: string,
  init: RequestInit,
  requestId: string,
): Promise<unknown> {
  const { apiKey, timeoutMs } = getOpenAIConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  headers.set("X-Client-Request-Id", requestId);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new HttpError(
      timeout ? 504 : 502,
      timeout ? "ai_timeout" : "ai_unavailable",
      timeout ? "The AI request took too long." : "The AI service could not be reached.",
    );
  }

  const text = await responseText(response);
  if (!response.ok) {
    throw upstreamError(response.status, text, requestId, response.headers.get("x-request-id"), path);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  }
}

function requiredIdentifier(record: Record<string, unknown>, key: string, pattern: RegExp): string {
  const value = nonEmptyString(record[key]);
  if (!value || !pattern.test(value)) {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  }
  return value;
}

export async function startPdfUpload(
  input: UploadStartInput,
  requestId: string,
): Promise<UploadRecord> {
  const raw = await openAIRequest(
    "/uploads",
    {
      method: "POST",
      body: JSON.stringify({
        purpose: "vision",
        bytes: input.bytes,
        filename: input.filename,
        mime_type: input.mimeType,
      }),
    },
    requestId,
  );
  const record = objectRecord(raw);
  if (!record) throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  return {
    id: requiredIdentifier(record, "id", /^upload[_-][A-Za-z0-9_-]+$/),
    expiresAt: numericValue(record.expires_at),
    bytes: numericValue(record.bytes) ?? input.bytes,
    filename: nonEmptyString(record.filename) ?? input.filename,
  };
}

export async function addPdfUploadPart(
  uploadId: string,
  bytes: Buffer,
  requestId: string,
): Promise<UploadPartRecord> {
  const form = new FormData();
  form.append("data", new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }), "part.bin");
  const raw = await openAIRequest(
    `/uploads/${encodeURIComponent(uploadId)}/parts`,
    { method: "POST", body: form },
    requestId,
  );
  const record = objectRecord(raw);
  if (!record) throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  return {
    id: requiredIdentifier(record, "id", /^part[_-][A-Za-z0-9_-]+$/),
    uploadId: nonEmptyString(record.upload_id) ?? uploadId,
    createdAt: numericValue(record.created_at),
  };
}

export async function completePdfUpload(
  uploadId: string,
  partIds: string[],
  requestId: string,
): Promise<FileRecord> {
  const raw = await openAIRequest(
    `/uploads/${encodeURIComponent(uploadId)}/complete`,
    { method: "POST", body: JSON.stringify({ part_ids: partIds }) },
    requestId,
  );
  const upload = objectRecord(raw);
  const file = objectRecord(upload?.file);
  if (!file) throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  return {
    id: requiredIdentifier(file, "id", /^file-[A-Za-z0-9_-]+$/),
    bytes: numericValue(file.bytes) ?? 0,
    filename: nonEmptyString(file.filename) ?? "paper.pdf",
    status: nonEmptyString(file.status) ?? "processed",
    createdAt: numericValue(file.created_at),
  };
}

function extractOutputText(response: OpenAIResponseBody): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text;
  if (!Array.isArray(response.output)) {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  }

  const pieces: string[] = [];
  for (const output of response.output) {
    const item = objectRecord(output);
    if (!item || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      const part = objectRecord(content);
      if (part?.type === "output_text" && typeof part.text === "string") pieces.push(part.text);
    }
  }
  const joined = pieces.join("");
  if (!joined.trim()) {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned an empty response.");
  }
  return joined;
}

function normalizeUsage(value: unknown): OpenAIUsage | null {
  const usage = objectRecord(value);
  const inputTokens = numericValue(usage?.input_tokens);
  const outputTokens = numericValue(usage?.output_tokens);
  const totalTokens = numericValue(usage?.total_tokens);
  if (inputTokens === null || outputTokens === null || totalTokens === null) return null;
  return { inputTokens, outputTokens, totalTokens };
}

async function structuredResponse<T>(
  fileId: string,
  systemPrompt: string,
  userPrompt: string,
  schemaName: string,
  schema: unknown,
  maximumOutputTokens: number,
  requestId: string,
): Promise<StructuredResponse<T>> {
  const { model } = getOpenAIConfig();
  const raw = await openAIRequest(
    "/responses",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "medium" },
        max_output_tokens: maximumOutputTokens,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [
              { type: "input_file", file_id: fileId, detail: "high" },
              { type: "input_text", text: userPrompt },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
    },
    requestId,
  );
  const response = objectRecord(raw) as OpenAIResponseBody | undefined;
  if (!response) throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");

  let value: T;
  try {
    value = JSON.parse(extractOutputText(response)) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "invalid_ai_response", "The AI service returned invalid structured data.");
  }

  return {
    value,
    responseId: nonEmptyString(response.id) ?? null,
    model: nonEmptyString(response.model) ?? model,
    usage: normalizeUsage(response.usage),
  };
}

export async function summarizePdf(
  input: SummarizeInput,
  requestId: string,
): Promise<StructuredResponse<Record<string, unknown>>> {
  const result = await structuredResponse<unknown>(
    input.fileId,
    SUMMARY_SYSTEM_PROMPT,
    buildSummaryRequest(input),
    "sift_paper_analysis",
    paperAnalysisJsonSchema,
    28_000,
    requestId,
  );
  try {
    return { ...result, value: parsePaperAnalysisResult(result.value) };
  } catch (error) {
    if (error instanceof StructuredOutputValidationError) {
      throw new HttpError(502, "invalid_ai_response", "The AI service returned invalid structured data.");
    }
    throw error;
  }
}

export async function answerFromPdf(
  input: AskInput,
  requestId: string,
): Promise<StructuredResponse<Record<string, unknown>>> {
  return structuredResponse(
    input.fileId,
    ASK_SYSTEM_PROMPT,
    buildAskRequest(input),
    "sift_contextual_answer",
    contextualAnswerJsonSchema,
    5_000,
    requestId,
  );
}

export async function deleteOpenAIFile(fileId: string, requestId: string): Promise<{ id: string; deleted: boolean }> {
  let raw: unknown;
  try {
    raw = await openAIRequest(
      `/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
      requestId,
    );
  } catch (error) {
    // Deletion is idempotent: a remote file that is already absent no longer
    // retains any paper content and is therefore safe to treat as deleted.
    if (error instanceof HttpError && error.code === "ai_file_unavailable") {
      return { id: fileId, deleted: true };
    }
    throw error;
  }
  const record = objectRecord(raw);
  if (!record) throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  return {
    id: nonEmptyString(record.id) ?? fileId,
    deleted: record.deleted === true,
  };
}
