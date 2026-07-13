import { describe, expect, it, vi } from 'vitest';

// collectPaperPagesFrom is pure, but importing the module pulls in ./pdf, which
// loads pdfjs-dist. Mock it so the suite runs in the node test environment.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.js' }));

import { collectPaperPagesFrom, type PageTextSource } from './paper-text';

function source(texts: string[]): PageTextSource {
  return { pageCount: texts.length, pageText: async (page) => texts[page - 1] ?? '' };
}

describe('collectPaperPagesFrom', () => {
  it('keeps non-empty pages in order and skips blank pages', async () => {
    const result = await collectPaperPagesFrom(source(['Intro', '   ', 'Methods']));
    expect(result.pages).toEqual([{ page: 1, text: 'Intro' }, { page: 3, text: 'Methods' }]);
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe('Intro'.length + 'Methods'.length);
  });

  it('stops at the character budget and flags truncation', async () => {
    const result = await collectPaperPagesFrom(source(['aaaa', 'bbbb', 'cccc']), { maxChars: 6 });
    // page 1 (4 chars) fits; page 2 is sliced to the remaining 2 chars; page 3 is dropped.
    expect(result.pages).toEqual([{ page: 1, text: 'aaaa' }, { page: 2, text: 'bb' }]);
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(6);
  });

  it('reports progress per page', async () => {
    const seen: Array<[number, number]> = [];
    await collectPaperPagesFrom(source(['one', 'two']), { onProgress: (page, total) => seen.push([page, total]) });
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });

  it('aborts extraction when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collectPaperPagesFrom(source(['Intro']), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
