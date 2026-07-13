import { describe, expect, it } from 'vitest';
import {
  createIdFactory,
  createNutritionSnapshot,
  createStarterState,
  isTombstoned,
  type NutritionSnapshot,
} from '../src/model';

const snapshotValue: NutritionSnapshot = {
  name: 'Cafe Latte Protein Shake',
  brand: 'Premier Protein',
  serving: { quantity: 1, unit: 'bottle', label: '1 bottle' },
  servings: 1,
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
  nutrition: {
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
    providerName: 'User',
    dataQuality: 'complete',
    warnings: [],
  },
};

describe('Fare model', () => {
  it('creates a valid, isolated v1 starter state', () => {
    const now = '2026-07-12T12:00:00.000Z';
    const first = createStarterState(now);
    const second = createStarterState(now);

    expect(first).toMatchObject({
      version: 1,
      profile: { onboardingComplete: false, updatedAt: now },
      settings: { theme: 'system', weekStartsOn: 1, updatedAt: now },
      targets: { calories: 2_000, updatedAt: now },
      foods: [],
      meals: [],
      entries: [],
    });
    expect(first.foods).not.toBe(second.foods);
  });

  it('generates prefixed deterministic IDs with injected dependencies', () => {
    const id = createIdFactory({ now: () => 1_000, random: () => 0.5 });
    expect(id('Saved Food')).toMatch(/^saved-food_rs_[a-z0-9]{6}0001$/);
    expect(id('Saved Food')).toMatch(/^saved-food_rs_[a-z0-9]{6}0002$/);
  });

  it('defensively copies and freezes historical nutrition snapshots', () => {
    const source = structuredClone(snapshotValue);
    const snapshot = createNutritionSnapshot(source);
    (source.nutrition as { calories: number }).calories = 999;
    (source.provenance.warnings as string[]).push('changed');

    expect(snapshot.nutrition.calories).toBe(160);
    expect(snapshot.provenance.warnings).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nutrition)).toBe(true);
    expect(Object.isFrozen(snapshot.provenance.warnings)).toBe(true);
  });

  it('recognizes only explicit deleted records as tombstones', () => {
    expect(isTombstoned({ deleted: true })).toBe(true);
    expect(isTombstoned({ deleted: false })).toBe(false);
    expect(isTombstoned({})).toBe(false);
  });
});
