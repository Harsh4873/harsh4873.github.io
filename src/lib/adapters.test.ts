import { describe, expect, it } from 'vitest';
import type { Paper, PaperAnalysis, ResearchMessage } from '../model';
import { analysisToUi, messageToUi, paperToUi } from './adapters';

const evidence = { quote: 'Source quote', paraphrase: 'Source paraphrase', context: 'Source context' };

const analysis: PaperAnalysis = {
  title: 'A Test Paper',
  authors: ['A. Researcher'],
  paperType: 'experiment',
  publication: { venue: 'Journal', year: 2026, doi: '10.1000/test', url: 'https://example.com/paper' },
  overview: 'The overview explains the full argument.',
  researchQuestion: 'Does the method work?',
  abstractSummary: 'The method improves the measured result. Additional context follows.',
  methods: [{ name: 'Controlled trial', description: 'Two conditions were compared.', page: 3, evidence }],
  keyFindings: [{ claim: 'The measured result improved.', importance: 'It supports the hypothesis.', certainty: 'High certainty', page: 8, evidence }],
  sectionSummaries: [{ heading: 'Results', summary: 'The main comparison is reported.', startPage: 7, endPage: 9, keyPoints: ['Condition A was stronger.'], evidence: [{ page: 8, ...evidence }] }],
  figures: [{ label: 'Figure 2', title: 'Main result', page: 8, description: 'Bars compare conditions.', interpretation: 'A is higher.', keyTakeaway: 'The gap is visible.', evidence, limitations: [] }],
  tables: [{ label: 'Table 1', title: 'Sample', page: 4, description: 'Sample counts.', interpretation: 'Groups are balanced.', keyTakeaway: 'No large imbalance.', evidence, limitations: [], columns: ['Group', 'N'] }],
  equations: [{ label: 'Eq. 1', page: 5, latex: 'y = ax + b', plainLanguage: 'A linear relationship.', role: 'Model definition.', variables: [{ symbol: 'a', meaning: 'slope' }], evidence }],
  limitations: [{ limitation: 'Small sample', impact: 'Effects may be unstable.', page: 12, evidence }],
  glossary: [{ term: 'Slope', definition: 'Rate of change.', page: 5 }],
  references: [{ citation: 'Prior Work (2024)', doi: null, url: 'https://example.com/prior', page: 14 }],
  sourceLedger: [{ id: 'claim-1', type: 'claim', title: 'Main claim', claim: 'The result improved.', page: 8, quote: 'Source quote', paraphrase: 'Source paraphrase', context: 'Source context', confidence: 'high' }],
  synthesis: { contribution: 'A controlled comparison.', novelty: 'A new measure.', implications: ['Test at scale.'], openQuestions: ['Does it generalize?'] },
  warnings: ['One appendix was scanned.'],
};

describe('analysisToUi', () => {
  it('preserves technical and traceability sections in the presentation model', () => {
    const result = analysisToUi(analysis);
    expect(result.oneLine).toBe('The method improves the measured result.');
    expect(result.methodItems?.[0].evidence[0]).toMatchObject({ page: 3, quote: 'Source quote' });
    expect(result.visuals.map((item) => item.kind)).toEqual(['table', 'figure']);
    expect(result.equations[0]).toMatchObject({ expression: 'y = ax + b', page: 5 });
    expect(result.ledger[0]).toMatchObject({ confidence: 'high', evidence: [{ page: 8, quote: 'Source quote', label: 'Main claim' }] });
    expect(result.limitations[0].evidence[0].page).toBe(12);
    expect(result.synthesis?.openQuestions).toEqual(['Does it generalize?']);
    expect(result.warnings).toEqual(['One appendix was scanned.']);
  });
});

describe('messageToUi', () => {
  it('preserves grounding and uncertainty for synced chat rendering', () => {
    const message: ResearchMessage = {
      id: 'message-1',
      paperId: 'paper-1',
      role: 'assistant',
      content: 'The paper does not establish causality.',
      citations: [],
      grounded: false,
      uncertainty: 'The study is observational.',
      context: { tab: 'brief', page: 4 },
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
    };

    expect(messageToUi(message)).toMatchObject({
      grounded: false,
      uncertainty: 'The study is observational.',
    });
  });
});

describe('paperToUi', () => {
  it('exposes the analysis model so local briefs can be labeled and upgraded', () => {
    const paper: Paper = {
      id: 'paper-1',
      title: 'A Test Paper',
      authors: [],
      file: { storageKey: 'paper-1', name: 'paper.pdf', sizeBytes: 123, mimeType: 'application/pdf' },
      tags: [],
      favorite: false,
      archived: false,
      analysisStatus: 'ready',
      analysisModel: 'sift-local-v1',
      summary: analysis,
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
    };

    expect(paperToUi(paper, true)).toMatchObject({
      analysisModel: 'sift-local-v1',
      analysisStatus: 'ready',
      availableLocal: true,
    });
  });
});
