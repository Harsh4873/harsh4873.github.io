import { useCallback, useEffect, useRef, useState } from 'react';
import { isDateKey, minuteOfDay } from './dates';
import {
  createId,
  createNutritionSnapshot,
  createStarterState,
  type FareProfile,
  type FareSettings,
  type FareState,
  type Food,
  type FoodEntry,
  type MealSlot,
  type Nutrition,
  type NutritionProvenance,
  type NutritionSnapshot,
  type NutritionTargets,
  type SavedMeal,
  type SavedMealItem,
  type Serving,
} from './model';
import { scaleNutrition } from './nutrition';
import { mergeStates, stableStringify } from './sync-core';

const LOCAL_KEY = 'fare-state-v1';
const RECOVERY_PREFIX = 'fare-recovery-';
const DATABASE_NAME = 'fare-local';
const DATABASE_VERSION = 1;
const STORE_NAME = 'state';
const STORE_KEY = 'current';
const EPOCH = new Date(0).toISOString();

interface StorageEnvelope {
  savedAt: number;
  state: FareState;
}

export type StorageMode = 'indexeddb' | 'localStorage';

export type FareMutation =
  | { type: 'profile'; profile: FareProfile }
  | { type: 'targets'; targets: NutritionTargets }
  | { type: 'settings'; settings: FareSettings }
  | { type: 'foods'; foods: Food[] }
  | { type: 'meals'; meals: SavedMeal[] }
  | { type: 'entries'; entries: FoodEntry[] }
  | { type: 'replace'; state: FareState };

export type FareMutationListener = (mutation: FareMutation) => void;

export type NewFood = Omit<Food, 'id' | 'createdAt' | 'updatedAt' | 'deleted' | 'deletedAt'>;
export type NewMeal = Omit<SavedMeal, 'id' | 'createdAt' | 'updatedAt' | 'deleted' | 'deletedAt'>;
export type NewEntry = Omit<FoodEntry, 'id' | 'createdAt' | 'updatedAt' | 'deleted' | 'deletedAt'>;

export interface FareStore {
  state: FareState | null;
  storageMode: StorageMode;
  addFood: (food: NewFood) => Food | undefined;
  updateFood: (id: string, patch: Partial<NewFood>) => void;
  deleteFood: (id: string) => void;
  addMeal: (meal: NewMeal) => SavedMeal | undefined;
  updateMeal: (id: string, patch: Partial<NewMeal>) => void;
  deleteMeal: (id: string) => void;
  addEntry: (entry: NewEntry) => FoodEntry | undefined;
  updateEntry: (id: string, patch: Partial<NewEntry>) => void;
  deleteEntry: (id: string) => void;
  logFood: (food: Food, options: LogFoodOptions) => FoodEntry | undefined;
  logMeal: (meal: SavedMeal, options: LogMealOptions) => FoodEntry[];
  copyEntry: (id: string, dateKey: string, mealSlot?: MealSlot) => FoodEntry | undefined;
  copyDay: (fromDateKey: string, toDateKey: string) => FoodEntry[];
  updateProfile: (patch: Partial<Omit<FareProfile, 'updatedAt'>>) => void;
  updateTargets: (patch: Partial<Omit<NutritionTargets, 'updatedAt'>>) => void;
  updateSettings: (patch: Partial<Omit<FareSettings, 'updatedAt'>>) => void;
  replaceState: (state: FareState) => void;
  resetState: () => void;
  clearLocalData: () => Promise<void>;
  applySyncedState: (state: FareState) => void;
  subscribeMutations: (listener: FareMutationListener) => () => void;
}

export interface LogFoodOptions {
  dateKey: string;
  mealSlot: MealSlot;
  servings?: number;
  consumedAt?: string;
  note?: string;
}

export interface LogMealOptions {
  dateKey: string;
  mealSlot?: MealSlot;
  consumedAt?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`${field} must be text.`);
  return value;
}

function optionalText(value: unknown, field: string) {
  return value === undefined ? undefined : text(value, field);
}

