import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaperAnalysis } from '../../src/model';
import {
  EVALUATION_PAPERS,
  buildEvaluationEngineInput,
  calculateEvaluationMetrics,
  extractDocumentOutline,
  loadPaperBytes,
  type ExtractedPaper,
  verifyPinnedPaperBytes,
} from './harness';

const evidence = {
  quote: 'transformer evidence improves results',
  paraphrase: 'The reported result improves.',
  context: 'The result is reported in the abstract and results.',
};

function analysis(page = 1): PaperAnalysis {
  return {
    title: 'Attention Is All You Need',
    authors: ['A. Researcher'],
    paperType: 'research paper',
    publication: { venue: null, year: 2017, doi: null, url: 'https://arxiv.org/abs/1706.03762' },
    overview: 'A transformer architecture is evaluated.',
    researchQuestion: 'Can attention replace recurrence?',
    abstractSummary: 'Transformer evidence improves results.',
    methods: [{ name: 'Evaluation', description: 'Models are compared.', page, evidence }],
    keyFindings: [{ claim: 'Results improve.', importance: 'The architecture is effective.', certainty: 'Reported result.', page, evidence }],
    sectionSummaries: [{
      heading: 'Introduction and results',
      summary: 'The paper introduces and evaluates the model.',
      startPage: 1,
      endPage: 3,
      keyPoints: ['Attention is evaluated.'],
      evidence: [{ page, ...evidence }],
    }],
    figures: [{
      label: 'Figure 1',
      title: 'Architecture',
      page: 2,
      description: 'The model architecture.',
      interpretation: 'The blocks are connected.',
      keyTakeaway: 'Attention composes the model.',
      evidence: { ...evidence, quote: 'Figure 1 model architecture' },
      limitations: [],
    }],
    tables: [{
      label: 'Table 1',
      title: 'Results',
      page: 3,
      description: 'The table reports results.',
      interpretation: 'The score improves.',
      keyTakeaway: 'The comparison favors the model.',
      evidence: { ...evidence, quote: 'Table 1 reported results' },
      limitations: [],
      columns: ['Model', 'Score'],
    }],
    equations: [{
      label: 'Equation 1',
      page: 2,
      latex: 'y = x',
      plainLanguage: 'The output equals the input.',
      role: 'Definition',
      variables: [{ symbol: 'x', meaning: 'input' }],
      evidence: { ...evidence, quote: 'Equation 1 y x' },
    }],
    limitations: [{ limitation: 'Small evaluation', impact: 'Generalization is uncertain.', page: 3, evidence }],
    glossary: [{ term: 'Transformer', definition: 'An attention-based architecture.', page: 1 }],
    references: [{ citation: '[1] Prior work', doi: null, url: null, page: 3 }],
    sourceLedger: [{
      id: 'claim:001',
      type: 'claim',
      title: 'Reported result',
      claim: 'Results improve.',
      page,
      quote: evidence.quote,
      paraphrase: evidence.paraphrase,
      context: evidence.context,
      confidence: 'high',
    }],
    synthesis: { contribution: 'An attention architecture.', novelty: 'Recurrence is removed.', implications: [], openQuestions: [] },
    warnings: [],
  };
}

