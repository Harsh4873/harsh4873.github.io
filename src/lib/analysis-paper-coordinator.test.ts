import { describe, expect, it } from 'vitest';
import type { AnalysisLease, Paper } from '../model';
import {
  analysisMutationHasConflict,
  applyAnalysisPaperPatch,
  pickAnalysisPaperPatch,
} from './analysis-paper-coordinator';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');

function lease(overrides: Partial<AnalysisLease> = {}): AnalysisLease {
  return {
    runId: 'analysis-run-1',
    ownerId: 'analysis-owner-1',
    mode: 'local',
    heartbeatAt: new Date(NOW - 10_000).toISOString(),
    ...overrides,
  };
}

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'paper-1',
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T11:00:00.000Z',
    title: 'Canonical server title',
    authors: ['Ada Lovelace'],
    venue: 'Research Venue',
    file: {
      storageKey: 'paper-1',
      name: 'paper.pdf',
      sizeBytes: 1_024,
      mimeType: 'application/pdf',
    },
    tags: ['important'],
    favorite: true,
    archived: false,
    analysisStatus: 'local',
    ...overrides,
  };
}

describe('analysis paper transaction helpers', () => {
  it('applies only analysis fields onto canonical metadata and advances time monotonically', () => {
    const current = paper();
    const patch = {
      analysisStatus: 'analyzing' as const,
      analysisProgress: 42,
      analysisLease: lease(),
      title: 'stale client title',
      tags: [],
    } as never;

    const next = applyAnalysisPaperPatch(current, patch, NOW);

    expect(next).toMatchObject({
      title: current.title,
      authors: current.authors,
      venue: current.venue,
      tags: current.tags,
      favorite: current.favorite,
      analysisStatus: 'analyzing',
      analysisProgress: 42,
      analysisLease: lease({ heartbeatAt: new Date(NOW).toISOString() }),
      analysisRunId: 'analysis-run-1',
      updatedAt: current.updatedAt,
      analysisUpdatedAt: new Date(NOW).toISOString(),
    });
    expect(pickAnalysisPaperPatch(patch)).not.toHaveProperty('title');
    expect(pickAnalysisPaperPatch(patch)).not.toHaveProperty('tags');
  });

  it('advances only the analysis clock across multiple mutations', () => {
    const current = paper({
      updatedAt: '2026-07-13T11:30:00.000Z',
      analysisUpdatedAt: '2026-07-13T11:45:00.000Z',
    });

    const next = applyAnalysisPaperPatch(current, { analysisProgress: 50 }, NOW);

    expect(next.updatedAt).toBe(current.updatedAt);
    expect(next.analysisUpdatedAt).toBe(new Date(NOW).toISOString());
  });

  it('normalizes a clock-behind lease heartbeat without advancing metadata', () => {
    const current = paper({ updatedAt: '2026-07-13T13:00:00.000Z' });
    const next = applyAnalysisPaperPatch(current, {
      analysisStatus: 'analyzing',
      analysisLease: lease({ heartbeatAt: '2026-07-13T11:00:00.000Z' }),
    }, NOW);

    expect(next.updatedAt).toBe('2026-07-13T13:00:00.000Z');
    expect(next.analysisUpdatedAt).toBe(new Date(NOW).toISOString());
    expect(next.analysisLease?.heartbeatAt).toBe(next.analysisUpdatedAt);
    expect(next.analysisRunId).toBe(next.analysisLease?.runId);
  });

  it('retains run provenance when the owning transaction clears its lease', () => {
    const current = paper({
      analysisStatus: 'analyzing',
      analysisLease: lease(),
    });
    const next = applyAnalysisPaperPatch(current, {
      analysisStatus: 'local',
      analysisLease: undefined,
    }, NOW);

    expect(next.analysisLease).toBeUndefined();
    expect(next.analysisRunId).toBe('analysis-run-1');
  });

  it('allows an idempotent or stale claim but rejects a fresh competing claim', () => {
    const currentLease = lease();
    const current = paper({ analysisStatus: 'analyzing', analysisLease: currentLease });

    expect(analysisMutationHasConflict(
      current,
      { analysisLease: currentLease },
      { type: 'claim', maximumAgeMs: 180_000 },
      NOW,
    )).toBe(false);
    expect(analysisMutationHasConflict(
      current,
      { analysisLease: lease({ runId: 'analysis-run-2' }) },
      { type: 'claim', maximumAgeMs: 180_000 },
      NOW,
    )).toBe(true);
    expect(analysisMutationHasConflict(
      paper({
        analysisStatus: 'analyzing',
        analysisLease: lease({ heartbeatAt: new Date(NOW - 180_001).toISOString() }),
      }),
      { analysisLease: lease({ runId: 'analysis-run-2' }) },
      { type: 'claim', maximumAgeMs: 180_000 },
      NOW,
    )).toBe(false);
  });

  it('requires exact run ownership for updates and never mutates tombstones', () => {
    const current = paper({ analysisStatus: 'analyzing', analysisLease: lease() });
    expect(analysisMutationHasConflict(current, {}, { type: 'owned', runId: 'analysis-run-1' }, NOW)).toBe(false);
    expect(analysisMutationHasConflict(current, {}, { type: 'owned', runId: 'analysis-run-2' }, NOW)).toBe(true);
    expect(analysisMutationHasConflict(
      paper({ deleted: true, deletedAt: '2026-07-13T11:30:00.000Z' }),
      { analysisLease: lease({ runId: 'analysis-run-2' }) },
      { type: 'claim', maximumAgeMs: 180_000 },
      NOW,
    )).toBe(true);
  });

  it('clears an expired AI file only while idle and only for the exact failed file', () => {
    const idle = paper({ analysisStatus: 'local', openaiFileId: 'file-expired' });
    const clear = { openaiFileId: undefined };

    expect(analysisMutationHasConflict(
      idle,
      clear,
      { type: 'idle-file-clear', expectedFileId: 'file-expired' },
      NOW,
    )).toBe(false);
    expect(analysisMutationHasConflict(
      idle,
      clear,
      { type: 'idle-file-clear', expectedFileId: 'file-replacement' },
      NOW,
    )).toBe(true);
    expect(analysisMutationHasConflict(
      { ...idle, analysisStatus: 'analyzing', analysisLease: lease() },
      clear,
      { type: 'idle-file-clear', expectedFileId: 'file-expired' },
      NOW,
    )).toBe(true);
    expect(analysisMutationHasConflict(
      idle,
      { analysisStatus: 'local', openaiFileId: undefined },
      { type: 'idle-file-clear', expectedFileId: 'file-expired' },
      NOW,
    )).toBe(true);
  });
});
