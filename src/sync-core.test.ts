import { describe, expect, it } from 'vitest';
import { createStarterState, type FareState, type Food } from './model';
import {
  isCloudSingleton,
  materializeCloudState,
  mergeStates,
  omitUndefinedDeep,
  resolveInitialSync,
  selectNewer,
  serializeEntityDocument,
  serializeSingletonDocument,
  stableStringify,
} from './sync-core';

const FIRST = '2026-07-01T10:00:00.000Z';
const LATER = '2026-07-02T10:00:00.000Z';

function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id: 'food-1',
    name: 'Cafe Latte Protein Shake',
    brand: 'Premier Protein',
    aliases: ['latte shake'],
    serving: { quantity: 1, unit: 'bottle', label: '1 bottle' },
    nutritionPerServing: {
      calories: 160,
      proteinG: 30,
      carbsG: 5,
      fatG: 3,
      saturatedFatG: 1,
      fiberG: 1,
      sugarG: 1,
      sodiumMg: 400,
    },
    provenance: {
      kind: 'manual',
      providerName: 'Fare',
      dataQuality: 'complete',
      warnings: [],
    },
    pinned: false,
    createdAt: FIRST,
    updatedAt: FIRST,
    ...overrides,
  };
}

function makeState(overrides: Partial<FareState> = {}): FareState {
  return { ...createStarterState(FIRST), foods: [makeFood()], ...overrides };
}

describe('canonical serialization', () => {
  it('sorts keys and omits undefined values recursively', () => {
    expect(stableStringify({ b: 1, a: 2, c: undefined })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(omitUndefinedDeep({ a: undefined, b: { c: undefined, d: null }, e: [1, undefined] }))
      .toEqual({ b: { d: null }, e: [1] });
  });
});

describe('deterministic last-write-wins', () => {
  it('selects the later timestamp regardless of argument order', () => {
    const oldFood = makeFood({ name: 'Old', updatedAt: FIRST });
    const newFood = makeFood({ name: 'New', updatedAt: LATER });
    expect(selectNewer(oldFood, newFood).name).toBe('New');
    expect(selectNewer(newFood, oldFood).name).toBe('New');
  });

  it('uses a deterministic tie-break for simultaneous changes', () => {
    const apple = makeFood({ name: 'Apple' });
    const zebra = makeFood({ name: 'Zebra' });
    expect(selectNewer(apple, zebra)).toBe(selectNewer(zebra, apple));
  });

  it('lets a newer tombstone defeat an older edit', () => {
    const edit = makeFood({ name: 'Edited', updatedAt: FIRST });
    const deletion = makeFood({ deleted: true, deletedAt: LATER, updatedAt: LATER });
    expect(selectNewer(edit, deletion).deleted).toBe(true);
  });
});

describe('Fare state merge', () => {
  it('merges every singleton independently', () => {
    const local = makeState({
      profile: { displayName: 'Harsh', onboardingComplete: true, updatedAt: LATER },
      targets: { ...createStarterState(FIRST).targets, calories: 2_100, updatedAt: FIRST },
    });
    const remote = makeState({
      profile: { displayName: '', onboardingComplete: false, updatedAt: FIRST },
      targets: { ...createStarterState(FIRST).targets, calories: 2_300, updatedAt: LATER },
    });
    const merged = mergeStates(local, remote);
    expect(merged.profile.displayName).toBe('Harsh');
    expect(merged.targets.calories).toBe(2_300);
  });

  it('unions collection records and returns canonical id order', () => {
    const local = makeState({ foods: [makeFood({ id: 'z-food' })] });
    const remote = makeState({ foods: [makeFood({ id: 'a-food' })] });
    expect(mergeStates(local, remote).foods.map((food) => food.id)).toEqual(['a-food', 'z-food']);
    expect(stableStringify(mergeStates(local, remote))).toBe(stableStringify(mergeStates(remote, local)));
  });
});

describe('initial sync resolution', () => {
  it('uploads all local singleton and collection records to an empty cloud', () => {
    const resolution = resolveInitialSync(makeState(), null);
    expect(resolution.uploadProfile).toBe(true);
    expect(resolution.uploadTargets).toBe(true);
    expect(resolution.uploadSettings).toBe(true);
    expect(resolution.uploadFoods.map((food) => food.id)).toEqual(['food-1']);
  });

  it('uploads only missing or locally newer records', () => {
    const local = makeState({
      foods: [
        makeFood({ id: 'shared' }),
        makeFood({ id: 'local-only' }),
        makeFood({ id: 'conflict', name: 'Local newer', updatedAt: LATER }),
      ],
    });
    const cloud = makeState({
      foods: [
        makeFood({ id: 'shared' }),
        makeFood({ id: 'cloud-only' }),
        makeFood({ id: 'conflict', name: 'Cloud older', updatedAt: FIRST }),
      ],
    });
    const resolution = resolveInitialSync(local, cloud);
    expect(resolution.uploadFoods.map((food) => food.id).sort()).toEqual(['conflict', 'local-only']);
    expect(resolution.state.foods.map((food) => food.id)).toEqual(['cloud-only', 'conflict', 'local-only', 'shared']);
  });
});

describe('cloud materialization and serialization', () => {
  it('uses local singleton fallbacks while keeping cloud entity arrays', () => {
    const fallback = makeState();
    const raw = materializeCloudState(
      { profile: null, targets: null, settings: null },
      [makeFood({ id: 'cloud-food' })],
      [],
      [],
      fallback,
    ) as FareState;
    expect(raw.profile).toBe(fallback.profile);
    expect(raw.foods[0].id).toBe('cloud-food');
  });

  it('strips undefined fields and recognizes stamped singleton documents', () => {
    const { data } = serializeEntityDocument(makeFood({ brand: undefined }));
    expect('brand' in data).toBe(false);
    const profile = serializeSingletonDocument(makeState().profile);
    expect(isCloudSingleton(profile)).toBe(true);
    expect(isCloudSingleton({ displayName: 'missing timestamp' })).toBe(false);
  });
});
