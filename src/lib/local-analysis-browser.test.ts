import { describe, expect, it, vi } from 'vitest';
import type { PaperAnalysis } from '../model';
import {
  analyzePdfLocallyWithDependencies,
  type LocalAnalysisBrowserDependencies,
  type LocalAnalysisBrowserSession,
  type LocalAnalysisProgress,
} from './local-analysis-browser-core';

function analysisFixture(): PaperAnalysis {
  return {
    title: 'Local paper',
    authors: [],
    paperType: 'Research paper',
    publication: { venue: null, year: null, doi: null, url: null },
    overview: 'Extractive overview.',
    researchQuestion: '',
    abstractSummary: '',
    methods: [],
    keyFindings: [],
    sectionSummaries: [],
    figures: [],
    tables: [],
    equations: [],
    limitations: [],
    glossary: [],
    references: [],
    sourceLedger: [],
    synthesis: { contribution: '', novelty: '', implications: [], openQuestions: [] },
    warnings: [],
  };
}

function sessionFixture(overrides: Partial<LocalAnalysisBrowserSession> = {}): LocalAnalysisBrowserSession {
  return {
    pageCount: 2,
    metadata: vi.fn(async () => ({ title: 'PDF title', author: 'Author', pageCount: 2 })),
    outline: vi.fn(async () => [{ title: 'Methods', page: 2, depth: 0 }]),
    extractedPage: vi.fn(async (page: number) => ({
      page,
      text: page === 1 ? 'Abstract First page.' : 'Methods Second page.',
      lines: page === 1 ? ['Abstract', 'First page.'] : ['Methods', 'Second page.'],
    })),
    releaseExtractedPage: vi.fn(),
    close: vi.fn(async () => undefined),
    destroy: vi.fn(),
    ...overrides,
  };
}

describe('local PDF analysis browser adapter', () => {
  it('extracts every page in order, yields between pages, and reports monotonic progress', async () => {
    const session = sessionFixture();
    const analysis = analysisFixture();
    const analyzeExtracted = vi.fn(() => analysis);
    const yieldControl = vi.fn(async () => undefined);
    const dependencies: LocalAnalysisBrowserDependencies = {
      openPdf: vi.fn(async () => session),
      analyzeExtracted,
      yieldControl,
    };
    const updates: LocalAnalysisProgress[] = [];

    const result = await analyzePdfLocallyWithDependencies({
      pdf: new Blob(['%PDF-test'], { type: 'application/pdf' }),
      title: 'Library title',
      fileName: 'paper.pdf',
      onProgress: (update) => updates.push(update),
    }, dependencies);

    expect(result).toBe(analysis);
    expect(session.extractedPage).toHaveBeenCalledTimes(2);
    expect(session.extractedPage).toHaveBeenNthCalledWith(1, 1);
    expect(session.extractedPage).toHaveBeenNthCalledWith(2, 2);
    expect(session.releaseExtractedPage).toHaveBeenNthCalledWith(1, 1);
    expect(session.releaseExtractedPage).toHaveBeenNthCalledWith(2, 2);
    expect(yieldControl).toHaveBeenCalledTimes(2);
    expect(analyzeExtracted).toHaveBeenCalledWith({
      pages: [
        { page: 1, text: '', lines: ['Abstract', 'First page.'] },
        { page: 2, text: '', lines: ['Methods', 'Second page.'] },
      ],
      title: 'Library title',
      fileName: 'paper.pdf',
      metadata: { title: 'PDF title', author: 'Author', pageCount: 2 },
      outline: [{ title: 'Methods', page: 2, depth: 0 }],
    }, undefined);
    expect(updates[0]).toEqual({ progress: 1, stage: 'Opening PDF locally…' });
    expect(updates.at(-1)).toEqual({ progress: 100, stage: 'Local analysis ready' });
    expect(updates.some((update) => update.stage === 'Reading page 2 of 2…')).toBe(true);
    expect(updates.every((update, index) => index === 0 || update.progress >= updates[index - 1]!.progress)).toBe(true);
    expect(session.close).toHaveBeenCalledOnce();
    expect(vi.mocked(session.close).mock.invocationCallOrder[0]).toBeLessThan(analyzeExtracted.mock.invocationCallOrder[0]!);
  });

  it('destroys an in-flight PDF session and returns AbortError during metadata extraction', async () => {
    const controller = new AbortController();
    const metadata = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('PDF.js worker stopped')), { once: true });
    });
    const session = sessionFixture({ metadata: vi.fn(() => metadata) });
    const opening = analyzePdfLocallyWithDependencies({
      pdf: new Blob(['%PDF-test']),
      title: 'Paper',
      fileName: 'paper.pdf',
      signal: controller.signal,
    }, {
      openPdf: vi.fn(async () => session),
      analyzeExtracted: vi.fn(() => analysisFixture()),
    });

    await Promise.resolve();
    controller.abort();

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.destroy).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('rejects with AbortError and cleans up when cancellation arrives during extraction', async () => {
    const controller = new AbortController();
    const session = sessionFixture({
      extractedPage: vi.fn(async (page: number) => {
        controller.abort();
        return { page, text: 'Partial page', lines: ['Partial page'] };
      }),
    });
    const analyzeExtracted = vi.fn(() => analysisFixture());

    await expect(analyzePdfLocallyWithDependencies({
      pdf: new Blob(['%PDF-test']),
      title: 'Paper',
      fileName: 'paper.pdf',
      signal: controller.signal,
    }, {
      openPdf: vi.fn(async () => session),
      analyzeExtracted,
      yieldControl: vi.fn(async () => undefined),
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(analyzeExtracted).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('falls back to fire-and-forget destruction if awaited cleanup fails', async () => {
    const session = sessionFixture({
      close: vi.fn(async () => { throw new Error('cleanup failed'); }),
    });
    const analysis = analysisFixture();

    await expect(analyzePdfLocallyWithDependencies({
      pdf: new Blob(['%PDF-test']),
      title: 'Paper',
      fileName: 'paper.pdf',
    }, {
      openPdf: vi.fn(async () => session),
      analyzeExtracted: vi.fn(() => analysis),
      yieldControl: vi.fn(async () => undefined),
    })).resolves.toBe(analysis);

    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it('passes cancellation into the asynchronous background-analysis phase', async () => {
    const controller = new AbortController();
    const session = sessionFixture({ pageCount: 1 });
    const analyzeExtracted = vi.fn((_input: unknown, signal?: AbortSignal) => new Promise<PaperAnalysis>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      controller.abort();
    }));

    await expect(analyzePdfLocallyWithDependencies({
      pdf: new Blob(['%PDF-test']),
      title: 'Paper',
      fileName: 'paper.pdf',
      signal: controller.signal,
    }, {
      openPdf: vi.fn(async () => session),
      analyzeExtracted,
      yieldControl: vi.fn(async () => undefined),
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(analyzeExtracted).toHaveBeenCalledOnce();
    expect(analyzeExtracted.mock.calls[0]?.[1]).toBe(controller.signal);
    expect(session.close).toHaveBeenCalledOnce();
  });
});
