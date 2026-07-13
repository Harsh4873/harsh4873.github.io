import { HttpError } from "./http.js";

// The frontend extracts selectable text on the device and sends it per page so
// the model keeps 1-indexed PDF page provenance. These ceilings are defence in
// depth; the client trims the paper to a smaller budget before it uploads.
export const MAX_PAPER_PAGES = 3_000;
export const MAX_PAGE_TEXT_CHARS = 200_000;
export const MAX_TOTAL_PAPER_TEXT_CHARS = 500_000;

export interface PaperPage {
  page: number;
  text: string;
}

export interface SummarizeInput {
  pages: PaperPage[];
  metadata: Record<string, unknown>;
  truncated: boolean;
  localOutline?: unknown;
}

export interface AskContext {
  currentTab?: string;
  currentPage?: number;
  activeSection?: string;
  selectedText?: string;
  visibleText?: string;
}

export interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskInput {
  pages: PaperPage[];
  paperId?: string;
  question: string;
  context: AskContext;
  recentMessages: AskMessage[];
  truncated: boolean;
}

// Reject C0 control characters other than tab, newline, and carriage return,
// which could otherwise corrupt prompts or logs.
function isForbiddenControlCode(code: number): boolean {
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
}

function hasForbiddenControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isForbiddenControlCode(value.charCodeAt(index))) return true;
  }
  return false;
}

function stripForbiddenControlChars(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    result += isForbiddenControlCode(value.charCodeAt(index)) ? " " : value.charAt(index);
  }
  return result;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", "The request body has an invalid shape.");
  }
  return value as Record<string, unknown>;
}

function requiredString(
  object: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = object[key];
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${key} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || hasForbiddenControlChars(normalized)) {
    throw new HttpError(400, "invalid_request", `${key} is invalid.`);
  }
  return normalized;
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | undefined {
  const value = object[key];
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(object, key, maximumLength);
}

function boundedJson(value: unknown, maximumBytes: number, fieldName: string): unknown {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new HttpError(400, "invalid_request", `${fieldName} must be valid JSON.`);
  }
  if (Buffer.byteLength(encoded) > maximumBytes) {
    throw new HttpError(400, "invalid_request", `${fieldName} is too large.`);
  }
  return value;
}

export function parsePaperPages(value: unknown): PaperPage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PAPER_PAGES) {
    throw new HttpError(400, "invalid_request", "The paper text is missing or has too many pages.");
  }

  let totalChars = 0;
  const pages = value.map((entry): PaperPage => {
    const record = objectValue(entry);
    const page = record.page;
    if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > 100_000) {
      throw new HttpError(400, "invalid_request", "A paper page number is invalid.");
    }
    if (typeof record.text !== "string") {
      throw new HttpError(400, "invalid_request", "A paper page is missing its text.");
    }
    const text = stripForbiddenControlChars(record.text);
    if (text.length > MAX_PAGE_TEXT_CHARS) {
      throw new HttpError(400, "invalid_request", "A paper page is too large.");
    }
    totalChars += text.length;
    if (totalChars > MAX_TOTAL_PAPER_TEXT_CHARS) {
      throw new HttpError(400, "invalid_request", "The paper text is too large.");
    }
    return { page, text };
  });

  if (!pages.some((entry) => entry.text.trim().length > 0)) {
    throw new HttpError(
      422,
      "no_extractable_text",
      "No selectable text could be read from this PDF. It may be scanned or image-only.",
    );
  }
  return pages;
}

export function parseSummarize(value: unknown): SummarizeInput {
  const body = objectValue(value);
  const pages = parsePaperPages(body.pages);
  const metadata = objectValue(body.metadata ?? {});
  boundedJson(metadata, 16 * 1024, "metadata");

  const result: SummarizeInput = { pages, metadata, truncated: body.truncated === true };
  if (body.localOutline !== undefined && body.localOutline !== null) {
    result.localOutline = boundedJson(body.localOutline, 32 * 1024, "localOutline");
  }
  return result;
}

export function parseAsk(value: unknown): AskInput {
  const body = objectValue(value);
  const pages = parsePaperPages(body.pages);
  const paperId = optionalString(body, "paperId", 180);
  const question = requiredString(body, "question", 4_000);
  const rawContext = body.context === undefined ? {} : objectValue(body.context);
  const context: AskContext = {};
  const currentTab = optionalString(rawContext, "currentTab", 80);
  const activeSection = optionalString(rawContext, "activeSection", 300);
  const selectedText = optionalString(rawContext, "selectedText", 8_000);
  const visibleText = optionalString(rawContext, "visibleText", 12_000);
  if (currentTab) context.currentTab = currentTab;
  if (activeSection) context.activeSection = activeSection;
  if (selectedText) context.selectedText = selectedText;
  if (visibleText) context.visibleText = visibleText;

  if (rawContext.currentPage !== undefined && rawContext.currentPage !== null) {
    if (
      typeof rawContext.currentPage !== "number" ||
      !Number.isSafeInteger(rawContext.currentPage) ||
      rawContext.currentPage < 1 ||
      rawContext.currentPage > 100_000
    ) {
      throw new HttpError(400, "invalid_request", "currentPage is invalid.");
    }
    context.currentPage = rawContext.currentPage;
  }

  const rawMessages = body.recentMessages ?? [];
  if (!Array.isArray(rawMessages) || rawMessages.length > 12) {
    throw new HttpError(400, "invalid_request", "recentMessages is invalid.");
  }
  const recentMessages = rawMessages.map((message) => {
    const item = objectValue(message);
    if (item.role !== "user" && item.role !== "assistant") {
      throw new HttpError(400, "invalid_request", "A recent message has an invalid role.");
    }
    return {
      role: item.role,
      content: requiredString(item, "content", 4_000),
    } satisfies AskMessage;
  });

  const result: AskInput = { pages, question, context, recentMessages, truncated: body.truncated === true };
  if (paperId) result.paperId = paperId;
  return result;
}
