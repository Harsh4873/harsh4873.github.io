import { describe, expect, it } from 'vitest';
import { rankUsuals } from '../src/memory';
import {
  createStarterState,
  type Food,
  type FoodEntry,
  type Nutrition,
  type NutritionSnapshot,
  type SavedMeal,
} from '../src/model';

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

function snapshot(name: string, brand?: string): NutritionSnapshot {
  return {
    name,
    brand,
    serving: { quantity: 1, unit: 'serving', label: '1 serving' },
    servings: 1,
    nutritionPerServing: nutrition,
    nutrition,
    provenance: {
      kind: 'saved-food',
      providerName: 'Fare',
      dataQuality: 'complete',
      warnings: [],
    },
  };
}

function food(id: string, name: string, pinned = false, deleted = false): Food {
  return {
    id,
    name,
    brand: id === 'latte' ? 'Premier Protein' : undefined,
    aliases: id === 'latte' ? ['cafe shake'] : [],
    serving: { quantity: 1, unit: 'serving', label: '1 serving' },
    nutritionPerServing: nutrition,
    provenance: {
      kind: 'manual',
      providerName: 'User',
      dataQuality: 'complete',
      warnings: [],
    },
    pinned,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deleted,
  };
}

function meal(id: string, name: string, pinned = false): SavedMeal {
  return {
    id,
    name,
    aliases: [],
    items: [],
    pinned,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function logged(
  id: string,
  itemId: string,
  dateKey: string,
  mealSlot: FoodEntry['mealSlot'],
  hour = 13,
  kind: 'food' | 'meal' = 'food',
  deleted = false,
): FoodEntry {
  return {
    id,
    dateKey,
    consumedAt: `${dateKey}T${String(hour).padStart(2, '0')}:00:00`,
    consumedMinute: hour * 60,
    mealSlot,
    origin: kind,
    foodId: kind === 'food' ? itemId : undefined,
    mealId: kind === 'meal' ? itemId : undefined,
    snapshot: snapshot(itemId),
    createdAt: `${dateKey}T00:00:00.000Z`,
    updatedAt: `${dateKey}T00:00:00.000Z`,
    deleted,
  };
}

describe('Usuals memory ranking', () => {
  it('combines frequency, recency, weekday, meal, time, and pin signals', () => {
    const state = createStarterState('2026-07-12T00:00:00.000Z');
    state.foods.push(food('latte', 'Cafe Latte Shake'));
    state.foods.push(food('bar', 'Protein Bar', true));
    state.meals.push(meal('lunch-meal', 'Usual lunch'));
    state.entries.push(
      logged('l1', 'latte', '2026-07-05', 'breakfast', 8),
      logged('l2', 'latte', '2026-07-11', 'breakfast', 8),
      logged('b1', 'bar', '2026-06-01', 'snack', 18),
      logged('m1', 'lunch-meal', '2026-07-12', 'lunch', 13, 'meal'),
    );

    const lunch = rankUsuals(state, {
      dateKey: '2026-07-12',
      mealSlot: 'lunch',
      minuteOfDay: 13 * 60,
    });
    expect(lunch[0]).toMatchObject({ id: 'lunch-meal', kind: 'meal' });
    expect(lunch.find((item) => item.id === 'latte')?.breakdown).toMatchObject({
      frequency: expect.any(Number),
      recency: expect.any(Number),
      weekday: expect.any(Number),
      meal: 0,
    });
    expect(lunch.find((item) => item.id === 'bar')?.breakdown.pinned).toBe(24);
  });

  it('uses name, brand, and aliases for explicit local filtering', () => {
    const state = createStarterState();
    state.foods.push(food('latte', 'Cafe Latte Shake'));
    state.foods.push(food('bar', 'Protein Bar'));

    expect(rankUsuals(state, { dateKey: '2026-07-12', query: 'premier' }))
      .toHaveLength(1);
    expect(rankUsuals(state, { dateKey: '2026-07-12', query: 'cafe shake' })[0].id)
      .toBe('latte');
  });

  it('ignores tombstoned catalog items, entries, and future history', () => {
    const state = createStarterState();
    state.foods.push(food('visible', 'Visible'));
    state.foods.push(food('deleted', 'Deleted', true, true));
    state.entries.push(
      logged('past', 'visible', '2026-07-11', 'lunch'),
      logged('tombstone', 'visible', '2026-07-12', 'lunch', 13, 'food', true),
      logged('future', 'visible', '2026-07-13', 'lunch'),
    );

    const result = rankUsuals(state, { dateKey: '2026-07-12' });
    expect(result.map((item) => item.id)).toEqual(['visible']);
    expect(result[0].timesLogged).toBe(1);
  });

  it('uses stable name and id tie-breakers', () => {
    const state = createStarterState();
    state.foods.push(food('z', 'Same'));
    state.foods.push(food('a', 'Same'));
    expect(rankUsuals(state, { dateKey: '2026-07-12' }).map((item) => item.id))
      .toEqual(['a', 'z']);
  });

  it('counts a multi-item saved meal batch as one previous log', () => {
    const state = createStarterState();
    state.meals.push(meal('breakfast-meal', 'Breakfast combo'));
    state.entries.push(
      logged('meal-line-1', 'breakfast-meal', '2026-07-11', 'breakfast', 8, 'meal'),
      logged('meal-line-2', 'breakfast-meal', '2026-07-11', 'breakfast', 8, 'meal'),
      logged('meal-line-3', 'breakfast-meal', '2026-07-11', 'breakfast', 8, 'meal'),
    );

    const [suggestion] = rankUsuals(state, {
      dateKey: '2026-07-12',
      mealSlot: 'breakfast',
      minuteOfDay: 8 * 60,
    });

    expect(suggestion.timesLogged).toBe(1);
    expect(suggestion.breakdown.frequency).toBe(6);
  });
});
