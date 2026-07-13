import { describe, expect, it } from 'vitest';
import {
  PaperAnalysisSchema,
  PaperSchema,
  ResearchMessageSchema,
  createIdFactory,
  createStarterState,
  parseResearchState,
  type Paper,
  type PaperAnalysis,
} from '../src/model';

const STAMP = '2026-07-13T10:00:00.000Z';

function analysis(): PaperAnalysis {
  return {
    title: 'A careful study',
    authors: ['A. Researcher'],
    paperType: 'empirical study',
    publication: { venue: null, year: 2026, doi: null, url: null },
    overview: 'Overview',
    researchQuestion: 'What changed?',
    abstractSummary: 'Abstract summary',
    methods: [{
      name: 'Experiment',
      description: 'A controlled experiment.',
      page: 3,
      evidence: { quote: 'Participants were assigned.', paraphrase: 'Random assignment.', context: 'Methods' },
    }],
    keyFindings: [],
    sectionSummaries: [],
    figures: [],
    tables: [],
    equations: [],
    limitations: [],
    glossary: [],
    references: [],
    sourceLedger: [],
    synthesis: { contribution: 'Contribution', novelty: 'Novelty', implications: [], openQuestions: [] },
    warnings: [],
  };
}

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'paper-1',
    createdAt: STAMP,
    updatedAt: STAMP,
    title: 'A careful study',
    authors: [],
    file: {
      storageKey: 'paper-1',
      name: 'study.pdf',
      sizeBytes: 500,
      mimeType: 'application/pdf',
    },
    tags: [],
    favorite: false,
    archived: false,
    analysisStatus: 'local',
    ...overrides,
  };
}

describe('research model validation', () => {
  it('creates a neutral, valid local-first starter state', () => {
    const state = createStarterState(STAMP);
    expect(parseResearchState(state)).toEqual(state);
    expect(state.papers).toEqual([]);
    expect(state.settings.autoAnalyze).toBe(false);
  });

  it('accepts the complete structured paper-analysis contract', () => {
    expect(PaperAnalysisSchema.parse(analysis()).methods[0].evidence.context).toBe('Methods');
    expect(PaperSchema.parse(paper({ analysisStatus: 'ready', summary: analysis() })).summary?.title)
      .toBe('A careful study');
  });

  it('rejects ready papers without summaries, mismatched local keys, oversized files, and raw byte fields', () => {
    expect(() => PaperSchema.parse(paper({ analysisStatus: 'ready' }))).toThrow();
    expect(() => PaperSchema.parse(paper({ file: { ...paper().file, storageKey: 'other' } }))).toThrow();
    expect(() => PaperSchema.parse(paper({ file: { ...paper().file, sizeBytes: 50 * 1024 * 1024 + 1 } }))).toThrow();
    expect(() => PaperSchema.parse({ ...paper(), blob: new Blob(['%PDF-']) })).toThrow();
  });

  it('requires complete, one-way tombstone shapes', () => {
    expect(() => PaperSchema.parse({ ...paper(), deleted: true })).toThrow();
    expect(() => PaperSchema.parse({ ...paper(), deletedAt: STAMP })).toThrow();
    expect(PaperSchema.parse({ ...paper(), deleted: true, deletedAt: STAMP }).deleted).toBe(true);
  });

  it('accepts UI workspace tabs and rejects unbounded chat context', () => {
    const base = {
      id: 'message-1',
      paperId: 'paper-1',
      role: 'user' as const,
      content: 'Explain this figure.',
      context: { tab: 'visuals' as const, page: 4 },
      citations: [],
      createdAt: STAMP,
      updatedAt: STAMP,
    };
    expect(ResearchMessageSchema.parse(base).context.tab).toBe('visuals');
    expect(() => ResearchMessageSchema.parse({ ...base, context: { tab: 'reader' } })).toThrow();
    expect(() => ResearchMessageSchema.parse({ ...base, context: { tab: 'brief', selectedText: 'x'.repeat(15_001) } })).toThrow();
  });

  it('rejects unknown state paths and unsupported versions', () => {
    const state = createStarterState(STAMP);
    expect(() => parseResearchState({ ...state, pdfBytes: [1, 2, 3] })).toThrow();
    expect(() => parseResearchState({ ...state, version: 2 })).toThrow();
  });

  it('builds deterministic, valid ids with injectable entropy', () => {
    const makeId = createIdFactory({ now: () => 1234, random: () => 0.25 });
    expect(makeId('Source Ledger')).toMatch(/^source-ledger_[a-z0-9]+_[a-z0-9]+$/);
    expect(makeId('Source Ledger')).not.toBe(makeId('Source Ledger'));
  });
});
