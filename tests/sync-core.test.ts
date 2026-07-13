import { describe, expect, it } from 'vitest';
import { createStarterState, type Paper, type ResearchState } from '../src/model';
import {
  mergeStates,
  omitUndefinedDeep,
  resolveInitialSync,
  selectEntityWinner,
  selectNewer,
  stableStringify,
} from '../src/sync-core';

const EARLY = '2026-07-13T10:00:00.000Z';
const LATE = '2026-07-13T11:00:00.000Z';

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