function optionalHttpsUrl(value: unknown, field: string) {
  const result = optionalText(value, field);
  if (result === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  if (url.protocol !== 'https:') throw new Error(`${field} must use HTTPS.`);
  return url.toString();
}

function dateKey(value: unknown, field: string) {
  const result = text(value, field);
  if (!isDateKey(result)) throw new Error(`${field} must use YYYY-MM-DD.`);
  return result;
}

function numberValue(value: unknown, field: string, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error(`${field} must be at least ${minimum}.`);
  return value;
}

function booleanValue(value: unknown, field: string) {
  if (typeof value !== 'boolean') throw new Error(`${field} must be true or false.`);
  return value;
}

function timestamp(value: unknown, field: string) {
  const result = text(value, field);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${field} must be a timestamp.`);
  return result;
}

function validId(value: unknown) {
  const id = text(value, 'id');
  if (id === '.' || id === '..' || id.includes('/') || id.length > 240) throw new Error('Record id is invalid.');
  return id;
}

function textList(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${field} must be a text list.`);
  return value as string[];
}

const NUTRITION_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'saturatedFatG', 'fiberG', 'sugarG', 'sodiumMg'] as const;

function parseNutrition(value: unknown): Nutrition {
  const raw = object(value);
  return Object.fromEntries(NUTRITION_KEYS.map((key) => [key, numberValue(raw[key], key)])) as unknown as Nutrition;
}

function parseServing(value: unknown): Serving {
  const raw = object(value);
  return {
    quantity: numberValue(raw.quantity, 'serving quantity', 0.000001),
    unit: text(raw.unit, 'serving unit'),
    label: text(raw.label, 'serving label'),
  };
}

function parseProvenance(value: unknown): NutritionProvenance {
  const raw = object(value);
  const kinds = ['manual', 'open-food-facts', 'saved-food', 'saved-meal'];
  const qualities = ['verified', 'complete', 'partial', 'insufficient'];
  const kind = text(raw.kind, 'source kind');
  const dataQuality = text(raw.dataQuality, 'data quality');
  if (!kinds.includes(kind) || !qualities.includes(dataQuality)) throw new Error('Nutrition source is unsupported.');
  return {
    kind: kind as NutritionProvenance['kind'],
    providerName: text(raw.providerName, 'provider name'),
    externalId: optionalText(raw.externalId, 'external id'),
    sourceUrl: optionalHttpsUrl(raw.sourceUrl, 'source URL'),
    fetchedAt: raw.fetchedAt === undefined ? undefined : timestamp(raw.fetchedAt, 'fetchedAt'),
    dataQuality: dataQuality as NutritionProvenance['dataQuality'],
    warnings: textList(raw.warnings, 'warnings'),
  };
}

function parseSnapshot(value: unknown): NutritionSnapshot {
  const raw = object(value);
  return createNutritionSnapshot({
    name: text(raw.name, 'food name'),
    brand: optionalText(raw.brand, 'brand'),
    imageUrl: optionalHttpsUrl(raw.imageUrl, 'image URL'),
    serving: parseServing(raw.serving),
    servings: numberValue(raw.servings, 'servings', 0.000001),
    nutritionPerServing: parseNutrition(raw.nutritionPerServing),
    nutrition: parseNutrition(raw.nutrition),
    provenance: parseProvenance(raw.provenance),
  });
}