const extracted: ExtractedPaper = {
  metadata: { title: 'Attention Is All You Need' },
  outline: [
    { title: 'Introduction', page: 1, depth: 0 },
    { title: 'Results', page: 3, depth: 0 },
  ],
  pages: [
    { page: 1, lines: ['Abstract', evidence.quote], text: `Abstract\n${evidence.quote}` },
    { page: 2, lines: ['Figure 1 model architecture', 'Equation 1 y x (1)'], text: 'Figure 1 model architecture\nEquation 1 y x (1)' },
    { page: 3, lines: ['Table 1 reported results', evidence.quote, 'References', '[1] Prior work'], text: `Table 1 reported results\n${evidence.quote}\nReferences\n[1] Prior work` },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('real-paper evaluation harness', () => {
  it('uses official arXiv PDF sources only', () => {
    expect(EVALUATION_PAPERS.map((paper) => paper.pdfUrl)).toEqual([
      'https://arxiv.org/pdf/1706.03762v7',
      'https://arxiv.org/pdf/1412.6980v9',
      'https://arxiv.org/pdf/1810.04805v2',
    ]);
    expect(EVALUATION_PAPERS.map((paper) => paper.expectedSha256)).toEqual([
      'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697',
      'eab9c73ae2ceda884b94830bda99312254bac4806f6c9f045cbab90721ecda31',
      '5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e',
    ]);
  });

  it('accepts only bytes matching a paper\'s pinned SHA-256', async () => {
    const bytes = new TextEncoder().encode('%PDF-synthetic');
    const fixturePaper = {
      ...EVALUATION_PAPERS[0],
      title: 'Synthetic fixture',
      fileName: 'fixture.pdf',
      expectedSha256: 'a01de6a6a86f3503b20a3a18ba0e5cca91f7ab089e7ab0d2e559297331b7294b',
    };

    expect(verifyPinnedPaperBytes(fixturePaper, bytes, 'fixture.pdf')).toBe(fixturePaper.expectedSha256);
    expect(() => verifyPinnedPaperBytes(EVALUATION_PAPERS[0], bytes, 'fixture.pdf')).toThrow(
      /SHA-256 mismatch for Attention Is All You Need/,
    );

    const directory = await mkdtemp(join(tmpdir(), 'sift-paper-hash-test-'));
    vi.stubEnv('SIFT_PAPER_CACHE', directory);
    try {
      await writeFile(join(directory, fixturePaper.fileName), bytes);
      await expect(loadPaperBytes(fixturePaper, { offline: true })).resolves.toMatchObject({ downloaded: false });

      await writeFile(join(directory, EVALUATION_PAPERS[0].fileName), bytes);
      await expect(loadPaperBytes(EVALUATION_PAPERS[0], { offline: true })).rejects.toThrow(
        /No valid cached PDF.*SHA-256 mismatch/s,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('flattens nested PDF bookmarks and resolves named and direct destinations', async () => {
    const document = {
      getOutline: vi.fn(async () => [
        {
          title: '  Introduction\n',
          dest: 'intro',
          items: [{ title: 'Method', dest: [{ num: 4, gen: 0 }], items: [] }],
        },
        { title: 'Results', dest: [2], items: [] },
        { title: 'Unresolved', dest: 'missing', items: [] },
      ]),
      getDestination: vi.fn(async (name: string) => (
        name === 'intro' ? [{ num: 0, gen: 0 }] : null
      )),
      getPageIndex: vi.fn(async (reference: { num: number }) => reference.num),
    } as unknown as Parameters<typeof extractDocumentOutline>[0];

    await expect(extractDocumentOutline(document)).resolves.toEqual([
      { title: 'Introduction', page: 1, depth: 0 },
      { title: 'Method', page: 5, depth: 1 },
      { title: 'Results', page: 3, depth: 0 },
      { title: 'Unresolved', page: undefined, depth: 0 },
    ]);
  });

  it('passes extracted bookmarks through the evaluator engine payload', () => {
    const input = buildEvaluationEngineInput(EVALUATION_PAPERS[0], extracted);

    expect(input.outline).toEqual(extracted.outline);
    expect(input.pages).toBe(extracted.pages);
    expect(input.metadata?.url).toBe('https://arxiv.org/abs/1706.03762v7');
  });

  it('reports schema, size, deterministic output, source markers, and valid receipts', () => {
    const output = analysis();
    const metrics = calculateEvaluationMetrics({
      paper: EVALUATION_PAPERS[0],
      sourceBytes: new TextEncoder().encode('%PDF-synthetic'),
      extracted,
      firstAnalysis: output,
      secondAnalysis: structuredClone(output),
      firstRuntimeMs: 12.4,
      secondRuntimeMs: 9.8,
    });

    expect(metrics.schemaValid).toBe(true);
    expect(metrics.outlineItems).toBe(2);
    expect(metrics.resolvedOutlineItems).toBe(2);
    expect(metrics.withinSyncCeiling).toBe(true);
    expect(metrics.deterministic).toBe(true);
    expect(metrics.sourceFigureMarkers).toBe(1);
    expect(metrics.sourceTableMarkers).toBe(1);
    expect(metrics.sourceEquationMarkers).toBe(1);
    expect(metrics.sourceReferenceMarkers).toBe(1);
    expect(metrics.receipts.inRangeRate).toBe(1);
    expect(metrics.receipts.ledgerInRangeRate).toBe(1);
    expect(metrics.receipts.quoteMatchRate).toBe(1);
    expect(metrics.abstractSummaryTokenOverlap).toBeGreaterThan(0.7);
    expect(metrics.failures).toEqual([]);
  });

  it('fails an out-of-range source-ledger receipt', () => {
    const invalidReceipt = analysis(10);
    const metrics = calculateEvaluationMetrics({
      paper: EVALUATION_PAPERS[0],
      sourceBytes: new TextEncoder().encode('%PDF-synthetic'),
      extracted,
      firstAnalysis: invalidReceipt,
      secondAnalysis: structuredClone(invalidReceipt),
      firstRuntimeMs: 1,
      secondRuntimeMs: 1,
    });

    expect(metrics.receipts.ledgerInRangeRate).toBe(0);
    expect(metrics.failures).toContain('One or more source-ledger pages are outside the PDF page range.');
  });
});
