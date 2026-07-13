import { describe, expect, it } from 'vitest';
import {
  addNutrition,
  progressAgainstTargets,
  roundNutrition,
  scaleNutrition,
  summarizeDay,
  summarizeWeek,
} from '../src/nutrition';
import type { FoodEntry, Nutrition } from '../src/model';

const base: Nutrition = {
  calories: 160,
  proteinG: 30,
  carbsG: 5,
  fatG: 3,
  saturatedFatG: 1,
  fiberG: 1,
  sugarG: 1,
  sodiumMg: 400,
};

function entry(
  id: string,
  dateKey: string,
  mealSlot: FoodEntry['mealSlot'],
  nutrition: Nutrition = base,
  deleted = false,
): FoodEntry {
  return {
    id,
    dateKey,
    consumedAt: `${dateKey}T13:00:00.000Z`,
    mealSlot,
    origin: 'quick-add',
    snapshot: {
      name: 'Test food',
      serving: { quantity: 1, unit: 'serving', label: '1 serving' },
      servings: 1,
      nutritionPerServing: nutrition,
      nutrition,
      provenance: {
        kind: 'manual',
        providerName: 'User',
        dataQuality: 'complete',
        warnings: [],
      },
    },
    createdAt: `${dateKey}T13:00:00.000Z`,
    updatedAt: `${dateKey}T13:00:00.000Z`,
    deleted,
  };
}

describe('nutrition math', () => {
  it('scales, adds, and rounds every nutrient without mutating inputs', () => {
    const half = scaleNutrition(base, 0.5);
    expect(half).toMatchObject({ calories: 80, proteinG: 15, sodiumMg: 200 });
    expect(addNutrition(base, half)).toMatchObject({
      calories: 240,
      proteinG: 45,
      sodiumMg: 600,
    });
    expect(roundNutrition({ ...base, fiberG: 1.256 }, 1).fiberG).toBe(1.3);
    expect(base.calories).toBe(160);
  });

  it('summarizes a day by meal and ignores tombstones', () => {
    const entries = [
      entry('one', '2026-07-12', 'breakfast'),
      entry('two', '2026-07-12', 'snack', scaleNutrition(base, 0.5)),
      entry('deleted', '2026-07-12', 'lunch', base, true),
      entry('other-day', '2026-07-11', 'breakfast'),
    ];
    const summary = summarizeDay(entries, '2026-07-12');
    expect(summary.entryCount).toBe(2);
    expect(summary.totals.calories).toBe(240);
    expect(summary.byMeal.breakfast.proteinG).toBe(30);
    expect(summary.byMeal.snack.proteinG).toBe(15);
    expect(summary.byMeal.lunch.calories).toBe(0);
  });

  it('builds seven-day summaries without treating unlogged days as zero intake', () => {
    const summary = summarizeWeek(
      [
        entry('monday', '2026-07-06', 'lunch'),
        entry('sunday', '2026-07-12', 'dinner'),
      ],
      '2026-07-09',
      1,
    );
    expect(summary.startDateKey).toBe('2026-07-06');
    expect(summary.endDateKey).toBe('2026-07-12');
    expect(summary.days).toHaveLength(7);
    expect(summary.daysWithEntries).toBe(2);
    expect(summary.totals.calories).toBe(320);
    expect(summary.dailyAverage.calories).toBeCloseTo(320 / 2);
  });

  it('reports target progress and never returns negative remaining values', () => {
    const progress = progressAgainstTargets(base, {
      calories: 150,
      proteinG: 60,
      carbsG: 100,
      fatG: 50,
      fiberG: 25,
      sodiumMg: 2_000,
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    expect(progress.calories.ratio).toBeCloseTo(160 / 150);
    expect(progress.calories.remaining).toBe(0);
    expect(progress.proteinG.remaining).toBe(30);
  });
});
