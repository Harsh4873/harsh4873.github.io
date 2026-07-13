import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalPaperAnalysisInput } from './local-analysis';

vi.mock('./pdf', () => ({ PdfSession: { open: vi.fn() } }));

import { analyzeInBackground } from './local-analysis-browser';

const input: LocalPaperAnalysisInput = {
  title: 'Worker fallback paper',
  fileName: 'worker-paper.pdf',
  pages: [{
    page: 1,
    text: '',
    lines: [
      'Abstract',
      'We propose a deterministic method for organizing research evidence with page-level receipts.',
      'Results',
      'The method achieves 97 percent receipt accuracy in this evaluation.',
    ],
  }],
};

class WorkerHarness {
  static latest?: WorkerHarness;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  terminate = vi.fn();

  constructor() {
    WorkerHarness.latest = this;
  }

  postMessage(_message: unknown) {
    // Individual tests decide whether the worker fails or hangs.
  }
}

afterEach(() => {
  vi.useRealTimers();
  WorkerHarness.latest = undefined;
  vi.unstubAllGlobals();
});

describe('local analysis worker client', () => {
  it('falls back safely when a module worker fails to load asynchronously', async () => {
    class LoadFailureWorker extends WorkerHarness {
      override postMessage() {
        queueMicrotask(() => this.onerror?.({
          message: 'Module worker blocked',
          preventDefault: vi.fn(),
        } as unknown as ErrorEvent));
      }
    }
    vi.stubGlobal('Worker', LoadFailureWorker);

    const analysis = await analyzeInBackground(input);

    expect(analysis.title).toBe('Worker fallback paper');
    expect(analysis.overview).toContain('deterministic method');
    expect(WorkerHarness.latest?.terminate).toHaveBeenCalledOnce();
  });

  it('falls back when the browser cannot deserialize a worker response', async () => {
    class MessageFailureWorker extends WorkerHarness {
      override postMessage() {
        queueMicrotask(() => this.onmessageerror?.(new MessageEvent('messageerror')));
      }
    }
    vi.stubGlobal('Worker', MessageFailureWorker);

    await expect(analyzeInBackground(input)).resolves.toMatchObject({ title: 'Worker fallback paper' });
    expect(WorkerHarness.latest?.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a hanging worker immediately when the user cancels', async () => {
    vi.stubGlobal('Worker', WorkerHarness);
    const controller = new AbortController();

    const analyzing = analyzeInBackground(input, controller.signal);
    controller.abort();

    await expect(analyzing).rejects.toMatchObject({ name: 'AbortError' });
    expect(WorkerHarness.latest?.terminate).toHaveBeenCalledOnce();
  });

  it('rejects and terminates a worker that exceeds the local-analysis timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', WorkerHarness);

    const analyzing = analyzeInBackground(input);
    const rejection = expect(analyzing).rejects.toThrow('Local analysis took too long');
    await vi.advanceTimersByTimeAsync(120_000);

    await rejection;
    expect(WorkerHarness.latest?.terminate).toHaveBeenCalledOnce();
  });
});
