import { describe, expect, it } from 'vitest';
import type { Section, SlateState, Task } from './model';
import {
  isCloudRoot,
  mergeStates,
  omitUndefinedDeep,
  resolveInitialSync,
  selectNewer,
  serializeEntityDocument,
  serializeRootDocument,
  stableStringify,
} from './sync-core';

function makeSection(overrides: Partial<Section> = {}): Section {
  return {
    id: 'section-1',
    title: 'Inbox',
    color: '#b8f35b',
    order: 1000,
    collapsed: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    sectionId: 'section-1',
    title: 'Write tests',
    notes: '',
    done: false,
    order: 1000,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeState(overrides: Partial<SlateState> = {}): SlateState {
  return {
    version: 1,
    settings: { theme: 'dark', hideCompleted: false, updatedAt: '2026-07-01T10:00:00.000Z' },
    sections: [makeSection()],
    tasks: [makeTask()],
    blocks: [],
    ...overrides,
  };
}

describe('stableStringify', () => {
  it('sorts keys and drops undefined so equal documents compare equal', () => {
    expect(stableStringify({ b: 1, a: 2, c: undefined })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});

describe('omitUndefinedDeep', () => {
  it('removes undefined recursively, keeping null and empty strings', () => {
    expect(omitUndefinedDeep({ a: undefined, b: { c: undefined, d: null, e: '' }, f: [1, undefined] }))
      .toEqual({ b: { d: null, e: '' }, f: [1, undefined] });
  });
});

describe('selectNewer', () => {
  it('prefers the later updatedAt regardless of argument order', () => {
    const older = makeTask({ title: 'old', updatedAt: '2026-07-01T10:00:00.000Z' });
    const newer = makeTask({ title: 'new', updatedAt: '2026-07-02T10:00:00.000Z' });
    expect(selectNewer(older, newer).title).toBe('new');
    expect(selectNewer(newer, older).title).toBe('new');
  });

  it('breaks exact-timestamp ties deterministically for both argument orders', () => {
    const left = makeTask({ title: 'apple' });
    const right = makeTask({ title: 'zebra' });
    expect(selectNewer(left, right)).toBe(selectNewer(right, left));
  });

  it('lets a newer tombstone win over an older edit', () => {
    const edited = makeTask({ title: 'edited', updatedAt: '2026-07-02T10:00:00.000Z' });
    const tombstone = makeTask({ deleted: true, updatedAt: '2026-07-03T10:00:00.000Z' });
    expect(selectNewer(edited, tombstone).deleted).toBe(true);
  });
});

describe('mergeStates', () => {
  it('unions unseen entities from both sides', () => {
    const local = makeState({ tasks: [makeTask({ id: 'task-local' })] });
    const remote = makeState({ tasks: [makeTask({ id: 'task-remote' })] });
    const merged = mergeStates(local, remote);
    expect(merged.tasks.map((task) => task.id).sort()).toEqual(['task-local', 'task-remote']);
  });

  it('resolves conflicting copies per entity by updatedAt', () => {
    const local = makeState({
      tasks: [
        makeTask({ id: 'task-a', title: 'local-newer', updatedAt: '2026-07-05T10:00:00.000Z' }),
        makeTask({ id: 'task-b', title: 'local-older', updatedAt: '2026-07-01T10:00:00.000Z' }),
      ],
    });
    const remote = makeState({
      tasks: [
        makeTask({ id: 'task-a', title: 'remote-older', updatedAt: '2026-07-02T10:00:00.000Z' }),
        makeTask({ id: 'task-b', title: 'remote-newer', updatedAt: '2026-07-04T10:00:00.000Z' }),
      ],
    });
    const merged = mergeStates(local, remote);
    const byId = new Map(merged.tasks.map((task) => [task.id, task.title]));
    expect(byId.get('task-a')).toBe('local-newer');
    expect(byId.get('task-b')).toBe('remote-newer');
  });

  it('keeps settings from whichever side changed them last', () => {
    const local = makeState({ settings: { theme: 'light', hideCompleted: false, updatedAt: '2026-07-06T10:00:00.000Z' } });
    const remote = makeState({ settings: { theme: 'dark', hideCompleted: true, updatedAt: '2026-07-02T10:00:00.000Z' } });
    expect(mergeStates(local, remote).settings.theme).toBe('light');
    expect(mergeStates(remote, local).settings.theme).toBe('light');
  });

  it('propagates a tombstone over the deleted entity everywhere', () => {
    const local = makeState({
      sections: [makeSection({ deleted: true, updatedAt: '2026-07-08T10:00:00.000Z' })],
      tasks: [],
    });
    const remote = makeState({ tasks: [] });
    const merged = mergeStates(remote, local);
    expect(merged.sections[0].deleted).toBe(true);
  });
});

describe('resolveInitialSync', () => {
  it('uploads the full local state when the cloud is empty', () => {
    const local = makeState();
    const resolution = resolveInitialSync(local, null);
    expect(resolution.state).toBe(local);
    expect(resolution.uploadSections).toHaveLength(1);
    expect(resolution.uploadTasks).toHaveLength(1);
    expect(resolution.uploadRoot).toBe(true);
  });

  it('uploads only entities the cloud is missing or holds older copies of', () => {
    const shared = makeTask({ id: 'task-shared' });
    const local = makeState({
      tasks: [
        shared,
        makeTask({ id: 'task-local-only' }),
        makeTask({ id: 'task-conflict', title: 'local-newer', updatedAt: '2026-07-09T10:00:00.000Z' }),
      ],
    });
    const cloud = makeState({
      tasks: [
        shared,
        makeTask({ id: 'task-cloud-only' }),
        makeTask({ id: 'task-conflict', title: 'cloud-older', updatedAt: '2026-07-02T10:00:00.000Z' }),
      ],
    });
    const resolution = resolveInitialSync(local, cloud);
    expect(resolution.uploadTasks.map((task) => task.id).sort()).toEqual(['task-conflict', 'task-local-only']);
    expect(resolution.uploadSections).toHaveLength(0);
    expect(resolution.uploadRoot).toBe(false);
    expect(resolution.state.tasks.map((task) => task.id).sort())
      .toEqual(['task-cloud-only', 'task-conflict', 'task-local-only', 'task-shared']);
  });

  it('adopts newer cloud copies without re-uploading them', () => {
    const local = makeState({
      tasks: [makeTask({ id: 'task-a', title: 'stale', updatedAt: '2026-07-01T10:00:00.000Z' })],
    });
    const cloud = makeState({
      tasks: [makeTask({ id: 'task-a', title: 'fresh', updatedAt: '2026-07-05T10:00:00.000Z' })],
    });
    const resolution = resolveInitialSync(local, cloud);
    expect(resolution.state.tasks[0].title).toBe('fresh');
    expect(resolution.uploadTasks).toHaveLength(0);
  });
});

describe('serialization', () => {
  it('serializes root documents that satisfy isCloudRoot', () => {
    const root = serializeRootDocument(makeState());
    expect(isCloudRoot(root)).toBe(true);
    expect(root.updatedAt).toBe(root.settings.updatedAt);
  });

  it('strips undefined optionals so Firestore accepts the document', () => {
    const { data } = serializeEntityDocument({ ...makeTask(), completedAt: undefined, due: undefined });
    expect('completedAt' in data).toBe(false);
    expect('due' in data).toBe(false);
  });

  it('rejects malformed root documents', () => {
    expect(isCloudRoot({ schemaVersion: 2, settings: {}, updatedAt: 'x' })).toBe(false);
    expect(isCloudRoot(null)).toBe(false);
    expect(isCloudRoot({ schemaVersion: 1, updatedAt: '2026-07-01T00:00:00.000Z' })).toBe(false);
  });
});
