import type { PaperAnalysis } from '../model';
import type { LocalPaperAnalysisInput } from './local-analysis';
import {
  analyzePdfLocallyWithDependencies,
  type AnalyzePdfLocallyInput,
  type LocalAnalysisProgress,
} from './local-analysis-browser-core';
import { PdfSession } from './pdf';

export type { AnalyzePdfLocallyInput, LocalAnalysisProgress } from './local-analysis-browser-core';

type WorkerResponse =
  | { ok: true; analysis: PaperAnalysis }
  | { ok: false; error: string };

function abortError() {
  return new DOMException('Local PDF analysis cancelled.', 'AbortError');
}

async function analyzeWithoutWorker(input: LocalPaperAnalysisInput, signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  if (signal?.aborted) throw abortError();
  const { analyzeExtractedPaper } = await import('./local-analysis');
  const result = analyzeExtractedPaper(input);
  if (signal?.aborted) throw abortError();
  return result;
}

const LOCAL_WORKER_TIMEOUT_MS = 120_000;

export function analyzeInBackground(input: LocalPaperAnalysisInput, signal?: AbortSignal): Promise<PaperAnalysis> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === 'undefined') return analyzeWithoutWorker(input, signal);

  let worker: Worker;
  try {
    worker = new Worker(new URL('./local-analysis-worker.ts', import.meta.url), { type: 'module', name: 'sift-local-analysis' });
  } catch {
    return analyzeWithoutWorker(input, signal);
  }
  return new Promise<PaperAnalysis>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      finish(() => reject(new Error('Local analysis took too long. The PDF is still saved; try again or use AI Analysis.')));
    }, LOCAL_WORKER_TIMEOUT_MS);
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const cancel = () => {
      finish(() => reject(abortError()));
    };
    const fallback = () => {
      finish(() => {
        void analyzeWithoutWorker(input, signal).then(resolve, reject);
      });
    };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data as WorkerResponse | undefined;
      finish(() => {
        if (!data || typeof data.ok !== 'boolean') reject(new Error('The local analysis worker returned an invalid response.'));
        else if (data.ok) resolve(data.analysis);
        else reject(new Error(data.error));
      });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fallback();
    };
    worker.onmessageerror = fallback;
    if (signal?.aborted) {
      cancel();
      return;
    }
    try {
      worker.postMessage(input);
    } catch {
      fallback();
    }
  });
}

/**
 * Analyze a PDF entirely in this browser. No bytes are uploaded by this path;
 * page extraction yields between pages and the session is always cleaned up.
 */
export function analyzePdfLocally(input: AnalyzePdfLocallyInput): Promise<PaperAnalysis> {
  return analyzePdfLocallyWithDependencies(input, {
    openPdf: (pdf, signal) => PdfSession.open(pdf, signal),
    analyzeExtracted: (analysisInput, signal) => analyzeInBackground(analysisInput, signal),
  });
}