function entityFields(raw: Record<string, unknown>) {
  const deleted = raw.deleted === undefined ? undefined : booleanValue(raw.deleted, 'deleted');
  if (deleted === false) throw new Error('Deleted may only be true when present.');
  const deletedAt = raw.deletedAt === undefined ? undefined : timestamp(raw.deletedAt, 'deletedAt');
  if ((deleted === true) !== (deletedAt !== undefined)) {
    throw new Error('Deleted records must include both deleted and deletedAt.');
  }
  return {
    id: validId(raw.id),
    createdAt: timestamp(raw.createdAt, 'createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'updatedAt'),
    deleted,
    deletedAt,
  };
}

function parseFood(value: unknown): Food {
  const raw = object(value);
  return {
    ...entityFields(raw),
    name: text(raw.name, 'food name'),
    brand: optionalText(raw.brand, 'brand'),
    aliases: textList(raw.aliases, 'aliases'),
    imageUrl: optionalHttpsUrl(raw.imageUrl, 'image URL'),
    barcode: optionalText(raw.barcode, 'barcode'),
    serving: parseServing(raw.serving),
    nutritionPerServing: parseNutrition(raw.nutritionPerServing),
    provenance: parseProvenance(raw.provenance),
    pinned: booleanValue(raw.pinned, 'pinned'),
  };
}

function parseMealItem(value: unknown): SavedMealItem {
  const raw = object(value);
  return {
    id: validId(raw.id),
    foodId: optionalText(raw.foodId, 'food id'),
    servings: numberValue(raw.servings, 'servings', 0.000001),
    snapshot: parseSnapshot(raw.snapshot),
  };
}

const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

function parseMealSlot(value: unknown): MealSlot {
  const slot = text(value, 'meal slot');
  if (!MEAL_SLOTS.includes(slot as MealSlot)) throw new Error('Meal slot is unsupported.');
  return slot as MealSlot;
}

function parseMeal(value: unknown): SavedMeal {
  const raw = object(value);
  if (!Array.isArray(raw.items)) throw new Error('Meal items must be a list.');
  return {
    ...entityFields(raw),
    name: text(raw.name, 'meal name'),
    aliases: textList(raw.aliases, 'aliases'),
    items: raw.items.map(parseMealItem),
    defaultSlot: raw.defaultSlot === undefined ? undefined : parseMealSlot(raw.defaultSlot),
    pinned: booleanValue(raw.pinned, 'pinned'),
  };
}

function parseEntry(value: unknown): FoodEntry {
  const raw = object(value);
  const origins = ['food', 'meal', 'quick-add'];
  const origin = text(raw.origin, 'entry origin');
  if (!origins.includes(origin)) throw new Error('Entry origin is unsupported.');
  const consumedMinute = raw.consumedMinute === undefined ? undefined : numberValue(raw.consumedMinute, 'consumed minute');
  if (consumedMinute !== undefined && consumedMinute > 1439) throw new Error('Consumed minute is invalid.');
  return {
    ...entityFields(raw),
    dateKey: dateKey(raw.dateKey, 'date'),
    consumedAt: timestamp(raw.consumedAt, 'consumedAt'),
    consumedMinute,
    mealSlot: parseMealSlot(raw.mealSlot),
    origin: origin as FoodEntry['origin'],
    foodId: optionalText(raw.foodId, 'food id'),
    mealId: optionalText(raw.mealId, 'meal id'),
    snapshot: parseSnapshot(raw.snapshot),
    note: optionalText(raw.note, 'note'),
  };
}

export function parseFareState(value: unknown): FareState {
  const raw = object(value);
  if (raw.version !== 1) throw new Error('Unsupported Fare data version.');
  const profile = object(raw.profile);
  const targets = object(raw.targets);
  const settings = object(raw.settings);
  if (!Array.isArray(raw.foods) || !Array.isArray(raw.meals) || !Array.isArray(raw.entries)) throw new Error('Fare data is missing foods, meals, or entries.');
  const theme = text(settings.theme, 'theme');
  const weightUnit = text(settings.weightUnit, 'weight unit');
  const weekStartsOn = numberValue(settings.weekStartsOn, 'week start');
  if (!['dark', 'light', 'system'].includes(theme) || !['lb', 'kg'].includes(weightUnit) || ![0, 1].includes(weekStartsOn)) throw new Error('Fare settings are unsupported.');
  return {
    version: 1,
    profile: {
      displayName: text(profile.displayName, 'display name', true),
      birthDate: profile.birthDate === undefined ? undefined : dateKey(profile.birthDate, 'birth date'),
      heightCm: profile.heightCm === undefined ? undefined : numberValue(profile.heightCm, 'height', 1),
      weightKg: profile.weightKg === undefined ? undefined : numberValue(profile.weightKg, 'weight', 1),
      onboardingComplete: booleanValue(profile.onboardingComplete, 'onboarding complete'),
      updatedAt: timestamp(profile.updatedAt, 'profile updatedAt'),
    },
    targets: {
      calories: numberValue(targets.calories, 'calorie target'),
      proteinG: numberValue(targets.proteinG, 'protein target'),
      carbsG: numberValue(targets.carbsG, 'carb target'),
      fatG: numberValue(targets.fatG, 'fat target'),
      fiberG: numberValue(targets.fiberG, 'fiber target'),
      sodiumMg: numberValue(targets.sodiumMg, 'sodium target'),
      updatedAt: timestamp(targets.updatedAt, 'targets updatedAt'),
    },
    settings: {
      weightUnit: weightUnit as FareSettings['weightUnit'],
      energyUnit: 'kcal',
      theme: theme as FareSettings['theme'],
      weekStartsOn: weekStartsOn as FareSettings['weekStartsOn'],
      showMacroTargets: booleanValue(settings.showMacroTargets, 'show macro targets'),
      updatedAt: timestamp(settings.updatedAt, 'settings updatedAt'),
    },
    foods: raw.foods.map(parseFood),
    meals: raw.meals.map(parseMeal),
    entries: raw.entries.map(parseEntry),
  };
}

function parseEnvelope(value: unknown): StorageEnvelope | undefined {
  try {
    const raw = object(value);
    return { savedAt: numberValue(raw.savedAt, 'savedAt'), state: parseFareState(raw.state) };
  } catch {
    return undefined;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedDb(): Promise<unknown> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(STORE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function writeIndexedDb(envelope: StorageEnvelope) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(envelope, STORE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function clearIndexedDbStore() {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function localEnvelope(): StorageEnvelope | undefined {
  const rawText = localStorage.getItem(LOCAL_KEY);
  if (!rawText) return undefined;
  try {
    return parseEnvelope(JSON.parse(rawText));
  } catch {
    try { localStorage.setItem(`${RECOVERY_PREFIX}${Date.now()}`, rawText); } catch { /* best effort */ }
    return undefined;
  }
}

function persistLocal(envelope: StorageEnvelope) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(envelope));
}

function makeSnapshot(food: Food, servings: number): NutritionSnapshot {
  return createNutritionSnapshot({
    name: food.name,
    brand: food.brand,
    imageUrl: food.imageUrl,
    serving: food.serving,
    servings,
    nutritionPerServing: food.nutritionPerServing,
    nutrition: scaleNutrition(food.nutritionPerServing, servings),
    provenance: food.provenance,
  });
}

function makeTombstone<T extends { id: string; createdAt: string; updatedAt: string }>(entity: T, now: string): T & { deleted: true; deletedAt: string } {
  return { ...entity, updatedAt: now, deleted: true, deletedAt: now };
}

export function useFareStore(): FareStore {
  const [state, setState] = useState<FareState | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('localStorage');
  const stateRef = useRef<FareState | null>(null);
  const listenersRef = useRef(new Set<FareMutationListener>());
  stateRef.current = state;

  const persist = useCallback((next: FareState) => {
    const envelope = { savedAt: Date.now(), state: next };
    try { persistLocal(envelope); } catch { /* IndexedDB may still work */ }
    void writeIndexedDb(envelope).then(() => setStorageMode('indexeddb')).catch(() => setStorageMode('localStorage'));
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = localEnvelope();
      let indexed: StorageEnvelope | undefined;
      try {
        indexed = parseEnvelope(await readIndexedDb());
        if (indexed) setStorageMode('indexeddb');
      } catch {
        setStorageMode('localStorage');
      }
      const selected = [local, indexed].filter((item): item is StorageEnvelope => Boolean(item)).sort((a, b) => b.savedAt - a.savedAt)[0];
      const initial = selected?.state ?? createStarterState(EPOCH);
      if (!active) return;
      stateRef.current = initial;
      setState(initial);
      persist(initial);
    })();
    return () => { active = false; };
  }, [persist]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCAL_KEY || !event.newValue || !stateRef.current) return;
      try {
        const incoming = parseEnvelope(JSON.parse(event.newValue));
        if (!incoming) return;
        const merged = mergeStates(stateRef.current, incoming.state);
        if (stableStringify(merged) === stableStringify(stateRef.current)) return;
        stateRef.current = merged;
        setState(merged);
        void writeIndexedDb({ savedAt: Date.now(), state: merged }).catch(() => undefined);
      } catch { /* ignore corrupt cross-tab payload */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const emit = useCallback((mutation: FareMutation) => {
    listenersRef.current.forEach((listener) => listener(mutation));
  }, []);

  const commit = useCallback((next: FareState, mutation?: FareMutation) => {
    stateRef.current = next;
    setState(next);
    persist(next);
    if (mutation) emit(mutation);
  }, [emit, persist]);

  const addFood = useCallback((draft: NewFood) => {
    const current = stateRef.current;
    if (!current) return undefined;
    const now = new Date().toISOString();
    const food: Food = { ...draft, id: createId('food'), createdAt: now, updatedAt: now };
    commit({ ...current, foods: [...current.foods, food] }, { type: 'foods', foods: [food] });
    return food;
  }, [commit]);

  const updateFood = useCallback((id: string, patch: Partial<NewFood>) => {
    const current = stateRef.current;
    if (!current) return;
    const existing = current.foods.find((food) => food.id === id && !food.deleted);
    if (!existing) return;
    const nextFood: Food = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    commit({ ...current, foods: current.foods.map((food) => food.id === id ? nextFood : food) }, { type: 'foods', foods: [nextFood] });
  }, [commit]);

  const deleteFood = useCallback((id: string) => {
    const current = stateRef.current;
    const existing = current?.foods.find((food) => food.id === id && !food.deleted);
    if (!current || !existing) return;
    const tombstone = makeTombstone(existing, new Date().toISOString());
    commit({ ...current, foods: current.foods.map((food) => food.id === id ? tombstone : food) }, { type: 'foods', foods: [tombstone] });
  }, [commit]);

  const addMeal = useCallback((draft: NewMeal) => {
    const current = stateRef.current;
    if (!current) return undefined;
    const now = new Date().toISOString();
    const meal: SavedMeal = { ...draft, id: createId('meal'), createdAt: now, updatedAt: now };
    commit({ ...current, meals: [...current.meals, meal] }, { type: 'meals', meals: [meal] });
    return meal;
  }, [commit]);

  const updateMeal = useCallback((id: string, patch: Partial<NewMeal>) => {
    const current = stateRef.current;
    const existing = current?.meals.find((meal) => meal.id === id && !meal.deleted);
    if (!current || !existing) return;
    const nextMeal: SavedMeal = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    commit({ ...current, meals: current.meals.map((meal) => meal.id === id ? nextMeal : meal) }, { type: 'meals', meals: [nextMeal] });
  }, [commit]);

  const deleteMeal = useCallback((id: string) => {
    const current = stateRef.current;
    const existing = current?.meals.find((meal) => meal.id === id && !meal.deleted);
    if (!current || !existing) return;
    const tombstone = makeTombstone(existing, new Date().toISOString());
    commit({ ...current, meals: current.meals.map((meal) => meal.id === id ? tombstone : meal) }, { type: 'meals', meals: [tombstone] });
  }, [commit]);

  const addEntry = useCallback((draft: NewEntry) => {
    const current = stateRef.current;
    if (!current) return undefined;
    const now = new Date().toISOString();
    const entry: FoodEntry = { ...draft, id: createId('entry'), createdAt: now, updatedAt: now };
    commit({ ...current, entries: [...current.entries, entry] }, { type: 'entries', entries: [entry] });
    return entry;
  }, [commit]);

  const updateEntry = useCallback((id: string, patch: Partial<NewEntry>) => {
    const current = stateRef.current;
    const existing = current?.entries.find((entry) => entry.id === id && !entry.deleted);
    if (!current || !existing) return;
    const nextEntry: FoodEntry = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    commit({ ...current, entries: current.entries.map((entry) => entry.id === id ? nextEntry : entry) }, { type: 'entries', entries: [nextEntry] });
  }, [commit]);

  const deleteEntry = useCallback((id: string) => {
    const current = stateRef.current;
    const existing = current?.entries.find((entry) => entry.id === id && !entry.deleted);
    if (!current || !existing) return;
    const tombstone = makeTombstone(existing, new Date().toISOString());
    commit({ ...current, entries: current.entries.map((entry) => entry.id === id ? tombstone : entry) }, { type: 'entries', entries: [tombstone] });
  }, [commit]);

  const logFood = useCallback((food: Food, options: LogFoodOptions) => {
    const servings = Math.max(0.01, options.servings ?? 1);
    const consumedAt = options.consumedAt ?? new Date().toISOString();
    return addEntry({
      dateKey: options.dateKey,
      consumedAt,
      consumedMinute: minuteOfDay(new Date(consumedAt)),
      mealSlot: options.mealSlot,
      origin: 'food',
      foodId: food.id,
      snapshot: makeSnapshot(food, servings),
      note: options.note,
    });
  }, [addEntry]);

  const logMeal = useCallback((meal: SavedMeal, options: LogMealOptions) => {
    const current = stateRef.current;
    if (!current || meal.deleted) return [];
    const now = new Date().toISOString();
    const consumedAt = options.consumedAt ?? now;
    const entries = meal.items.map((item): FoodEntry => ({
      id: createId('entry'),
      createdAt: now,
      updatedAt: now,
      dateKey: options.dateKey,
      consumedAt,
      consumedMinute: minuteOfDay(new Date(consumedAt)),
      mealSlot: options.mealSlot ?? meal.defaultSlot ?? 'other',
      origin: 'meal',
      foodId: item.foodId,
      mealId: meal.id,
      snapshot: createNutritionSnapshot({ ...item.snapshot, servings: item.servings, nutrition: scaleNutrition(item.snapshot.nutritionPerServing, item.servings) }),
    }));
    commit({ ...current, entries: [...current.entries, ...entries] }, { type: 'entries', entries });
    return entries;
  }, [commit]);

  const copyEntry = useCallback((id: string, dateKey: string, mealSlot?: MealSlot) => {
    const current = stateRef.current;
    const source = current?.entries.find((entry) => entry.id === id && !entry.deleted);
    if (!source) return undefined;
    const { id: _id, createdAt: _created, updatedAt: _updated, deleted: _deleted, deletedAt: _deletedAt, ...draft } = source;
    return addEntry({ ...draft, dateKey, mealSlot: mealSlot ?? source.mealSlot, consumedAt: new Date().toISOString() });
  }, [addEntry]);

  const copyDay = useCallback((fromDateKey: string, toDateKey: string) => {
    const current = stateRef.current;
    if (!current) return [];
    const source = current.entries.filter((entry) => !entry.deleted && entry.dateKey === fromDateKey);
    const now = new Date().toISOString();
    const entries = source.map((entry): FoodEntry => ({ ...entry, id: createId('entry'), dateKey: toDateKey, consumedAt: now, createdAt: now, updatedAt: now }));
    if (entries.length) commit({ ...current, entries: [...current.entries, ...entries] }, { type: 'entries', entries });
    return entries;
  }, [commit]);

  const updateProfile = useCallback((patch: Partial<Omit<FareProfile, 'updatedAt'>>) => {
    const current = stateRef.current;
    if (!current) return;
    const profile = { ...current.profile, ...patch, updatedAt: new Date().toISOString() };
    commit({ ...current, profile }, { type: 'profile', profile });
  }, [commit]);

  const updateTargets = useCallback((patch: Partial<Omit<NutritionTargets, 'updatedAt'>>) => {
    const current = stateRef.current;
    if (!current) return;
    const targets = { ...current.targets, ...patch, updatedAt: new Date().toISOString() };
    commit({ ...current, targets }, { type: 'targets', targets });
  }, [commit]);

  const updateSettings = useCallback((patch: Partial<Omit<FareSettings, 'updatedAt'>>) => {
    const current = stateRef.current;
    if (!current) return;
    const settings = { ...current.settings, ...patch, updatedAt: new Date().toISOString() };
    commit({ ...current, settings }, { type: 'settings', settings });
  }, [commit]);

  const replaceState = useCallback((incoming: FareState) => {
    const current = stateRef.current;
    if (!current) return;
    const parsed = parseFareState(incoming);
    const now = new Date().toISOString();
    const replaceEntities = <T extends { id: string; createdAt: string; updatedAt: string }>(existing: T[], next: T[]) => {
      const ids = new Set(next.map((item) => item.id));
      return [
        ...next.map((item) => ({ ...item, updatedAt: now })),
        ...existing.filter((item) => !ids.has(item.id)).map((item) => makeTombstone(item, now)),
      ];
    };
    const state: FareState = {
      ...parsed,
      profile: { ...parsed.profile, updatedAt: now },
      targets: { ...parsed.targets, updatedAt: now },
      settings: { ...parsed.settings, updatedAt: now },
      foods: replaceEntities(current.foods, parsed.foods),
      meals: replaceEntities(current.meals, parsed.meals),
      entries: replaceEntities(current.entries, parsed.entries),
    };
    commit(state, { type: 'replace', state });
  }, [commit]);

  const resetState = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const now = new Date().toISOString();
    const fresh = createStarterState(now);
    const state: FareState = {
      ...fresh,
      foods: current.foods.map((food) => makeTombstone(food, now)),
      meals: current.meals.map((meal) => makeTombstone(meal, now)),
      entries: current.entries.map((entry) => makeTombstone(entry, now)),
    };
    commit(state, { type: 'replace', state });
  }, [commit]);

  const clearLocalData = useCallback(async () => {
    localStorage.removeItem(LOCAL_KEY);
    await clearIndexedDbStore();
  }, []);

  const applySyncedState = useCallback((next: FareState) => {
    const parsed = parseFareState(next);
    stateRef.current = parsed;
    setState(parsed);
    persist(parsed);
  }, [persist]);

  const subscribeMutations = useCallback((listener: FareMutationListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  return {
    state,
    storageMode,
    addFood,
    updateFood,
    deleteFood,
    addMeal,
    updateMeal,
    deleteMeal,
    addEntry,
    updateEntry,
    deleteEntry,
    logFood,
    logMeal,
    copyEntry,
    copyDay,
    updateProfile,
    updateTargets,
    updateSettings,
    replaceState,
    resetState,
    clearLocalData,
    applySyncedState,
    subscribeMutations,
  };
}
