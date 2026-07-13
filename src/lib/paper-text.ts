import type { PaperPage } from './api';
import { PdfSession } from './pdf';

// Client-side budget for how much extracted paper text Sift sends to the AI
// backend. It stays under the server's per-page and total ceilings and leaves
// room in the model context window for the structured response.
export const MAX_PAPER_TEXT_CHARS = 360_000;
export const MAX_PAGE_TEXT_CHARS = 190_000;

export interface PageTextSource {
  pageCount: number;
  pageText(page: number): Promise<string>;
}

export interface CollectPaperOptions {
  maxChars?: number;
  signal?: AbortSignal;
  onProgress?: (page: number, pageCount: number) => void;
}

export interface CollectedPaper {
  pages: PaperPage[];
  truncated: boolean;
  totalChars: number;
}

/**
 * Walk a paper page by page, collecting non-empty extracted text up to a
 * character budget. Truncation (per page or overall) is reported so the request
 * and the prompt can note the resulting gaps instead of hiding them.
 */
export async function collectPaperPagesFrom(
  source: PageTextSource,
  options: CollectPaperOptions = {},
): Promise<CollectedPaper> {
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? MAX_PAPER_TEXT_CHARS));
  const pageCount = Math.max(0, Math.floor(source.pageCount));
  const pages: PaperPage[] = [];
  let totalChars = 0;
  let truncated = false;

  for (let page = 1; page <= pageCount; page += 1) {
    if (options.signal?.aborted) throw new DOMException('Text extraction cancelled.', 'AbortError');
    const raw = (await source.pageText(page)).trim();
    options.onProgress?.(page, pageCount);
    if (!raw) continue;

    const remaining = maxChars - totalChars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const limit = Math.min(remaining, MAX_PAGE_TEXT_CHARS);
    const text = raw.length > limit ? raw.slice(0, limit) : raw;
    if (text.length < raw.length) truncated = true;
    pages.push({ page, text });
    totalChars += text.length;
  }

  return { pages, truncated, totalChars };
}

/** Open a PDF blob and collect its extracted text within the send budget. */
export async function collectPaperPages(
  blob: Blob,
  options: CollectPaperOptions = {},
): Promise<CollectedPaper> {
  const session = await PdfSession.open(blob, options.signal);
  try {
    return await collectPaperPagesFrom(
      { pageCount: session.pageCount, pageText: (page) => session.pageText(page) },
      options,
    );
  } finally {
    await session.close().catch(() => undefined);
  }
}
