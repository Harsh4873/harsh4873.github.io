import { PaperAnalysisSchema, type PaperAnalysis } from '../model';
import type { ReaderContext, UiMessage } from './ui-types';

export const PDF_UPLOAD_CHUNK_BYTES = 2_500_000;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const ASK_SELECTED_TEXT_MAX_LENGTH = 8_000;
export const ASK_RECENT_MESSAGE_MAX_LENGTH = 4_000;
const DEFAULT_API_ORIGIN = 'https://sift-research-api.vercel.app';

export interface TokenUser {
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export interface UploadProgress {
  stage: 'preparing' | 'uploading' | 'finishing';
  uploadedBytes: number;
  totalBytes: number;
  completedParts: number;
  totalParts: number;
}

export interface UploadedPdf {
  uploadId: string;
  fileId: string;
}

export interface AnalysisResponse {
  analysis: PaperAnalysis;
  model?: string;
  requestId?: string;
}

export interface AskResponse {
  answer: string;
  citations: Array<{ page: number; label?: string; quote?: string }>;
  grounded?: boolean;
  uncertainty?: string;
  followUps?: string[];
  model?: string;
  requestId?: string;
}

interface BackendAnalysisResponse {
  analysis?: PaperAnalysis;
  responseId?: string;
  requestId?: string;
  model?: string;
}

interface BackendAskResponse {
  answer?: string | {
    answer?: string;
    evidence?: unknown;
    grounded?: boolean;
    uncertainty?: string;
    followUps?: unknown;
  };
  citations?: unknown;
  responseId?: string;
  requestId?: string;
  model?: string;
}

function normalizedCitations(value: unknown): AskResponse['citations'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    if (!Number.isInteger(raw.page) || (raw.page as number) < 1) return [];
    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 500) : undefined;
    const quote = typeof raw.quote === 'string' && raw.quote.trim() ? raw.quote.trim().slice(0, 10_000) : undefined;
    return [{ page: raw.page as number, label, quote }];
  }).slice(0, 200);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  retryAfter?: number;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

interface RequestOptions extends RequestInit {
  retry?: boolean;
}

interface StartUploadResponse {
  uploadId?: string;
  id?: string;
  upload?: { id?: string };
}

interface PartResponse {
  partId?: string;
  id?: string;
  part?: { id?: string };
}

interface CompleteUploadResponse {
  fileId?: string;
  id?: string;
  file?: { id?: string };
}

interface DeleteFileResponse {
  id?: string;
  deleted?: boolean;
}

function apiOrigin() {
  const configured = import.meta.env.VITE_RESEARCH_API_URL as string | undefined;
  return (configured?.trim() || DEFAULT_API_ORIGIN).replace(/\/$/, '');
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    }, { once: true });
  });
}

