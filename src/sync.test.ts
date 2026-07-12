import { describe, expect, it } from 'vitest';
import { createInitialState, type HabitEntry, type TrackerState } from './model';
import { parseTrackerState } from './store';
import {
  LEGACY_GENERATION_UPDATED_AT,
  entryDocumentId,
  createReplacementGeneration,
  habitDocumentId,
  isMeaningfulLocalState,
  materializeCloudState,
  mergeSameGeneration,
  normalizeLegacyV1State,
  resolveInitialSync,
  serializeEntryDocument,
  serializeHabitDocument,
  serializeRootDocument,
  serializeTrackerDelta,
  type CloudEntryDocument,
  type CloudHabitDocument,
  type LegacyTrackerStateV1,
} from './sync-core';

const earlier = '2026-07-01T08:00:00.000Z';
const later = '2026-07-01T09:00:00.000Z';
const latest = '2026-07-01T10:00:00.000Z';

function state(generationId = 'generation-a'): TrackerState {
  return createInitialState({
    generationId,
    generationUpdatedAt: earlier,
    now: earlier,
    startDate: '2026-07-01',
  });
}

function loggedEntry(value: number, updatedAt = earlier): HabitEntry {
  return { value, hasValue: true, updatedAt };
}

describe('legacy normalization', () => {
  it('adds stable v2 sync metadata without changing legacy habit or entry values', () => {
    const original = state();
    const { updatedAt: _profileUpdatedAt, ...legacyProfile } = original.profile;
    const legacyHabits = original.habits.map((habit) => {
      const { updatedAt: _updatedAt, order: _order, ...legacyHabit } = habit;
      return legacyHabit;
    });
    const legacy: LegacyTrackerStateV1 = {
      version: 1,
      profile: legacyProfile,
      habits: legacyHabits,
      entries: { '2026-07-01': { 'starter-read': loggedEntry(20, earlier) } },
    };

    const normalized = normalizeLegacyV1State(legacy, later);

    expect(normalized.version).toBe(2);
    expect(normalized.generationId).toBe('local-v1');
    expect(normalized.profile.updatedAt).toBe(LEGACY_GENERATION_UPDATED_AT);
    expect(normalized.habits.map((habit) => habit.order)).toEqual([0, 1, 2, 3]);
    expect(normalized.habits.every((habit) => habit.updatedAt === LEGACY_GENERATION_UPDATED_AT)).toBe(true);
    expect(normalized.entries['2026-07-01']['starter-read']).toEqual(loggedEntry(20, earlier));
  });

  it('migrates an actual v1 backup without losing IDs, notes, skips, or entry timestamps', () => {
    const original = state();
    const { updatedAt: _profileUpdatedAt, ...legacyProfile } = original.profile;
    const legacyHabits = original.habits.map((habit) => {
      const { updatedAt: _updatedAt, order: _order, ...legacyHabit } = habit;
      return legacyHabit;
    });
    const legacy = {
      version: 1,
      profile: legacyProfile,
      habits: legacyHabits,
      entries: {
        '2026-07-01': {
          'starter-read': {
            value: 0,
            hasValue: false,
            skipped: true,
            note: 'Travel day',
            updatedAt: earlier,
          },
        },
      },
    };

    const migrated = parseTrackerState(legacy, later);

    expect(migrated.generationId).toBe('local-v1');
    expect(migrated.habits.map((habit) => habit.id)).toEqual(original.habits.map((habit) => habit.id));
    expect(migrated.entries['2026-07-01']['starter-read']).toEqual(legacy.entries['2026-07-01']['starter-read']);
    expect(migrated.profile.updatedAt).toBe(LEGACY_GENERATION_UPDATED_AT);
  });
});

