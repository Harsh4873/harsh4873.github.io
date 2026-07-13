import { describe, expect, it } from 'vitest';
import { createStarterState, type Paper, type ResearchState } from '../src/model';
import {
  mergeStates,
  mergePaperRecords,
  omitUndefinedDeep,
  resolveInitialSync,
  selectEntityWinner,
  selectNewer,
  stableStringify,
} from '../src/sync-core';

const EARLY = '2026-07-13T10:00:00.000Z';
const LATE = '2026-07-13T11:00:00.000Z';
const FINAL = '2026-07-13T12:00:00.000Z';

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'paper-1',
    createdAt: EARLY,
    updatedAt: EARLY,
    title: 'Study',
    authors: [],
    file: { storageKey: 'paper-1', name: 'study.pdf', sizeBytes: 100, mimeType: 'application/pdf' },
    tags: [],
    favorite: false,
    archived: false,
    analysisStatus: 'local',
    ...overrides,
  };
}

function state(papers: Paper[] = []): ResearchState {
  return { ...createStarterState(EARLY), papers };
}

describe('research conflict resolution', () => {
  it('uses timestamps for singleton conflicts and canonical JSON for exact ties', () => {
    const older = { updatedAt: EARLY, value: 'z' };
    const newer = { updatedAt: LATE, value: 'a' };
    expect(selectNewer(older, newer)).toBe(newer);

    const tiedA = { updatedAt: EARLY, value: 'a' };
    const tiedZ = { updatedAt: EARLY, value: 'z' };
    expect(selectNewer(tiedA, tiedZ)).toEqual(selectNewer(tiedZ, tiedA));
  });

  it('never resurrects a tombstone, even when a live edit has a later wall clock', () => {
    const deleted = paper({ updatedAt: EARLY, deleted: true, deletedAt: EARLY });
    const laterLive = paper({ updatedAt: LATE, title: 'Offline edit' });
    expect(selectEntityWinner(deleted, laterLive).deleted).toBe(true);
    expect(selectEntityWinner(laterLive, deleted).deleted).toBe(true);
    expect(mergeStates(state([laterLive]), state([deleted])).papers[0].deleted).toBe(true);
  });

  it('keeps independently created records and deterministically sorts them', () => {
    const first = paper({ id: 'paper-a', file: { ...paper().file, storageKey: 'paper-a' } });
    const second = paper({ id: 'paper-b', file: { ...paper().file, storageKey: 'paper-b' } });
    expect(mergeStates(state([second]), state([first])).papers.map((item) => item.id))
      .toEqual(['paper-a', 'paper-b']);
  });

  it('keeps an active analysis generation across a later stale metadata edit', () => {
    const active = paper({
      analysisStatus: 'analyzing',
      analysisProgress: 40,
      analysisUpdatedAt: LATE,
      analysisLease: {
        runId: 'analysis-run-1',
        ownerId: 'research-tab-1',
        mode: 'local',
        heartbeatAt: LATE,
      },
    });
    const staleMetadataEdit = paper({
      updatedAt: FINAL,
      title: 'Edited in another tab',
      tags: ['review'],
    });

    const merged = mergePaperRecords(active, staleMetadataEdit);

    expect(merged).toMatchObject({
      title: 'Edited in another tab',
      tags: ['review'],
      updatedAt: FINAL,
      analysisStatus: 'analyzing',
      analysisProgress: 40,
      analysisUpdatedAt: LATE,
      analysisLease: active.analysisLease,
    });
    expect(mergePaperRecords(staleMetadataEdit, active)).toEqual(merged);
  });

  it('accepts a later transactional completion without losing newer metadata', () => {
    const active = paper({
      analysisStatus: 'analyzing',
      analysisProgress: 40,
      analysisUpdatedAt: LATE,
      analysisLease: {
        runId: 'analysis-run-1',
        ownerId: 'research-tab-1',
        mode: 'local',
        heartbeatAt: LATE,
      },
    });
    const metadataEdit = paper({
      updatedAt: FINAL,
      title: 'Concurrent metadata title',
      tags: ['review'],
    });
    const completed = paper({
      analysisStatus: 'local',
      analysisProgress: undefined,
      analysisUpdatedAt: '2026-07-13T12:30:00.000Z',
    });

    const merged = mergePaperRecords(mergePaperRecords(active, metadataEdit), completed);

    expect(merged).toMatchObject({
      title: 'Concurrent metadata title',
      tags: ['review'],
      updatedAt: FINAL,
      analysisStatus: 'local',
      analysisUpdatedAt: '2026-07-13T12:30:00.000Z',
    });
    expect(merged.analysisLease).toBeUndefined();
    expect(merged.analysisProgress).toBeUndefined();
  });

  it('keeps deletion irreversible without dropping a concurrent active generation', () => {
    const active = paper({
      analysisStatus: 'analyzing',
      analysisUpdatedAt: LATE,
      analysisLease: {
        runId: 'analysis-run-1',
        ownerId: 'research-tab-1',
        mode: 'local',
        heartbeatAt: LATE,
      },
    });
    const staleTombstone = paper({
      updatedAt: FINAL,
      deleted: true,
      deletedAt: FINAL,
    });

    const merged = mergePaperRecords(active, staleTombstone);

    expect(merged.deleted).toBe(true);
    expect(merged.analysisLease).toEqual(active.analysisLease);
    expect(merged.analysisUpdatedAt).toBe(LATE);
  });

  it('protects a different canonical cloud run from a newer offline completion', () => {
    const cloudActive = paper({
      analysisStatus: 'analyzing',
      analysisUpdatedAt: LATE,
      analysisRunId: 'cloud-run',
      analysisLease: {
        runId: 'cloud-run',
        ownerId: 'cloud-tab',
        mode: 'ai',
        heartbeatAt: LATE,
      },
    });
    const offlineCompletion = paper({
      updatedAt: FINAL,
      title: 'Offline metadata edit',
      analysisStatus: 'local',
      analysisUpdatedAt: '2026-07-13T13:00:00.000Z',
      analysisRunId: 'offline-run',
    });

    const resolution = resolveInitialSync(state([offlineCompletion]), state([cloudActive]));

    expect(resolution.state.papers[0]).toMatchObject({
      title: 'Offline metadata edit',
      updatedAt: FINAL,
      analysisStatus: 'analyzing',
      analysisUpdatedAt: LATE,
      analysisRunId: 'cloud-run',
      analysisLease: cloudActive.analysisLease,
    });
    expect(resolution.uploadPapers[0]).toMatchObject({
      title: 'Offline metadata edit',
      analysisRunId: 'cloud-run',
      analysisLease: cloudActive.analysisLease,
    });
    expect(mergePaperRecords(
      cloudActive,
      offlineCompletion,
      { preferredActiveSide: 'left' },
    ).analysisRunId).toBe('cloud-run');
  });

  it('allows the same run terminal transaction to clear the cloud lease', () => {
    const cloudActive = paper({
      analysisStatus: 'analyzing',
      analysisUpdatedAt: LATE,
      analysisRunId: 'shared-run',
      analysisLease: {
        runId: 'shared-run',
        ownerId: 'cloud-tab',
        mode: 'local',
        heartbeatAt: LATE,
      },
    });
    const completion = paper({
      analysisStatus: 'local',
      analysisUpdatedAt: FINAL,
      analysisRunId: 'shared-run',
    });

    const resolved = resolveInitialSync(state([completion]), state([cloudActive])).state.papers[0];

    expect(resolved.analysisStatus).toBe('local');
    expect(resolved.analysisLease).toBeUndefined();
    expect(resolved.analysisRunId).toBe('shared-run');
  });

  it('reports only records that must repair or initialize the cloud', () => {
    const localPaper = paper({ updatedAt: LATE, title: 'Local winner' });
    const cloudPaper = paper({ title: 'Cloud older' });
    const resolution = resolveInitialSync(state([localPaper]), state([cloudPaper]));
    expect(resolution.state.papers[0].title).toBe('Local winner');
    expect(resolution.uploadPapers).toEqual([localPaper]);

    const firstSync = resolveInitialSync(state([localPaper]), null);
    expect(firstSync.uploadProfile).toBe(true);
    expect(firstSync.uploadPapers).toEqual([localPaper]);
  });

  it('serializes without undefined values or unstable object key ordering', () => {
    expect(omitUndefinedDeep({ b: undefined, a: [1, undefined, 2], c: null }))
      .toEqual({ a: [1, 2], c: null });
    expect(stableStringify({ z: 1, a: 2 })).toBe(stableStringify({ a: 2, z: 1 }));
  });
});
