import {
  daysBetween,
  minuteOfDayFromIso,
  weekdayOf,
} from './dates';
import type {
  DateKey,
  FareState,
  Food,
  FoodEntry,
  MealSlot,
  SavedMeal,
} from './model';

export type UsualKind = 'food' | 'meal';

export interface UsualsContext {
  readonly dateKey: DateKey;
  readonly query?: string;
  readonly mealSlot?: MealSlot;
  readonly minuteOfDay?: number;
  readonly limit?: number;
}

export interface UsualScoreBreakdown {
  readonly text: number;
  readonly pinned: number;
  readonly frequency: number;
  readonly recency: number;
  readonly weekday: number;
  readonly meal: number;
  readonly time: number;
}

export interface UsualSuggestion {
  readonly id: string;
  readonly kind: UsualKind;
  readonly name: string;
  readonly brand?: string;
  readonly score: number;
  readonly timesLogged: number;
  readonly lastLoggedDateKey?: DateKey;
  readonly breakdown: UsualScoreBreakdown;
  readonly food?: Food;
  readonly meal?: SavedMeal;
}

interface Candidate {
  readonly id: string;
  readonly kind: UsualKind;
  readonly name: string;
  readonly brand?: string;
  readonly aliases: readonly string[];
  readonly pinned: boolean;
  readonly food?: Food;
  readonly meal?: SavedMeal;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function textScore(candidate: Candidate, rawQuery: string): number | undefined {
  const query = normalizeText(rawQuery);
  if (!query) return 0;

  const name = normalizeText(candidate.name);
  const brand = normalizeText(candidate.brand ?? '');
  const aliases = candidate.aliases.map(normalizeText);
  const fields = [name, brand, ...aliases];
  const tokens = query.split(' ');
  if (!fields.some((field) => tokens.every((token) => field.includes(token)))) {
    return undefined;
  }
  if (name === query) return 90;
  if (aliases.includes(query)) return 82;
  if (name.startsWith(query)) return 72;
  if (aliases.some((alias) => alias.startsWith(query))) return 65;
  if (name.includes(query)) return 55;
  if (brand.includes(query)) return 42;
  return 35;
}

function linkedEntries(
  entries: readonly FoodEntry[],
  candidate: Candidate,
  dateKey: DateKey,
): FoodEntry[] {
  const linked = entries.filter((entry) => {
    if (entry.deleted || daysBetween(entry.dateKey, dateKey) < 0) return false;
    return candidate.kind === 'food'
      ? entry.foodId === candidate.id
      : entry.mealId === candidate.id;
  });

  // Logging a saved meal creates one diary entry per food, all with the same
  // meal id and timestamp. Count that batch as one use so a five-item meal is
  // not ranked as though it were logged five separate times.
  if (candidate.kind === 'food') return linked;
  return [...new Map(linked.map((entry) => [
    `${entry.dateKey}|${entry.consumedAt}|${entry.mealSlot}`,
    entry,
  ])).values()];
}

function circularMinuteDistance(left: number, right: number): number {
  const difference = Math.abs(left - right) % 1_440;
  return Math.min(difference, 1_440 - difference);
}

function compareSuggestions(left: UsualSuggestion, right: UsualSuggestion): number {
  if (right.score !== left.score) return right.score - left.score;
  const recency = (right.lastLoggedDateKey ?? '').localeCompare(
    left.lastLoggedDateKey ?? '',
  );
  if (recency !== 0) return recency;
  const name = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  return name !== 0 ? name : left.id.localeCompare(right.id);
}

/**
 * Ranks local foods and meals only. It never performs network IO and relies on
 * the supplied date/time, which makes suggestions repeatable across devices.
 */
export function rankUsuals(
  state: Pick<FareState, 'foods' | 'meals' | 'entries'>,
  context: UsualsContext,
): UsualSuggestion[] {
  const candidates: Candidate[] = [
    ...state.foods
      .filter((food) => !food.deleted)
      .map((food) => ({
        id: food.id,
        kind: 'food' as const,
        name: food.name,
        brand: food.brand,
        aliases: food.aliases,
        pinned: food.pinned,
        food,
      })),
    ...state.meals
      .filter((meal) => !meal.deleted)
      .map((meal) => ({
        id: meal.id,
        kind: 'meal' as const,
        name: meal.name,
        aliases: meal.aliases,
        pinned: meal.pinned,
        meal,
      })),
  ];

  const desiredWeekday = weekdayOf(context.dateKey);
  const desiredMinute = context.minuteOfDay;
  const suggestions: UsualSuggestion[] = [];

  for (const candidate of candidates) {
    const text = textScore(candidate, context.query ?? '');
    if (text === undefined) continue;
    const history = linkedEntries(state.entries, candidate, context.dateKey);
    const lastLoggedDateKey = history.reduce<DateKey | undefined>(
      (latest, entry) =>
        latest === undefined || entry.dateKey > latest ? entry.dateKey : latest,
      undefined,
    );
    const age = lastLoggedDateKey
      ? Math.max(0, daysBetween(lastLoggedDateKey, context.dateKey))
      : undefined;
    const sameWeekday = history.filter(
      (entry) => weekdayOf(entry.dateKey) === desiredWeekday,
    ).length;
    const sameMeal = context.mealSlot
      ? history.filter((entry) => entry.mealSlot === context.mealSlot).length
      : 0;
    const timeDistances = desiredMinute === undefined
      ? []
      : history.flatMap((entry) => {
          const minute = entry.consumedMinute ?? minuteOfDayFromIso(entry.consumedAt);
          return minute === undefined
            ? []
            : [circularMinuteDistance(minute, desiredMinute)];
        });
    const closestMinutes = timeDistances.length > 0
      ? Math.min(...timeDistances)
      : undefined;

    const breakdown: UsualScoreBreakdown = {
      text,
      pinned: candidate.pinned ? 24 : 0,
      frequency: Math.min(24, Math.log2(history.length + 1) * 6),
      recency: age === undefined ? 0 : Math.max(0, 18 - age * 0.6),
      weekday: history.length > 0 ? (sameWeekday / history.length) * 10 : 0,
      meal: history.length > 0 ? (sameMeal / history.length) * 14 : 0,
      time: closestMinutes === undefined
        ? 0
        : Math.max(0, 10 - closestMinutes / 18),
    };
    const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    suggestions.push({
      id: candidate.id,
      kind: candidate.kind,
      name: candidate.name,
      brand: candidate.brand,
      score,
      timesLogged: history.length,
      lastLoggedDateKey,
      breakdown,
      food: candidate.food,
      meal: candidate.meal,
    });
  }

  const limit = Math.max(0, Math.floor(context.limit ?? 8));
  return suggestions.sort(compareSuggestions).slice(0, limit);
}
