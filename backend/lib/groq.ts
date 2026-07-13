import { getGroqConfig } from "./config.js";
import { HttpError } from "./http.js";
import { ASK_SYSTEM_PROMPT, buildAskRequest, buildSummaryRequest, SUMMARY_SYSTEM_PROMPT } from "./prompts.js";
import {
  contextualAnswerJsonSchema,
  paperAnalysisJsonSchema,
  parsePaperAnalysisResult,
  StructuredOutputValidationError,
} from "./schemas.js";
import type { AskInput, SummarizeInput } from "./validation.js";

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const MAX_UPSTREAM_RESPONSE_BYTES = 8 * 1024 * 1024;

type ReasoningEffort = "low" | "medium" | "high";

interface GroqErrorBody {
  error?: {
    code?: unknown;
    type?: unknown;
  };
}

interface GroqResponseBody {
  id?: unknown;
  model?: unknown;
  choices?: unknown;
  usage?: unknown;
}

interface GroqUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StructuredResponse<T> {
  value: T;
  responseId: string | null;
  model: string;
  usage: GroqUsage | null;
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
): HttpError {
  let code: string | undefined;
  let type: string | undefined;
  try {
    const parsed = JSON.parse(rawBody) as GroqErrorBody;
    code = nonEmptyString(parsed.error?.code);
    type = nonEmptyString(parsed.error?.type);
  } catch {
    // Deliberately ignore the upstream text. It must never be reflected to the browser or logs.
  }

  console.error("sift_groq_request_failed", {
    requestId,
    upstreamRequestId,
    status,
    upstreamCode: code,
    upstreamType: type,
  });

  if (status === 429) {
    return new HttpError(503, "ai_busy", "The AI service is busy. Please try again shortly.");
  }
  if (status === 401 || status === 403) {
    return new HttpError(503, "ai_configuration_error", "AI analysis is not configured correctly.");
  }
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return new HttpError(422, "ai_rejected_request", "The AI service could not process this paper request.");
  }
  return new HttpError(502, "ai_unavailable", "The AI service could not complete the request.");
}

async function groqRequest(
  path: string,
  init: RequestInit,
  requestId: string,
): Promise<unknown> {
  const { apiKey, baseUrl, timeoutMs } = getGroqConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  headers.set("X-Client-Request-Id", requestId);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
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
    throw upstreamError(response.status, text, requestId, response.headers.get("x-request-id"));
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  }
}

function extractMessageContent(response: GroqResponseBody): string {
  if (!Array.isArray(response.choices) || response.choices.length === 0) {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");
  }
  const choice = objectRecord(response.choices[0]);
  if (nonEmptyString(choice?.finish_reason) === "length") {
    throw new HttpError(502, "invalid_ai_response", "The AI service returned a truncated response.");
  }
  const message = objectRecord(choice?.message);
  const content = message?.content;
  if (typeof content === "string" && content.trim()) return content;

  // Defensive: some OpenAI-compatible surfaces return content as an array of parts.
  if (Array.isArray(content)) {
    const pieces: string[] = [];
    for (const part of content) {
      const item = objectRecord(part);
      if (typeof item?.text === "string") pieces.push(item.text);
    }
    const joined = pieces.join("");
    if (joined.trim()) return joined;
  }

  throw new HttpError(502, "invalid_ai_response", "The AI service returned an empty response.");
}

function normalizeUsage(value: unknown): GroqUsage | null {
  const usage = objectRecord(value);
  const inputTokens = numericValue(usage?.prompt_tokens);
  const outputTokens = numericValue(usage?.completion_tokens);
  const totalTokens = numericValue(usage?.total_tokens);
  if (inputTokens === null || outputTokens === null || totalTokens === null) return null;
  return { inputTokens, outputTokens, totalTokens };
}

async function structuredCompletion<T>(
  systemPrompt: string,
  userPrompt: string,
  schemaName: string,
  schema: unknown,
  maximumOutputTokens: number,
  reasoningEffort: ReasoningEffort,
  requestId: string,
): Promise<StructuredResponse<T>> {
  const { model } = getGroqConfig();
  const raw = await groqRequest(
    CHAT_COMPLETIONS_PATH,
    {
      method: "POST",
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: maximumOutputTokens,
        reasoning_effort: reasoningEffort,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
    },
    requestId,
  );
  const response = objectRecord(raw) as GroqResponseBody | undefined;
  if (!response) throw new HttpError(502, "invalid_ai_response", "The AI service returned an invalid response.");

  let value: T;
  try {
    value = JSON.parse(extractMessageContent(response)) as T;
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

export async function summarizePaper(
  input: SummarizeInput,
  requestId: string,
): Promise<StructuredResponse<Record<string, unknown>>> {
  const result = await structuredCompletion<unknown>(
    SUMMARY_SYSTEM_PROMPT,
    buildSummaryRequest(input),
    "sift_paper_analysis",
    paperAnalysisJsonSchema,
    32_000,
    "medium",
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

export async function answerFromPaper(
  input: AskInput,
  requestId: string,
): Promise<StructuredResponse<Record<string, unknown>>> {
  return structuredCompletion(
    ASK_SYSTEM_PROMPT,
    buildAskRequest(input),
    "sift_contextual_answer",
    contextualAnswerJsonSchema,
    8_000,
    "low",
    requestId,
  );
}
