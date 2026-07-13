/**
 * Fare's persisted domain model.
 *
 * Deleted collection items deliberately remain in their arrays as tombstones.
 * This lets sync propagate a deletion instead of accidentally resurrecting an
 * older copy from another device.
 */

export const FARE_STATE_VERSION = 1 as const;

export type FareStateVersion = typeof FARE_STATE_VERSION;
export type DateKey = string;
export type IsoDateTime = string;

export type MealSlot =
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'snack'
  | 'other';

export interface Nutrition {
  readonly calories: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly saturatedFatG: number;
  readonly fiberG: number;
  readonly sugarG: number;
  readonly sodiumMg: number;
}

export interface Serving {
  readonly quantity: number;
  readonly unit: string;
  readonly label: string;
}

export type NutritionDataQuality =
  | 'verified'
  | 'complete'
  | 'partial'
  | 'insufficient';

export type NutritionSourceKind =
  | 'manual'
  | 'open-food-facts'
  | 'saved-food'
  | 'saved-meal';

export interface NutritionProvenance {
  readonly kind: NutritionSourceKind;
  readonly providerName: string;
  readonly externalId?: string;
  readonly sourceUrl?: string;
  readonly fetchedAt?: IsoDateTime;
  readonly dataQuality: NutritionDataQuality;
  readonly warnings: readonly string[];
}

/** A historical, self-contained copy. Never resolve it through a live Food. */
export interface NutritionSnapshot {
  readonly name: string;
  readonly brand?: string;
  readonly imageUrl?: string;
  readonly serving: Serving;
  readonly servings: number;
  readonly nutritionPerServing: Nutrition;
  readonly nutrition: Nutrition;
  readonly provenance: NutritionProvenance;
}

export interface FareProfile {
  readonly displayName: string;
  readonly birthDate?: DateKey;
  readonly heightCm?: number;
  readonly weightKg?: number;
  readonly onboardingComplete: boolean;
  readonly updatedAt: IsoDateTime;
}

export interface NutritionTargets {
  readonly calories: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly fiberG: number;
  readonly sodiumMg: number;
  readonly updatedAt: IsoDateTime;
}

export type WeightUnit = 'lb' | 'kg';
export type EnergyUnit = 'kcal';
export type WeekStartsOn = 0 | 1;

export interface FareSettings {
  readonly weightUnit: WeightUnit;
  readonly energyUnit: EnergyUnit;
  readonly theme: 'dark' | 'light' | 'system';
  readonly weekStartsOn: WeekStartsOn;
  readonly showMacroTargets: boolean;
  readonly updatedAt: IsoDateTime;
}

interface CollectionEntity {
  readonly id: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** Durable sync tombstone. Tombstoned items must not appear in the UI. */
  readonly deleted?: boolean;
  readonly deletedAt?: IsoDateTime;
}

export interface Food extends CollectionEntity {
  readonly name: string;
  readonly brand?: string;
  readonly aliases: readonly string[];
  readonly imageUrl?: string;
  readonly barcode?: string;
  readonly serving: Serving;
  readonly nutritionPerServing: Nutrition;
  readonly provenance: NutritionProvenance;
  readonly pinned: boolean;
}

export interface SavedMealItem {
  readonly id: string;
  readonly foodId?: string;
  readonly servings: number;
  readonly snapshot: NutritionSnapshot;
}

export interface SavedMeal extends CollectionEntity {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly items: readonly SavedMealItem[];
  readonly defaultSlot?: MealSlot;
  readonly pinned: boolean;
}

export type FoodEntryOrigin = 'food' | 'meal' | 'quick-add';

export interface FoodEntry extends CollectionEntity {
  readonly dateKey: DateKey;
  readonly consumedAt: IsoDateTime;
  /** Local wall-clock minute (0–1439), retained for timezone-stable Usuals. */
  readonly consumedMinute?: number;
  readonly mealSlot: MealSlot;
  readonly origin: FoodEntryOrigin;
  /** Optional links improve Usuals, but the immutable snapshot is authoritative. */
  readonly foodId?: string;
  readonly mealId?: string;
  readonly snapshot: NutritionSnapshot;
  readonly note?: string;
}

export interface FareState {
  readonly version: 1;
  readonly profile: FareProfile;
  readonly targets: NutritionTargets;
  readonly settings: FareSettings;
  readonly foods: Food[];
  readonly meals: SavedMeal[];
  readonly entries: FoodEntry[];
}

export interface CreateIdFactoryOptions {
  readonly now?: () => number;
  readonly random?: () => number;
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'item';
}

/**
 * Creates collision-resistant, sortable-enough local identifiers. Dependencies
 * are injectable so import/migration code and tests can be deterministic.
 */
export function createIdFactory(
  options: CreateIdFactoryOptions = {},
): (prefix?: string) => string {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  let sequence = 0;

  return (prefix = 'item') => {
    sequence = (sequence + 1) % 1_679_616; // 36^4
    const time = Math.max(0, Math.floor(now())).toString(36);
    const entropy = Math.floor(Math.max(0, Math.min(0.999999999999, random())) * 2_176_782_336)
      .toString(36)
      .padStart(6, '0');
    const counter = sequence.toString(36).padStart(4, '0');
    return `${normalizePrefix(prefix)}_${time}_${entropy}${counter}`;
  };
}

export const createId = createIdFactory();

export const EMPTY_NUTRITION: Nutrition = Object.freeze({
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  saturatedFatG: 0,
  fiberG: 0,
  sugarG: 0,
  sodiumMg: 0,
});

function cloneNutrition(nutrition: Nutrition): Nutrition {
  return Object.freeze({ ...nutrition });
}

/** Builds and freezes a defensive nutrition-history copy. */
export function createNutritionSnapshot(
  value: NutritionSnapshot,
): NutritionSnapshot {
  return Object.freeze({
    ...value,
    serving: Object.freeze({ ...value.serving }),
    nutritionPerServing: cloneNutrition(value.nutritionPerServing),
    nutrition: cloneNutrition(value.nutrition),
    provenance: Object.freeze({
      ...value.provenance,
      warnings: Object.freeze([...value.provenance.warnings]),
    }),
  });
}

/** Neutral starter values; onboarding should personalize them before guidance. */
export function createStarterState(
  now: IsoDateTime = new Date().toISOString(),
): FareState {
  return {
    version: FARE_STATE_VERSION,
    profile: {
      displayName: '',
      onboardingComplete: false,
      updatedAt: now,
    },
    targets: {
      calories: 2_000,
      proteinG: 150,
      carbsG: 225,
      fatG: 67,
      fiberG: 30,
      sodiumMg: 2_300,
      updatedAt: now,
    },
    settings: {
      weightUnit: 'lb',
      energyUnit: 'kcal',
      theme: 'system',
      weekStartsOn: 1,
      showMacroTargets: true,
      updatedAt: now,
    },
    foods: [],
    meals: [],
    entries: [],
  };
}

export function isTombstoned(
  entity: Pick<CollectionEntity, 'deleted'>,
): boolean {
  return entity.deleted === true;
}