describe('first sync resolution', () => {
  it('promotes legacy local data into a unique generation for the first cloud upload', () => {
    const local = state('local-v1');
    local.generationUpdatedAt = '1970-01-01T00:00:00.000Z';
    local.entries['2026-07-01'] = { 'starter-read': loggedEntry(20) };

    const resolution = resolveInitialSync(local, null, {
      firstUploadGenerationId: 'first-cloud-generation',
      now: later,
    });

    expect(resolution.mode).toBe('upload-local');
    expect(resolution.shouldWriteCloud).toBe(true);
    expect(resolution.state.generationId).toBe('first-cloud-generation');
    expect(resolution.state.entries).toEqual(local.entries);
  });

  it('hydrates an untouched second device from cloud without uploading starter data', () => {
    const fresh = state('local-v1');
    fresh.generationUpdatedAt = '1970-01-01T00:00:00.000Z';
    const cloud = state('cloud-generation');
    cloud.profile = { ...cloud.profile, displayName: 'Synced Harsh', updatedAt: later };
    cloud.entries['2026-07-01'] = { 'starter-read': loggedEntry(25, later) };

    expect(isMeaningfulLocalState(fresh)).toBe(false);
    const resolution = resolveInitialSync(fresh, cloud);

    expect(resolution.mode).toBe('hydrate-cloud');
    expect(resolution.shouldWriteCloud).toBe(false);
    expect(resolution.state).toBe(cloud);
  });

  it('treats a start-date-only habit edit as meaningful', () => {
    const local = createInitialState({ now: later, startDate: '2026-07-01' });
    local.habits[0] = { ...local.habits[0], startDate: '2026-06-01', updatedAt: later };

    expect(isMeaningfulLocalState(local)).toBe(true);
  });

  it('merges meaningful legacy data entity-by-entity into the cloud generation', () => {
    const local = state('local-v1');
    local.generationUpdatedAt = '1970-01-01T00:00:00.000Z';
    local.habits[0] = { ...local.habits[0], name: 'Walk farther', updatedAt: later };
    const cloud = state('cloud-generation');
    cloud.habits[1] = { ...cloud.habits[1], name: 'Read a chapter', updatedAt: later };

    const resolution = resolveInitialSync(local, cloud);

    expect(resolution.mode).toBe('merge');
    expect(resolution.state.generationId).toBe('cloud-generation');
    expect(resolution.state.habits.find((habit) => habit.id === 'starter-steps')?.name).toBe('Walk farther');
    expect(resolution.state.habits.find((habit) => habit.id === 'starter-read')?.name).toBe('Read a chapter');
  });

  it('adds a fresh-device entry without replacing customized cloud starters or profile', () => {
    const fresh = createInitialState({ now: later, startDate: '2026-07-01' });
    fresh.entries['2026-07-01'] = { 'starter-read': loggedEntry(15, later) };
    const cloud = state('cloud-generation');
    cloud.profile = { ...cloud.profile, displayName: 'Cloud Harsh', updatedAt: earlier };
    cloud.habits[0] = { ...cloud.habits[0], name: '12K steps', updatedAt: earlier };

    const resolution = resolveInitialSync(fresh, cloud);

    expect(resolution.state.profile.displayName).toBe('Cloud Harsh');
    expect(resolution.state.habits[0].name).toBe('12K steps');
    expect(resolution.state.entries['2026-07-01']['starter-read'].value).toBe(15);
  });
});

