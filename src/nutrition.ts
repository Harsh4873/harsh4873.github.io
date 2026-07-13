import { addDays, dateRange, startOfWeek } from './dates';
import {
  EMPTY_NUTRITION,
  type DateKey,
  type FoodEntry,
  type MealSlot,
  type Nutrition,
  type NutritionTargets,
  type WeekStartsOn,
} from './model';

const NUTRITION_KEYS = [
  'calories',
  'proteinG',
  'carbsG',
  'fatG',
  'saturatedFatG',
  'fiberG',
  'sugarG',
  'sodiumMg',
] as const satisfies readonly (keyof Nutrition)[];

function safeNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeNutrition(nutrition: Nutrition): Nutrition {
  return Object.fromEntries(
    NUTRITION_KEYS.map((key) => [key, safeNumber(nutrition[key])]),
  ) as unknown as Nutrition;
}

export function addNutrition(...values: readonly Nutrition[]): Nutrition {
  const result = { ...EMPTY_NUTRITION } as Record<keyof Nutrition, number>;
  for (const value of values) {
    for (const key of NUTRITION_KEYS) result[key] += safeNumber(value[key]);
  }
  return result;
}

export function scaleNutrition(
  nutrition: Nutrition,
  multiplier: number,
): Nutrition {
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 0;
  return Object.fromEntries(
    NUTRITION_KEYS.map((key) => [key, safeNumber(nutrition[key]) * safeMultiplier]),
  ) as unknown as Nutrition;
}

export function roundNutrition(
  nutrition: Nutrition,
  precision = 1,
): Nutrition {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new RangeError('Precision must be an integer from 0 through 6');
  }
  const factor = 10 ** precision;
  return Object.fromEntries(
    NUTRITION_KEYS.map((key) => [key, Math.round(nutrition[key] * factor) / factor]),
  ) as unknown as Nutrition;
}

export function totalsForEntries(entries: readonly FoodEntry[]): Nutrition {
  return addNutrition(
    ...entries
      .filter((entry) => !entry.deleted)
      .map((entry) => entry.snapshot.nutrition),
  );
}

export interface DayNutritionSummary {
  readonly dateKey: DateKey;
  readonly totals: Nutrition;
  readonly entryCount: number;
  readonly byMeal: Readonly<Record<MealSlot, Nutrition>>;
}

function emptyMeals(): Record<MealSlot, Nutrition> {
  return {
    breakfast: { ...EMPTY_NUTRITION },
    lunch: { ...EMPTY_NUTRITION },
    dinner: { ...EMPTY_NUTRITION },
    snack: { ...EMPTY_NUTRITION },
    other: { ...EMPTY_NUTRITION },
  };
}

export function summarizeDay(
  entries: readonly FoodEntry[],
  dateKey: DateKey,
): DayNutritionSummary {
  const dayEntries = entries.filter(
    (entry) => !entry.deleted && entry.dateKey === dateKey,
  );
  const byMeal = emptyMeals();
  for (const entry of dayEntries) {
    byMeal[entry.mealSlot] = addNutrition(
      byMeal[entry.mealSlot],
      entry.snapshot.nutrition,
    );
  }
  return {
    dateKey,
    totals: totalsForEntries(dayEntries),
    entryCount: dayEntries.length,
    byMeal,
  };
}

export interface WeekNutritionSummary {
  readonly startDateKey: DateKey;
  readonly endDateKey: DateKey;
  readonly days: readonly DayNutritionSummary[];
  readonly totals: Nutrition;
  /** Average across logged days only; an unlogged day is never treated as zero intake. */
  readonly dailyAverage: Nutrition;
  readonly daysWithEntries: number;
}

export function summarizeWeek(
  entries: readonly FoodEntry[],
  anchorDateKey: DateKey,
  weekStartsOn: WeekStartsOn = 1,
): WeekNutritionSummary {
  const startDateKey = startOfWeek(anchorDateKey, weekStartsOn);
  const endDateKey = addDays(startDateKey, 6);
  const days = dateRange(startDateKey, endDateKey).map((dateKey) =>
    summarizeDay(entries, dateKey),
  );
  const totals = addNutrition(...days.map((day) => day.totals));
  const daysWithEntries = days.filter((day) => day.entryCount > 0).length;
  return {
    startDateKey,
    endDateKey,
    days,
    totals,
    dailyAverage: scaleNutrition(totals, daysWithEntries > 0 ? 1 / daysWithEntries : 0),
    daysWithEntries,
  };
}

export interface TargetProgress {
  readonly consumed: number;
  readonly target: number;
  readonly remaining: number;
  readonly ratio: number;
}

function progress(consumed: number, target: number): TargetProgress {
  const safeConsumed = safeNumber(consumed);
  const safeTarget = safeNumber(target);
  return {
    consumed: safeConsumed,
    target: safeTarget,
    remaining: Math.max(0, safeTarget - safeConsumed),
    ratio: safeTarget > 0 ? safeConsumed / safeTarget : 0,
  };
}

export type NutritionTargetProgress = Readonly<{
  calories: TargetProgress;
  proteinG: TargetProgress;
  carbsG: TargetProgress;
  fatG: TargetProgress;
  fiberG: TargetProgress;
  sodiumMg: TargetProgress;
}>;

export function progressAgainstTargets(
  nutrition: Nutrition,
  targets: NutritionTargets,
): NutritionTargetProgress {
  return {
    calories: progress(nutrition.calories, targets.calories),
    proteinG: progress(nutrition.proteinG, targets.proteinG),
    carbsG: progress(nutrition.carbsG, targets.carbsG),
    fatG: progress(nutrition.fatG, targets.fatG),
    fiberG: progress(nutrition.fiberG, targets.fiberG),
    sodiumMg: progress(nutrition.sodiumMg, targets.sodiumMg),
  };
}
