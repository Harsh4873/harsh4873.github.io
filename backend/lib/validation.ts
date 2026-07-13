import { getMaxPdfBytes } from "./config.js";
import { HttpError } from "./http.js";

export interface UploadStartInput {
  bytes: number;
  filename: string;
  mimeType: "application/pdf";
}

export interface UploadCompleteInput {
  uploadId: string;
  partIds: string[];
}

export interface SummarizeInput {
  fileId: string;
  metadata: Record<string, unknown>;
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
  fileId: string;
  paperId?: string;
  question: string;
  context: AskContext;
  recentMessages: AskMessage[];
}

export interface DeleteFileInput {
  fileId: string;
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
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(normalized)) {
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

export function parseUploadStart(value: unknown): UploadStartInput {
  const body = objectValue(value);
  const requestedFilename = requiredString(body, "filename", 1_000);
  const mimeType = requiredString(body, "mimeType", 100).toLowerCase();
  const bytes = body.bytes;
  if (
    mimeType !== "application/pdf" ||
    /[\\/]/.test(requestedFilename) ||
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > getMaxPdfBytes()
  ) {
    throw new HttpError(400, "invalid_pdf", "Choose a PDF no larger than 50 MiB.");
  }
  const filename = requestedFilename.toLowerCase().endsWith(".pdf")
    ? requestedFilename
    : `${requestedFilename.slice(0, 996).trimEnd()}.pdf`;
  return { filename, mimeType: "application/pdf", bytes };
}

export function parseUploadId(value: unknown): string {
  if (typeof value !== "string" || !/^upload[_-][A-Za-z0-9_-]{6,180}$/.test(value)) {
    throw new HttpError(400, "invalid_upload_id", "The upload identifier is invalid.");
  }
  return value;
}

export function parseFileId(value: unknown): string {
  if (typeof value !== "string" || !/^file-[A-Za-z0-9_-]{6,180}$/.test(value)) {
    throw new HttpError(400, "invalid_file_id", "The file identifier is invalid.");
  }
  return value;
}

export function parseUploadComplete(value: unknown): UploadCompleteInput {
  const body = objectValue(value);
  const uploadId = parseUploadId(body.uploadId);
  if (!Array.isArray(body.partIds) || body.partIds.length < 1 || body.partIds.length > 512) {
    throw new HttpError(400, "invalid_parts", "One or more upload parts are invalid.");
  }
  const partIds = body.partIds.map((partId) => {
    if (typeof partId !== "string" || !/^part[_-][A-Za-z0-9_-]{6,180}$/.test(partId)) {
      throw new HttpError(400, "invalid_parts", "One or more upload parts are invalid.");
    }
    return partId;
  });
  if (new Set(partIds).size !== partIds.length) {
    throw new HttpError(400, "invalid_parts", "Upload part identifiers must be unique and ordered.");
  }
  return { uploadId, partIds };
}

export function parseSummarize(value: unknown): SummarizeInput {
  const body = objectValue(value);
  const fileId = parseFileId(body.fileId);
  const metadataRaw = body.metadata ?? {};
  const metadata = objectValue(metadataRaw);
  boundedJson(metadata, 16 * 1024, "metadata");

  const result: SummarizeInput = { fileId, metadata };
  if (body.localOutline !== undefined && body.localOutline !== null) {
    result.localOutline = boundedJson(body.localOutline, 32 * 1024, "localOutline");
  }
  return result;
}

export function parseAsk(value: unknown): AskInput {
  const body = objectValue(value);
  const fileId = parseFileId(body.fileId);
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

  const result: AskInput = { fileId, question, context, recentMessages };
  if (paperId) result.paperId = paperId;
  return result;
}

export function parseDeleteFile(value: unknown): DeleteFileInput {
  const body = objectValue(value);
  return { fileId: parseFileId(body.fileId) };
}