describe('entity merge', () => {
  it('keeps independent edits to different habits and preserves explicit order', () => {
    const laptop = state();
    const phone = state();
    laptop.habits[0] = { ...laptop.habits[0], name: '12K steps', updatedAt: later, order: 2 };
    phone.habits[1] = { ...phone.habits[1], name: 'Read fiction', updatedAt: later, order: 0 };

    const merged = mergeSameGeneration(laptop, phone);

    expect(merged.habits.find((habit) => habit.id === 'starter-steps')?.name).toBe('12K steps');
    expect(merged.habits.find((habit) => habit.id === 'starter-read')?.name).toBe('Read fiction');
    expect(merged.habits[0].id).toBe('starter-read');
  });

  it('serializes only local merge winners instead of rewriting unrelated cloud documents', () => {
    const local = state();
    const cloud = state();
    local.habits[0] = { ...local.habits[0], name: '12K steps', updatedAt: latest };
    cloud.habits[1] = { ...cloud.habits[1], name: 'Read fiction', updatedAt: later };
    const merged = mergeSameGeneration(local, cloud);

    const delta = serializeTrackerDelta(cloud, merged);

    expect(delta.root).toBeUndefined();
    expect(delta.habits.map((document) => document.data.id)).toEqual(['starter-steps']);
    expect(delta.entries).toEqual([]);
  });

  it('uses the newer write when both devices edit the same entry', () => {
    const laptop = state();
    const phone = state();
    laptop.entries['2026-07-01'] = { 'starter-read': loggedEntry(10, earlier) };
    phone.entries['2026-07-01'] = { 'starter-read': loggedEntry(30, later) };

    const merged = mergeSameGeneration(laptop, phone);

    expect(merged.entries['2026-07-01']['starter-read'].value).toBe(30);
    expect(mergeSameGeneration(phone, laptop)).toEqual(merged);
  });

  it('never merges entities across two real generations', () => {
    const oldCloud = state('generation-old');
    oldCloud.generationUpdatedAt = earlier;
    oldCloud.entries['2026-07-01'] = { 'starter-read': loggedEntry(99, later) };
    const resetLocal = state('generation-reset');
    resetLocal.generationUpdatedAt = later;
    resetLocal.generationPending = true;

    const resolution = resolveInitialSync(resetLocal, oldCloud);

    expect(resolution.mode).toBe('accept-local-generation');
    expect(resolution.state.entries).toEqual({});
    expect(resolution.shouldWriteCloud).toBe(true);
  });

  it('accepts the server generation when a different local generation is already acknowledged', () => {
    const local = state('generation-local-old');
    local.generationUpdatedAt = latest;
    local.generationPending = false;
    const cloud = state('generation-server-current');
    cloud.generationUpdatedAt = earlier;

    const resolution = resolveInitialSync(local, cloud);

    expect(resolution.mode).toBe('accept-cloud-generation');
    expect(resolution.state).toBe(cloud);
  });

  it('turns a JSON import into a new authoritative generation without losing its record', () => {
    const imported = state('backup-generation');
    imported.entries['2026-07-01'] = { 'starter-read': loggedEntry(20, earlier) };

    const replacement = createReplacementGeneration(imported, 'import-generation', later);

    expect(replacement.generationId).toBe('import-generation');
    expect(replacement.generationUpdatedAt).toBe(later);
    expect(replacement.generationPending).toBe(true);
    expect(replacement.entries).toEqual(imported.entries);
    expect(replacement.profile.updatedAt).toBe(later);
    expect(replacement.habits.every((habit) => habit.updatedAt === later)).toBe(true);
  });
});

describe('cloud document conversion', () => {
  it('materializes only documents in the root generation', () => {
    const current = state('generation-current');
    const root = serializeRootDocument(current);
    const currentHabit: CloudHabitDocument = {
      ...current.habits[0],
      generationId: 'generation-current',
    };
    const staleHabit: CloudHabitDocument = {
      ...current.habits[1],
      name: 'Must not return',
      generationId: 'generation-before-reset',
    };
    const currentEntry: CloudEntryDocument = {
      ...loggedEntry(1),
      generationId: 'generation-current',
      date: '2026-07-01',
      habitId: currentHabit.id,
    };
    const staleEntry: CloudEntryDocument = {
      ...loggedEntry(500, later),
      generationId: 'generation-before-reset',
      date: '2026-06-30',
      habitId: staleHabit.id,
    };

    const hydrated = materializeCloudState(
      root,
      [staleHabit, currentHabit],
      [staleEntry, currentEntry],
    );

    expect(hydrated.habits.map((habit) => habit.id)).toEqual([currentHabit.id]);
    expect(hydrated.entries).toEqual({
      '2026-07-01': { [currentHabit.id]: loggedEntry(1) },
    });
  });

  it('omits undefined values recursively before Firestore writes', () => {
    const testHabit = {
      ...state().habits[0],
      archivedAt: undefined,
      pauses: [{ start: '2026-07-01', end: undefined }],
    };
    const serializedHabit = serializeHabitDocument(testHabit, 'generation-a');
    const serializedEntry = serializeEntryDocument(
      '2026-07-01',
      testHabit.id,
      { value: 0, note: undefined, skipped: undefined, updatedAt: earlier },
      'generation-a',
    );

    expect(serializedHabit.data).not.toHaveProperty('archivedAt');
    expect(serializedHabit.data.pauses?.[0]).toEqual({ start: '2026-07-01' });
    expect(serializedEntry.data).not.toHaveProperty('note');
    expect(serializedEntry.data).not.toHaveProperty('skipped');
  });

  it('encodes unsafe path characters in deterministic document IDs', () => {
    expect(habitDocumentId('generation-a', '../strength/work')).toBe(
      'generation-a__%2E%2E%2Fstrength%2Fwork',
    );
    expect(entryDocumentId('generation-a', '2026-07-01', 'read / reflect')).toBe(
      'generation-a__2026-07-01__read%20%2F%20reflect',
    );
  });
});
