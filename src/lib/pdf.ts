import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractPdfTextLines } from './pdf-text-extraction';
import type { PdfOutlineItem, PdfSearchHit } from './ui-types';

export { extractPdfTextLines } from './pdf-text-extraction';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  pageCount: number;
}

export interface PageRenderOptions {
  canvas: HTMLCanvasElement;
  page: number;
  scale: number;
  signal?: AbortSignal;
}

export interface ExtractedPdfPage {
  page: number;
  text: string;
  lines: string[];
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function safeMetadataValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pdfAbortError() {
  return new DOMException('PDF loading cancelled.', 'AbortError');
}

async function destinationPage(document: PDFDocumentProxy, destination: unknown) {
  try {
    const resolved = typeof destination === 'string' ? await document.getDestination(destination) : destination;
    if (!Array.isArray(resolved) || !resolved[0]) return undefined;
    const reference = resolved[0];
    if (typeof reference === 'number') return reference + 1;
    return (await document.getPageIndex(reference)) + 1;
  } catch {
    return undefined;
  }
}

export class PdfSession {
  private static readonly EXTRACTION_CACHE_LIMIT = 12;
  readonly document: PDFDocumentProxy;
  private readonly loadingTask: PDFDocumentLoadingTask;
  private readonly extractionCache = new Map<number, ExtractedPdfPage>();
  private destruction?: Promise<void>;

  private constructor(document: PDFDocumentProxy, loadingTask: PDFDocumentLoadingTask) {
    this.document = document;
    this.loadingTask = loadingTask;
  }

  static async open(blob: Blob, signal?: AbortSignal) {
    if (signal?.aborted) throw pdfAbortError();
    let bytes: ArrayBuffer;
    try {
      bytes = await blob.arrayBuffer();
    } catch (error) {
      if (signal?.aborted) throw pdfAbortError();
      throw error;
    }
    if (signal?.aborted) throw pdfAbortError();
    const task = getDocument({ data: bytes, useSystemFonts: true });
    let destruction: Promise<void> | undefined;
    const destroyTask = () => destruction ??= task.destroy();
    const abort = () => void destroyTask();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const document = await task.promise;
      if (signal?.aborted) throw pdfAbortError();
      return new PdfSession(document, task);
    } catch (error) {
      await destroyTask().catch(() => undefined);
      if (signal?.aborted) throw pdfAbortError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  get pageCount() {
    return this.document.numPages;
  }

  async metadata(): Promise<PdfMetadata> {
    const raw = await this.document.getMetadata();
    const info = raw.info as Record<string, unknown>;
    return {
      title: safeMetadataValue(info.Title),
      author: safeMetadataValue(info.Author),
      subject: safeMetadataValue(info.Subject),
      pageCount: this.pageCount,
    };
  }

  async outline(): Promise<PdfOutlineItem[]> {
    const outline = await this.document.getOutline();
    if (!outline?.length) return [];
    const result: PdfOutlineItem[] = [];
    const visit = async (items: typeof outline, depth: number) => {
      for (const item of items) {
        result.push({ title: normalizeWhitespace(item.title) || 'Untitled section', page: await destinationPage(this.document, item.dest), depth });
        if (item.items?.length) await visit(item.items, depth + 1);
      }
    };
    await visit(outline, 0);
    return result;
  }

  async extractedPage(pageNumber: number): Promise<ExtractedPdfPage> {
    const safePage = Math.min(Math.max(1, pageNumber), this.pageCount);
    const cached = this.extractionCache.get(safePage);
    if (cached !== undefined) {
      this.extractionCache.delete(safePage);
      this.extractionCache.set(safePage, cached);
      return { ...cached, lines: [...cached.lines] };
    }
    const page = await this.document.getPage(safePage);
    try {
      const content = await page.getTextContent();
      const lines = extractPdfTextLines(content.items);
      const extracted = { page: safePage, text: normalizeWhitespace(lines.join(' ')), lines };
      this.extractionCache.set(safePage, extracted);
      while (this.extractionCache.size > PdfSession.EXTRACTION_CACHE_LIMIT) {
        const oldest = this.extractionCache.keys().next().value;
        if (oldest === undefined) break;
        this.extractionCache.delete(oldest);
      }
      return { ...extracted, lines: [...lines] };
    } finally {
      page.cleanup();
    }
  }

  async pageLines(pageNumber: number) {
    return (await this.extractedPage(pageNumber)).lines;
  }

  releaseExtractedPage(pageNumber: number) {
    this.extractionCache.delete(Math.min(Math.max(1, pageNumber), this.pageCount));
  }

  async pageText(pageNumber: number) {
    return (await this.extractedPage(pageNumber)).text;
  }

  async search(query: string, signal?: AbortSignal): Promise<PdfSearchHit[]> {
    const needle = normalizeWhitespace(query).toLocaleLowerCase();
    if (needle.length < 2) return [];
    const hits: PdfSearchHit[] = [];
    for (let page = 1; page <= this.pageCount; page += 1) {
      if (signal?.aborted) throw new DOMException('Search cancelled.', 'AbortError');
      const text = await this.pageText(page);
      const lower = text.toLocaleLowerCase();
      let position = lower.indexOf(needle);
      if (position < 0) continue;
      let count = 0;
      while (position >= 0) {
        count += 1;
        position = lower.indexOf(needle, position + needle.length);
      }
      const first = lower.indexOf(needle);
      const start = Math.max(0, first - 75);
      const end = Math.min(text.length, first + needle.length + 110);
      hits.push({
        page,
        matches: count,
        excerpt: `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
      });
    }
    return hits;
  }

  async renderPage({ canvas, page, scale, signal }: PageRenderOptions) {
    const pdfPage = await this.document.getPage(Math.min(Math.max(1, page), this.pageCount));
    try {
      if (signal?.aborted) throw new DOMException('Page render cancelled.', 'AbortError');
      const viewport = pdfPage.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Your browser could not create a PDF canvas.');
      const render = pdfPage.render({
        canvasContext: context,
        canvas,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      const cancel = () => render.cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        await render.promise;
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'RenderingCancelledException')) return;
        throw error;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    } finally {
      pdfPage.cleanup();
    }
  }

  async thumbnail(pageNumber: number, maxWidth = 132) {
    const page = await this.document.getPage(pageNumber);
    try {
      const original = page.getViewport({ scale: 1 });
      const scale = maxWidth / original.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return undefined;
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.72);
    } finally {
      page.cleanup();
    }
  }

  async close() {
    this.extractionCache.clear();
    this.destruction ??= this.loadingTask.destroy();
    await this.destruction;
  }

  destroy() {
    void this.close().catch(() => undefined);
  }
}

export function fitScale(page: PDFPageProxy, availableWidth: number, padding = 48) {
  const viewport = page.getViewport({ scale: 1 });
  return Math.max(0.5, Math.min(2.4, (availableWidth - padding) / viewport.width));
}
