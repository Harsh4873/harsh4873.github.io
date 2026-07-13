import { describe, expect, it } from 'vitest';
import {
  createNutritionSnapshot,
  createStarterState,
  type FoodEntry,
  type Nutrition,
} from '../src/model';
import { parseFareState } from '../src/store';

const nutrition: Nutrition = {
  calories: 160,
  proteinG: 30,
  carbsG: 5,
  fatG: 3,
  saturatedFatG: 1,
  fiberG: 1,
  sugarG: 1,
  sodiumMg: 400,
};

function validState() {
  const state = createStarterState('2026-07-12T12:00:00.000Z');
  const snapshot = createNutritionSnapshot({
    name: 'Cafe Latte Protein Shake',
    brand: 'Premier Protein',
    serving: { quantity: 1, unit: 'bottle', label: '1 bottle' },
    servings: 1,
    nutritionPerServing: nutrition,
    nutrition,
    provenance: {
      kind: 'open-food-facts',
      providerName: 'Open Food Facts',
      externalId: '0643843716686',
      sourceUrl: 'https://world.openfoodfacts.org/product/0643843716686',
      fetchedAt: '2026-07-12T11:00:00.000Z',
      dataQuality: 'complete',
      warnings: ['Compare with the package label.'],
    },
  });
  const entry: FoodEntry = {
    id: 'entry-1',
    createdAt: '2026-07-12T12:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    dateKey: '2026-07-12',
    consumedAt: '2026-07-12T12:00:00.000Z',
    consumedMinute: 720,
    mealSlot: 'lunch',
    origin: 'food',
    foodId: 'food-1',
    snapshot,
  };
  state.entries.push(entry);
  return state;
}

describe('Fare state parser', () => {
  it('round-trips valid state and defensively freezes diary snapshots', () => {
    const raw = structuredClone(validState());
    const parsed = parseFareState(raw);

    (raw.entries[0].snapshot.nutrition as { calories: number }).calories = 999;
    (raw.entries[0].snapshot.provenance.warnings as string[]).push('changed');

    expect(parsed.entries[0].snapshot.nutrition.calories).toBe(160);
    expect(parsed.entries[0].snapshot.provenance.warnings).toEqual([
      'Compare with the package label.',
    ]);
    expect(Object.isFrozen(parsed.entries[0].snapshot)).toBe(true);
  });

  it('rejects impossible local dates before they can crash ranking or history', () => {
    const invalidEntry = structuredClone(validState());
    (invalidEntry.entries[0] as unknown as { dateKey: string }).dateKey = '2026-02-30';
    expect(() => parseFareState(invalidEntry)).toThrow(/date must use YYYY-MM-DD/i);

    const invalidProfile = structuredClone(validState());
    (invalidProfile.profile as unknown as { birthDate: string }).birthDate = '2026-13-01';
    expect(() => parseFareState(invalidProfile)).toThrow(/birth date must use YYYY-MM-DD/i);
  });

  it('accepts only HTTPS links that are safe to expose as source actions', () => {
    const unsafe = structuredClone(validState());
    (unsafe.entries[0].snapshot.provenance as unknown as { sourceUrl: string }).sourceUrl = 'javascript:alert(1)';
    expect(() => parseFareState(unsafe)).toThrow(/source URL must use HTTPS/i);
  });

  it('requires complete tombstones and rejects malformed nutrition', () => {
    const missingDeletedAt = structuredClone(validState());
    (missingDeletedAt.entries[0] as unknown as { deleted: boolean }).deleted = true;
    expect(() => parseFareState(missingDeletedAt)).toThrow(/both deleted and deletedAt/i);

    const negativeCalories = structuredClone(validState());
    (negativeCalories.entries[0].snapshot.nutrition as { calories: number }).calories = -1;
    expect(() => parseFareState(negativeCalories)).toThrow(/calories must be at least 0/i);
  });
});
