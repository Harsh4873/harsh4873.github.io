import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdfJs = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfJs.getDocument,
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.js' }));

import { PdfSession } from './pdf';

beforeEach(() => pdfJs.getDocument.mockReset());

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function openSessionWithPage(page: object) {
  const destroy = vi.fn(async () => undefined);
  const getPage = vi.fn(async () => page);
  pdfJs.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage }),
    destroy,
  });
  return {
    session: await PdfSession.open(new Blob(['%PDF-test'])),
    destroy,
    getPage,
  };
}

function canvasWithContext(context: CanvasRenderingContext2D | null) {
  return {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,test'),
  } as unknown as HTMLCanvasElement;
}

describe('PdfSession.open cancellation', () => {
  it('stops before PDF.js when cancellation arrives while reading blob bytes', async () => {
    const bytes = deferred<ArrayBuffer>();
    const blob = { arrayBuffer: () => bytes.promise } as Blob;
    const controller = new AbortController();

    const opening = PdfSession.open(blob, controller.signal);
    controller.abort();
    bytes.resolve(new ArrayBuffer(8));

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(pdfJs.getDocument).not.toHaveBeenCalled();
  });

  it('normalizes a cancelled PDF.js loading rejection and destroys the task once', async () => {
    const document = deferred<never>();
    const destroy = vi.fn(async () => undefined);
    pdfJs.getDocument.mockReturnValue({ promise: document.promise, destroy });
    const controller = new AbortController();

    const opening = PdfSession.open(new Blob(['%PDF-test']), controller.signal);
    await vi.waitFor(() => expect(pdfJs.getDocument).toHaveBeenCalledOnce());
    controller.abort();
    document.reject(new Error('worker stopped'));

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('cleans up an unsuccessful loading task without masking its original error', async () => {
    const failure = new Error('Invalid PDF');
    const destroy = vi.fn(async () => undefined);
    pdfJs.getDocument.mockReturnValue({ promise: Promise.reject(failure), destroy });

    await expect(PdfSession.open(new Blob(['not-a-pdf']))).rejects.toBe(failure);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('bounds extracted-page caching while scanning a long paper', async () => {
    const getPage = vi.fn(async (page: number) => ({
      getTextContent: vi.fn(async () => ({
        items: [{ str: `Page ${page} text`, transform: [1, 0, 0, 1, 0, 700], height: 10, hasEOL: true }],
      })),
      cleanup: vi.fn(),
    }));
    const destroy = vi.fn(async () => undefined);
    pdfJs.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 14, getPage }),
      destroy,
    });
    const session = await PdfSession.open(new Blob(['%PDF-test']));

    for (let page = 1; page <= 14; page += 1) await session.pageText(page);
    await session.pageText(1);

    expect(getPage).toHaveBeenCalledTimes(15);
    expect(getPage).toHaveBeenLastCalledWith(1);
    await session.close();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('PdfSession page resource cleanup', () => {
  it('cleans up a page after successful text extraction', async () => {
    const cleanup = vi.fn();
    const page = {
      getTextContent: vi.fn(async () => ({
        items: [{ str: 'Extracted text', transform: [1, 0, 0, 1, 0, 700], height: 10, hasEOL: true }],
      })),
      cleanup,
    };
    const { session } = await openSessionWithPage(page);

    await expect(session.pageText(1)).resolves.toBe('Extracted text');
    expect(cleanup).toHaveBeenCalledOnce();
    await session.close();
  });

  it('cleans up a page when text extraction rejects', async () => {
    const failure = new Error('text extraction failed');
    const cleanup = vi.fn();
    const page = {
      getTextContent: vi.fn(async () => { throw failure; }),
      cleanup,
    };
    const { session } = await openSessionWithPage(page);

    await expect(session.pageText(1)).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
    await session.close();
  });

  it('cleans up a rendered page when no canvas context is available', async () => {
    const cleanup = vi.fn();
    const page = {
      getViewport: vi.fn(() => ({ width: 100, height: 200 })),
      render: vi.fn(),
      cleanup,
    };
    const { session } = await openSessionWithPage(page);
    const canvas = canvasWithContext(null);
    vi.stubGlobal('window', { devicePixelRatio: 1 });

    await expect(session.renderPage({ canvas, page: 1, scale: 1 })).rejects.toThrow('could not create a PDF canvas');
    expect(page.render).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    await session.close();
  });

  it('cleans up a rendered page when PDF.js rendering rejects', async () => {
    const failure = new Error('render failed');
    const cleanup = vi.fn();
    const page = {
      getViewport: vi.fn(() => ({ width: 100, height: 200 })),
      render: vi.fn(() => ({ promise: Promise.reject(failure), cancel: vi.fn() })),
      cleanup,
    };
    const { session } = await openSessionWithPage(page);
    const canvas = canvasWithContext({} as CanvasRenderingContext2D);
    vi.stubGlobal('window', { devicePixelRatio: 1 });

    await expect(session.renderPage({ canvas, page: 1, scale: 1 })).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
    await session.close();
  });

  it('cleans up a thumbnail page when no canvas context is available', async () => {
    const cleanup = vi.fn();
    const page = {
      getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale })),
      render: vi.fn(),
      cleanup,
    };
    const { session } = await openSessionWithPage(page);
    const canvas = canvasWithContext(null);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });

    await expect(session.thumbnail(1)).resolves.toBeUndefined();
    expect(page.render).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    await session.close();
  });

  it('cleans up a thumbnail page when PDF.js rendering rejects', async () => {
    const failure = new Error('thumbnail render failed');
    const cleanup = vi.fn();
    const page = {
      getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale })),
      render: vi.fn(() => ({ promise: Promise.reject(failure) })),
      cleanup,
    };
    const { session } = await openSessionWithPage(page);
    const canvas = canvasWithContext({} as CanvasRenderingContext2D);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });

    await expect(session.thumbnail(1)).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
    await session.close();
  });
});