function retryDelay(attempt: number, retryAfter?: number) {
  if (retryAfter && Number.isFinite(retryAfter)) return Math.min(retryAfter * 1000, 10_000);
  return Math.min(400 * (2 ** attempt) + Math.round(Math.random() * 180), 5_000);
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined;
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function responseError(response: Response, body?: Record<string, unknown>) {
  const nested = body?.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : undefined;
  const code = typeof body?.code === 'string' ? body.code : typeof nested?.code === 'string' ? nested.code : undefined;
  const message = code === 'openai_quota_required'
    ? 'AI is connected, but API billing or credits need attention. Your local PDF, notes, and library are still available.'
    : typeof body?.message === 'string' ? body.message
    : typeof nested?.message === 'string' ? nested.message
      : response.status === 401 || response.status === 403 ? 'Your private Sift session expired. Sign in again and retry.'
        : response.status === 413 ? 'That upload part was too large. Sift will retry with a smaller part.'
          : response.status === 429 ? 'The research assistant is busy. Wait a moment, then retry.'
            : response.status >= 500 ? 'The research assistant is temporarily unavailable.'
              : `Sift could not complete the request (${response.status}).`;
  const retryHeader = Number(response.headers.get('retry-after'));
  return new ApiError(message, response.status, code, Number.isFinite(retryHeader) ? retryHeader : undefined);
}

function chunks(file: Blob, size = PDF_UPLOAD_CHUNK_BYTES) {
  const result: Blob[] = [];
  for (let start = 0; start < file.size; start += size) {
    result.push(file.slice(start, Math.min(start + size, file.size), 'application/octet-stream'));
  }
  return result;
}

export function uploadPartCount(bytes: number, chunkBytes = PDF_UPLOAD_CHUNK_BYTES) {
  if (bytes <= 0) return 0;
  return Math.ceil(bytes / chunkBytes);
}

export class SiftApiClient {
  private readonly user: TokenUser;

  constructor(user: TokenUser) {
    this.user = user;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const retry = options.retry ?? true;
    const token = await this.user.getIdToken();
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response | undefined;
    let refreshedToken = false;
    for (let attempt = 0; attempt < (retry ? 3 : 1); attempt += 1) {
      response = await fetch(`${apiOrigin()}${path}`, { ...options, headers });
      const body = await parseResponse(response);
      if (response.ok) return body as T;
      if (response.status === 401 && !refreshedToken && !options.signal?.aborted) {
        headers.set('Authorization', `Bearer ${await this.user.getIdToken(true)}`);
        refreshedToken = true;
        attempt -= 1;
        continue;
      }
      const error = responseError(response, body);
      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt === 2 || options.signal?.aborted) throw error;
      await delay(retryDelay(attempt, error.retryAfter), options.signal ?? undefined);
    }
    throw response ? responseError(response) : new ApiError('Sift could not reach the research assistant.', 0);
  }

  async uploadPdf(file: File, onProgress?: (progress: UploadProgress) => void, signal?: AbortSignal): Promise<UploadedPdf> {
    if (file.type && file.type !== 'application/pdf') throw new ApiError('Sift currently accepts PDF papers only.', 400, 'invalid_file_type');
    if (!file.size) throw new ApiError('That PDF is empty.', 400, 'empty_file');
    if (file.size > MAX_PDF_BYTES) throw new ApiError('That PDF is over Sift’s 50 MB limit.', 400, 'file_too_large');

    const parts = chunks(file);
    onProgress?.({ stage: 'preparing', uploadedBytes: 0, totalBytes: file.size, completedParts: 0, totalParts: parts.length });
    const started = await this.request<StartUploadResponse>('/api/upload/start', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, bytes: file.size, mimeType: 'application/pdf' }),
      signal,
      retry: false,
    });
    const uploadId = started.uploadId ?? started.upload?.id ?? started.id;
    if (!uploadId) throw new ApiError('The upload session did not return an ID.', 502, 'missing_upload_id');

    const partIds: string[] = [];
    let uploadedBytes = 0;
    for (let index = 0; index < parts.length; index += 1) {
      if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
      const part = parts[index];
      const response = await this.request<PartResponse>(`/api/upload/part?uploadId=${encodeURIComponent(uploadId)}&index=${index}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: part,
        signal,
      });
      const partId = response.partId ?? response.part?.id ?? response.id;
      if (!partId) throw new ApiError(`Upload part ${index + 1} did not return an ID.`, 502, 'missing_part_id');
      partIds.push(partId);
      uploadedBytes += part.size;
      onProgress?.({
        stage: 'uploading',
        uploadedBytes,
        totalBytes: file.size,
        completedParts: index + 1,
        totalParts: parts.length,
      });
    }

    onProgress?.({ stage: 'finishing', uploadedBytes: file.size, totalBytes: file.size, completedParts: parts.length, totalParts: parts.length });
    const completed = await this.request<CompleteUploadResponse>('/api/upload/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId, partIds }),
      signal,
      retry: false,
    });
    const fileId = completed.fileId ?? completed.file?.id ?? completed.id;
    if (!fileId) throw new ApiError('The completed upload did not return a file ID.', 502, 'missing_file_id');
    return { uploadId, fileId };
  }

  async analyze(fileId: string, paper: { title?: string; authors?: string[]; pageCount?: number }, signal?: AbortSignal): Promise<AnalysisResponse> {
    const response = await this.request<BackendAnalysisResponse>('/api/summarize', {
      method: 'POST',
      body: JSON.stringify({ fileId, metadata: paper }),
      signal,
      retry: false,
    });
    if (!response.analysis) throw new ApiError('The analysis response was incomplete. Your PDF was not changed.', 502, 'missing_analysis');
    const parsed = PaperAnalysisSchema.safeParse(response.analysis);
    if (!parsed.success) throw new ApiError('The analysis response could not be verified. Your PDF was not changed.', 502, 'invalid_analysis');
    return { analysis: parsed.data, model: response.model, requestId: response.requestId ?? response.responseId };
  }

  async ask(input: {
    fileId: string;
    paperId: string;
    question: string;
    context: ReaderContext;
    recentMessages: Pick<UiMessage, 'role' | 'content'>[];
  }, signal?: AbortSignal): Promise<AskResponse> {
    const recentMessages = input.recentMessages.map(({ role, content }) => ({
      role,
      content: content.slice(0, ASK_RECENT_MESSAGE_MAX_LENGTH),
    }));
    const response = await this.request<BackendAskResponse>('/api/ask', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        recentMessages,
        context: {
          currentTab: input.context.tab,
          currentPage: input.context.page,
          selectedText: input.context.selectedText.slice(0, ASK_SELECTED_TEXT_MAX_LENGTH) || undefined,
        },
      }),
      signal,
      retry: false,
    });
    const answer = typeof response.answer === 'string' ? response.answer : response.answer?.answer;
    if (!answer) throw new ApiError('The assistant returned an empty answer. Ask again in a moment.', 502, 'missing_answer');
    return {
      answer,
      citations: normalizedCitations(response.citations ?? (typeof response.answer === 'object' ? response.answer.evidence : undefined)),
      grounded: typeof response.answer === 'object' && typeof response.answer.grounded === 'boolean' ? response.answer.grounded : undefined,
      uncertainty: typeof response.answer === 'object' && typeof response.answer.uncertainty === 'string' ? response.answer.uncertainty.slice(0, 10_000) : undefined,
      followUps: typeof response.answer === 'object' && Array.isArray(response.answer.followUps)
        ? response.answer.followUps.filter((item): item is string => typeof item === 'string').slice(0, 12)
        : undefined,
      model: response.model,
      requestId: response.requestId ?? response.responseId,
    };
  }

  async deleteFile(fileId: string) {
    const response = await this.request<DeleteFileResponse>('/api/delete-file', {
      method: 'POST',
      body: JSON.stringify({ fileId }),
      retry: false,
    });
    if (response.deleted !== true) {
      throw new ApiError('The private AI copy could not be confirmed deleted.', 502, 'file_delete_failed');
    }
  }
}

export function apiDisplayHost() {
  try {
    return new URL(apiOrigin()).host;
  } catch {
    return 'secure AI service';
  }
}
