import type { PaperAnalysis } from '../model';

export interface LocalAnalysisProgress {
  progress: number;
  stage: string;
}

export interface AnalyzePdfLocallyInput {
  pdf: Blob;
  title: string;
  fileName: string;
  signal?: AbortSignal;
  onProgress?: (update: LocalAnalysisProgress) => void;
}

interface BrowserExtractedPage {
  page: number;
  text: string;
  lines: string[];
}

interface BrowserPdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  pageCount: number;
}

interface BrowserOutlineItem {
  title: string;
  page?: number;
  depth?: number;
}

export interface LocalAnalysisBrowserSession {
  readonly pageCount: number;
  metadata(): Promise<BrowserPdfMetadata>;
  outline(): Promise<BrowserOutlineItem[]>;
  extractedPage(page: number): Promise<BrowserExtractedPage>;
  releaseExtractedPage?(page: number): void;
  close(): Promise<void>;
  destroy(): void;
}

export interface LocalAnalysisBrowserDependencies {
  openPdf(pdf: Blob, signal?: AbortSignal): Promise<LocalAnalysisBrowserSession>;
  analyzeExtracted(input: {
    pages: BrowserExtractedPage[];
    title: string;
    fileName: string;
    metadata: BrowserPdfMetadata;
    outline: BrowserOutlineItem[];
  }, signal?: AbortSignal): PaperAnalysis | Promise<PaperAnalysis>;
  yieldControl?(signal?: AbortSignal): Promise<void>;
}

function abortError() {
  return new DOMException('Local PDF analysis cancelled.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function report(
  callback: AnalyzePdfLocallyInput['onProgress'],
  progress: number,
  stage: string,
) {
  callback?.({ progress: Math.max(0, Math.min(100, Math.round(progress))), stage });
}

async function defaultYield(signal?: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  throwIfAborted(signal);
}

/** Dependency-injected implementation kept separate for deterministic Node tests. */
export async function analyzePdfLocallyWithDependencies(
  { pdf, title, fileName, signal, onProgress }: AnalyzePdfLocallyInput,
  dependencies: LocalAnalysisBrowserDependencies,
): Promise<PaperAnalysis> {
  throwIfAborted(signal);
  report(onProgress, 1, 'Opening PDF locally…');

  const session = await dependencies.openPdf(pdf, signal);
  let sessionClosed = false;
  const closeSession = async () => {
    if (sessionClosed) return;
    sessionClosed = true;
    try {
      await session.close();
    } catch {
      // Cleanup is best-effort and must not replace the analysis/abort result.
      session.destroy();
    }
  };
  const abortSession = () => session.destroy();
  signal?.addEventListener('abort', abortSession, { once: true });
  try {
    throwIfAborted(signal);
    report(onProgress, 5, 'Reading document details…');
    const [metadata, outline] = await Promise.all([session.metadata(), session.outline()]);
    throwIfAborted(signal);

    const pages: BrowserExtractedPage[] = [];
    const totalPages = session.pageCount;
    for (let page = 1; page <= totalPages; page += 1) {
      throwIfAborted(signal);
      report(onProgress, 8 + ((page - 1) / Math.max(1, totalPages)) * 76, `Reading page ${page} of ${totalPages}…`);
      const extracted = await session.extractedPage(page);
      throwIfAborted(signal);
      // Lines are the lossless source for the engine. Avoid cloning the same
      // page text twice into the analysis worker on memory-constrained phones.
      pages.push({ ...extracted, text: extracted.lines.length ? '' : extracted.text });
      session.releaseExtractedPage?.(page);
      report(onProgress, 8 + (page / Math.max(1, totalPages)) * 76, `Read page ${page} of ${totalPages}`);
      await (dependencies.yieldControl ?? defaultYield)(signal);
      throwIfAborted(signal);
    }

    await closeSession();
    signal?.removeEventListener('abort', abortSession);
    throwIfAborted(signal);
    report(onProgress, 90, 'Building the local research brief…');
    const analysis = await dependencies.analyzeExtracted({ pages, title, fileName, metadata, outline }, signal);
    throwIfAborted(signal);
    report(onProgress, 100, 'Local analysis ready');
    return analysis;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abortSession);
    await closeSession();
  }
}
