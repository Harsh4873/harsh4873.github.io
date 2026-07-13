import { describe, expect, it } from 'vitest';
import type { Paper, PaperAnalysis } from '../model';
import {
  LOCAL_ANALYSIS_MODEL,
  analysisMetadataPatchPreservingEdits,
  completedAnalysisPatch,
  isLocalAnalysis,
} from './analysis-result';

const analysis = {
  title: 'Local result',
  authors: ['Local Author'],
  paperType: 'review',
  publication: { venue: null, year: 2025, doi: null, url: null },
  overview: 'Overview',
  researchQuestion: 'Question?',
  abstractSummary: 'Abstract',
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
} satisfies PaperAnalysis;

const paper = {
  id: 'paper-1',
  title: 'Original title',
  authors: [],
  file: { storageKey: 'paper-1', name: 'paper.pdf', sizeBytes: 100, mimeType: 'application/pdf' },
  tags: [],
  favorite: false,
  archived: false,
  analysisStatus: 'ready',
  analysisLease: {
    runId: 'analysis-run-1',
    ownerId: 'research-tab-1',
    mode: 'local',
    heartbeatAt: '2026-07-13T10:30:00.000Z',
  },
  openaiFileId: 'file-keep',
  createdAt: '2026-07-13T10:00:00.000Z',
  updatedAt: '2026-07-13T10:00:00.000Z',
} satisfies Paper;

describe('completedAnalysisPatch', () => {
  it('marks a local result while leaving an existing AI file reference untouched', () => {
    const patch = completedAnalysisPatch(paper, analysis, LOCAL_ANALYSIS_MODEL, '2026-07-13T11:00:00.000Z');
    const updated = { ...paper, ...patch };

    expect(patch).not.toHaveProperty('openaiFileId');
    expect(updated.openaiFileId).toBe('file-keep');
    expect(updated.analysisModel).toBe(LOCAL_ANALYSIS_MODEL);
    expect(updated.analysisStatus).toBe('ready');
    expect(patch).toHaveProperty('analysisLease', undefined);
    expect(updated.analysisLease).toBeUndefined();
    expect(isLocalAnalysis(updated.analysisModel)).toBe(true);
  });

  it('enriches unchanged metadata but preserves edits made during analysis', () => {
    const started = { title: 'Upload name', authors: [], year: undefined, doi: undefined, sourceUrl: undefined };
    const enriched = analysisMetadataPatchPreservingEdits(started, started, {
      ...analysis,
      publication: { venue: null, year: 2025, doi: '10.1000/example', url: 'https://example.test/paper' },
    });

    expect(enriched).toEqual({
      title: 'Local result',
      authors: ['Local Author'],
      year: 2025,
      doi: '10.1000/example',
      sourceUrl: 'https://example.test/paper',
    });

    expect(analysisMetadataPatchPreservingEdits(started, {
      ...started,
      title: 'My corrected title',
      authors: ['Corrected Author'],
    }, analysis)).toEqual({ year: 2025 });
  });
});
