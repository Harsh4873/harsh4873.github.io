import { useCallback, useEffect, useRef, useState } from 'react';
import { toDateKey } from './dates';
import {
  HABIT_ICONS,
  createInitialState,
  makeGenerationId,
  type Habit,
  type HabitEntry,
  type TrackerProfile,
  type TrackerState,
} from './model';
import {
  LEGACY_GENERATION_UPDATED_AT,
  createReplacementGeneration,
  isDefaultTrackerProfile,
  isUntouchedStarterHabit,
} from './sync-core';

const DATABASE_NAME = 'daymark-tracker';
const DATABASE_VERSION = 1;
const STORE_NAME = 'tracker-state';
const STATE_KEY = 'current';
const LOCAL_KEY = 'daymark-tracker-state-v2';
const LEGACY_LOCAL_KEY = 'daymark-tracker-state-v1';
const RECOVERY_PREFIX = 'daymark-recovery';

type StorageMode = 'indexeddb' | 'localstorage';

interface StoredEnvelope {
  storageFormat: 'daymark-v2';
  savedAt: string;
  state: TrackerState;
}

interface StoredCandidate {
  state: TrackerState;
  savedAt: number;
}

export type TrackerMutation =
  | { type: 'entry'; dateKey: string; habitId: string; entry: HabitEntry }
  | { type: 'habits'; habits: Habit[] }
  | { type: 'profile'; profile: TrackerProfile }
  | { type: 'replace'; state: TrackerState };

export type TrackerMutationListener = (mutation: TrackerMutation) => void;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const METRICS = new Set(['check', 'count', 'duration', 'quantity', 'distance']);
const PERIODS = new Set(['day', 'week', 'month']);
const DIRECTIONS = new Set(['atLeast', 'atMost']);
const TIME_SLOTS = new Set(['morning', 'anytime', 'evening']);
const THEMES = new Set(['dark', 'light', 'system']);

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function parseTrackerState(value: unknown, migrationTimestamp = new Date().toISOString()): TrackerState {
  if (!isObject(value) || ![1, 2].includes(value.version as number)) {
    throw new Error('This is not a supported Daymark backup.');
  }
  if (!isObject(value.profile) || !Array.isArray(value.habits) || !isObject(value.entries)) {
    throw new Error('The backup is missing profile, habit, or entry data.');
  }

  const isVersionTwo = value.version === 2;
  if (
    isVersionTwo
    && (
      typeof value.generationId !== 'string'
      || !value.generationId
      || value.generationId.length > 200
      || !isTimestamp(value.generationUpdatedAt)
      || (value.generationPending !== undefined && typeof value.generationPending !== 'boolean')
    )
  ) {
    throw new Error('The backup sync generation is invalid.');
  }

  const rawProfile = value.profile;
  if (
    typeof rawProfile.displayName !== 'string'
    || ![0, 1].includes(rawProfile.weekStartsOn as number)
    || typeof rawProfile.theme !== 'string'
    || !THEMES.has(rawProfile.theme)
    || (rawProfile.lastBackupAt !== undefined && !isTimestamp(rawProfile.lastBackupAt))
    || (isVersionTwo && !isTimestamp(rawProfile.updatedAt))
  ) {
    throw new Error('The backup profile is invalid.');
  }
  const profileCandidate: TrackerProfile = {
    displayName: rawProfile.displayName,
    weekStartsOn: rawProfile.weekStartsOn as 0 | 1,
    theme: rawProfile.theme as TrackerProfile['theme'],
    updatedAt: isTimestamp(rawProfile.updatedAt) ? rawProfile.updatedAt : migrationTimestamp,
    ...(isTimestamp(rawProfile.lastBackupAt) ? { lastBackupAt: rawProfile.lastBackupAt } : {}),
  };
  const profile: TrackerProfile = !isVersionTwo && isDefaultTrackerProfile(profileCandidate)
    ? { ...profileCandidate, updatedAt: LEGACY_GENERATION_UPDATED_AT }
    : profileCandidate;

  const habitIds = new Set<string>();
  const habits = value.habits.map((rawHabit, index): Habit => {
    if (!isObject(rawHabit)) throw new Error('The backup contains an invalid habit.');
    if (
      typeof rawHabit.id !== 'string'
      || !rawHabit.id
      || rawHabit.id.length > 300
      || typeof rawHabit.name !== 'string'
      || typeof rawHabit.category !== 'string'
      || typeof rawHabit.unit !== 'string'
      || typeof rawHabit.color !== 'string'
      || !/^#[0-9a-f]{6}$/i.test(rawHabit.color)
      || typeof rawHabit.icon !== 'string'
      || !HABIT_ICONS.includes(rawHabit.icon as Habit['icon'])
      || typeof rawHabit.metric !== 'string'
      || !METRICS.has(rawHabit.metric)
      || typeof rawHabit.period !== 'string'
      || !PERIODS.has(rawHabit.period)
      || typeof rawHabit.direction !== 'string'
      || !DIRECTIONS.has(rawHabit.direction)
      || typeof rawHabit.timeSlot !== 'string'
      || !TIME_SLOTS.has(rawHabit.timeSlot)
      || !isDateKey(rawHabit.startDate)
      || !isTimestamp(rawHabit.createdAt)
      || (isVersionTwo && (!isTimestamp(rawHabit.updatedAt) || !Number.isInteger(rawHabit.order) || (rawHabit.order as number) < 0))
      || (rawHabit.archivedAt !== undefined && !isDateKey(rawHabit.archivedAt))
    ) {
      throw new Error('The backup contains an invalid habit.');
    }
    if (habitIds.has(rawHabit.id)) throw new Error('The backup contains duplicate habit IDs.');
    habitIds.add(rawHabit.id);
    if (typeof rawHabit.target !== 'number' || !Number.isFinite(rawHabit.target) || rawHabit.target <= 0) {
      throw new Error(`The goal for “${rawHabit.name}” is invalid.`);
    }
    if (typeof rawHabit.increment !== 'number' || !Number.isFinite(rawHabit.increment) || rawHabit.increment <= 0) {
      throw new Error(`The quick increment for “${rawHabit.name}” is invalid.`);
    }
    if (rawHabit.metric === 'check') {
      const maximum = rawHabit.period === 'day' ? 1 : rawHabit.period === 'week' ? 7 : 31;
      if (rawHabit.direction !== 'atLeast' || !Number.isInteger(rawHabit.target) || rawHabit.target > maximum) {
        throw new Error(`The check goal for “${rawHabit.name}” is not reachable with one check per day.`);
      }
    }
    if (!isObject(rawHabit.schedule) || !['everyday', 'selectedDays', 'interval'].includes(rawHabit.schedule.type as string)) {
      throw new Error(`The schedule for “${rawHabit.name}” is invalid.`);
    }
    if (rawHabit.schedule.type === 'selectedDays') {
      const days = rawHabit.schedule.days;
      if (
        !Array.isArray(days)
        || days.length === 0
        || days.some((day) => !Number.isInteger(day) || (day as number) < 0 || (day as number) > 6)
        || new Set(days).size !== days.length
      ) {
        throw new Error(`The selected days for “${rawHabit.name}” are invalid.`);
      }
    }
    if (rawHabit.schedule.type === 'interval') {
      if (
        !Number.isInteger(rawHabit.schedule.every)
        || (rawHabit.schedule.every as number) < 1
        || !['day', 'week'].includes(rawHabit.schedule.unit as string)
      ) {
        throw new Error(`The interval for “${rawHabit.name}” is invalid.`);
      }
    }
    if (rawHabit.pauses !== undefined) {
      if (!Array.isArray(rawHabit.pauses) || rawHabit.pauses.some((pause) => (
        !isObject(pause)
        || !isDateKey(pause.start)
        || (pause.end !== undefined && (!isDateKey(pause.end) || pause.end < pause.start))
      ))) {
        throw new Error(`The pause history for “${rawHabit.name}” is invalid.`);
      }
      const pauses = rawHabit.pauses as Array<{ start: string; end?: string }>;
      const openPauses = pauses.filter((pause) => !pause.end);
      if (
        openPauses.length > 1
        || (openPauses.length === 1 && (!rawHabit.archivedAt || openPauses[0].start !== rawHabit.archivedAt))
        || (Boolean(rawHabit.archivedAt) && pauses.length > 0 && openPauses.length !== 1)
      ) {
        throw new Error(`The current pause for “${rawHabit.name}” is invalid.`);
      }
    }

    const normalizedHabit: Habit = {
      ...(rawHabit as unknown as Omit<Habit, 'updatedAt' | 'order'>),
      updatedAt: isTimestamp(rawHabit.updatedAt) ? rawHabit.updatedAt : migrationTimestamp,
      order: typeof rawHabit.order === 'number' ? rawHabit.order : index,
    };
    return !isVersionTwo && isUntouchedStarterHabit(normalizedHabit)
      ? { ...normalizedHabit, updatedAt: LEGACY_GENERATION_UPDATED_AT }
      : normalizedHabit;
  });

  const entries: TrackerState['entries'] = {};
  Object.entries(value.entries).forEach(([dateKey, rawEntries]) => {
    if (!isDateKey(dateKey) || !isObject(rawEntries)) {
      throw new Error('The backup contains an invalid entry date.');
    }
    const normalizedDay: Record<string, HabitEntry> = {};
    Object.entries(rawEntries).forEach(([habitId, rawEntry]) => {
      if (!habitIds.has(habitId) || !isObject(rawEntry)) {
        throw new Error(`The backup contains an entry for an unknown habit on ${dateKey}.`);
      }
      if (
        typeof rawEntry.value !== 'number'
        || !Number.isFinite(rawEntry.value)
        || rawEntry.value < 0
        || !isTimestamp(rawEntry.updatedAt)
        || (rawEntry.hasValue !== undefined && typeof rawEntry.hasValue !== 'boolean')
        || (rawEntry.skipped !== undefined && typeof rawEntry.skipped !== 'boolean')
        || (rawEntry.note !== undefined && typeof rawEntry.note !== 'string')
      ) {
        throw new Error(`The backup contains an invalid entry on ${dateKey}.`);
      }
      normalizedDay[habitId] = rawEntry as unknown as HabitEntry;
    });
    entries[dateKey] = normalizedDay;
  });

  return {
    version: 2,
    generationId: isVersionTwo ? value.generationId as string : 'local-v1',
    generationUpdatedAt: isVersionTwo ? value.generationUpdatedAt as string : '1970-01-01T00:00:00.000Z',
    generationPending: isVersionTwo ? value.generationPending === true : false,
    profile,
    habits: habits.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
    entries,
  };
}

function parseStoredCandidate(value: unknown): StoredCandidate {
  if (
    isObject(value)
    && ['daymark-v1', 'daymark-v2'].includes(value.storageFormat as string)
    && typeof value.savedAt === 'string'
    && 'state' in value
  ) {
    const savedAt = Date.parse(value.savedAt);
    if (!Number.isFinite(savedAt)) throw new Error('The local storage timestamp is invalid.');
    return { state: parseTrackerState(value.state, value.savedAt), savedAt };
  }
  // Migrate the original raw-state storage shape without discarding it.
  return { state: parseTrackerState(value), savedAt: 0 };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'));
  });
}

async function readIndexedState() {
  const database = await openDatabase();
  return new Promise<unknown>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not read local data.'));
    transaction.oncomplete = () => database.close();
  });
}

async function writeIndexedValue(value: unknown, key = STATE_KEY) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Could not save local data.'));
    };
  });
}

async function clearIndexedState() {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Could not clear local data.'));
    };
  });
}

async function loadState(): Promise<{ state: TrackerState; mode: StorageMode; warning?: string; preserveFirstSave?: boolean; hadStoredState: boolean }> {
  let foundCorruption = false;
  const recoveryKey = `${RECOVERY_PREFIX}-${new Date().toISOString()}`;
  let localCandidate: StoredCandidate | undefined;
  let indexedCandidate: StoredCandidate | undefined;

  try {
    [LOCAL_KEY, LEGACY_LOCAL_KEY].forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        const candidate = parseStoredCandidate(JSON.parse(raw));
        if (!localCandidate || candidate.savedAt > localCandidate.savedAt) localCandidate = candidate;
      } catch {
        foundCorruption = true;
        try {
          localStorage.setItem(`${recoveryKey}-${key}`, raw);
        } catch {
          // The original key remains untouched until an intentional user edit.
        }
      }
    });
  } catch {
    // Restricted localStorage can still fall back to IndexedDB.
  }

  try {
    const stored = await readIndexedState();
    if (stored) {
      try {
        indexedCandidate = parseStoredCandidate(stored);
      } catch {
        foundCorruption = true;
        try {
          await writeIndexedValue(stored, recoveryKey);
        } catch {
          // The current IndexedDB value remains untouched until a user edit.
        }
      }
    }
  } catch {
    // A localStorage fallback keeps the app usable in restricted browser contexts.
  }

  if (localCandidate || indexedCandidate) {
    const useIndexed = Boolean(indexedCandidate && (!localCandidate || indexedCandidate.savedAt > localCandidate.savedAt));
    const candidate = useIndexed ? indexedCandidate! : localCandidate!;
    return {
      state: candidate.state,
      mode: useIndexed ? 'indexeddb' : 'localstorage',
      warning: foundCorruption ? 'A damaged storage mirror was preserved; Daymark recovered from the valid copy.' : undefined,
      hadStoredState: true,
    };
  }

  return {
    state: createInitialState(),
    mode: 'indexeddb',
    warning: foundCorruption ? 'Daymark found damaged local data and preserved a recovery snapshot. Starter data is shown until you import a known-good backup or make a new edit.' : undefined,
    preserveFirstSave: foundCorruption,
    hadStoredState: false,
  };
}

export interface TrackerStore {
  state: TrackerState | null;
  storageMode: StorageMode;
  storageWarning?: string;
  hadStoredState: boolean;
  setEntryValue: (habitId: string, dateKey: string, value: number) => void;
  incrementEntry: (habitId: string, dateKey: string, amount: number) => void;
  toggleCheck: (habitId: string, dateKey: string) => void;
  toggleSkip: (habitId: string, dateKey: string) => void;
  setEntryNote: (habitId: string, dateKey: string, note: string) => void;
  saveHabit: (habit: Habit) => void;
  archiveHabit: (habitId: string, archive: boolean) => void;
  moveHabit: (habitId: string, direction: -1 | 1) => void;
  updateProfile: (patch: Partial<TrackerProfile>) => void;
  replaceState: (state: TrackerState) => void;
  resetState: () => void;
  markBackedUp: () => void;
  applySyncedState: (state: TrackerState) => void;
  subscribeMutations: (listener: TrackerMutationListener) => () => void;
  clearLocalData: () => Promise<void>;
}

export function useTrackerStore(): TrackerStore {
  const [state, setState] = useState<TrackerState | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('indexeddb');
  const [storageWarning, setStorageWarning] = useState<string>();
  const [hadStoredState, setHadStoredState] = useState(false);
  const hydrated = useRef(false);
  const skipNextSave = useRef(false);
  const persistenceSuspended = useRef(false);
  const pendingLocalWrites = useRef(new Set<Promise<void>>());
  const stateRef = useRef<TrackerState | null>(null);
  const mutationListeners = useRef(new Set<TrackerMutationListener>());

  useEffect(() => {
    let active = true;
    void loadState().then((loaded) => {
      if (!active) return;
      hydrated.current = true;
      skipNextSave.current = Boolean(loaded.preserveFirstSave);
      stateRef.current = loaded.state;
      setState(loaded.state);
      setStorageMode(loaded.mode);
      setStorageWarning(loaded.warning);
      setHadStoredState(loaded.hadStoredState);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!state || !hydrated.current || persistenceSuspended.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    let localSaved = false;
    const envelope: StoredEnvelope = {
      storageFormat: 'daymark-v2',
      savedAt: new Date().toISOString(),
      state,
    };
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(envelope));
      localStorage.removeItem(LEGACY_LOCAL_KEY);
      localSaved = true;
    } catch {
      // IndexedDB remains available when localStorage is full or restricted.
    }

    const persistIndexed = () => {
      if (persistenceSuspended.current) return;
      const write = writeIndexedValue(envelope);
      pendingLocalWrites.current.add(write);
      void write
        .then(() => setStorageMode('indexeddb'))
        .catch(() => {
          if (localSaved) setStorageMode('localstorage');
          else setStorageWarning('This browser is blocking both local storage systems. Export any visible data before leaving this page.');
        })
        .finally(() => pendingLocalWrites.current.delete(write));
    };
    if (!localSaved) {
      persistIndexed();
      return;
    }
    const timeout = window.setTimeout(persistIndexed, 180);
    return () => window.clearTimeout(timeout);
  }, [state]);

  const commit = useCallback((
    update: (current: TrackerState) => TrackerState,
    describeMutation: (next: TrackerState, previous: TrackerState) => TrackerMutation,
  ) => {
    const previous = stateRef.current;
    if (!previous) return;
    const next = update(previous);
    if (next === previous) return;
    stateRef.current = next;
    setState(next);
    setHadStoredState(true);
    const mutation = describeMutation(next, previous);
    mutationListeners.current.forEach((listener) => listener(mutation));
  }, []);

  const updateEntry = useCallback(
    (habitId: string, dateKey: string, transform: (current?: TrackerState['entries'][string][string]) => TrackerState['entries'][string][string] | null) => {
      commit((current) => {
        const dayEntries = { ...(current.entries[dateKey] ?? {}) };
        const nextEntry = transform(dayEntries[habitId]);
        if (nextEntry) dayEntries[habitId] = nextEntry;
        else delete dayEntries[habitId];
        const entries = { ...current.entries };
        if (Object.keys(dayEntries).length) entries[dateKey] = dayEntries;
        else delete entries[dateKey];
        return { ...current, entries };
      }, (next) => ({
        type: 'entry',
        dateKey,
        habitId,
        entry: next.entries[dateKey][habitId],
      }));
    },
    [commit],
  );

  const setEntryValue = useCallback((habitId: string, dateKey: string, value: number) => {
    updateEntry(habitId, dateKey, (entry) => ({
      value: Math.max(0, Number.isFinite(value) ? value : 0),
      hasValue: true,
      note: entry?.note,
      updatedAt: new Date().toISOString(),
    }));
  }, [updateEntry]);

  const incrementEntry = useCallback((habitId: string, dateKey: string, amount: number) => {
    updateEntry(habitId, dateKey, (entry) => ({
      value: Math.max(0, (entry?.skipped ? 0 : entry?.value ?? 0) + amount),
      hasValue: true,
      note: entry?.note,
      updatedAt: new Date().toISOString(),
    }));
  }, [updateEntry]);

  const toggleCheck = useCallback((habitId: string, dateKey: string) => {
    updateEntry(habitId, dateKey, (entry) => ({
      value: entry && !entry.skipped && entry.value > 0 ? 0 : 1,
      hasValue: true,
      note: entry?.note,
      updatedAt: new Date().toISOString(),
    }));
  }, [updateEntry]);

  const toggleSkip = useCallback((habitId: string, dateKey: string) => {
    updateEntry(habitId, dateKey, (entry) => (
      entry?.skipped
        ? {
            value: entry.value,
            hasValue: entry.hasValue,
            note: entry.note,
            updatedAt: new Date().toISOString(),
          }
        : {
            value: entry?.value ?? 0,
            hasValue: entry?.hasValue ?? false,
            note: entry?.note,
            skipped: true,
            updatedAt: new Date().toISOString(),
          }
    ));
  }, [updateEntry]);

  const setEntryNote = useCallback((habitId: string, dateKey: string, note: string) => {
    updateEntry(habitId, dateKey, (entry) => ({
      value: entry?.value ?? 0,
      hasValue: entry?.hasValue ?? false,
      skipped: entry?.skipped,
      note: note.trim() ? note : undefined,
      updatedAt: new Date().toISOString(),
    }));
  }, [updateEntry]);

  const saveHabit = useCallback((habit: Habit) => {
    const now = new Date().toISOString();
    commit((current) => {
      const existingIndex = current.habits.findIndex((candidate) => candidate.id === habit.id);
      const habits = [...current.habits];
      const nextHabit: Habit = {
        ...habit,
        updatedAt: now,
        order: existingIndex >= 0 ? current.habits[existingIndex].order : habits.length,
      };
      if (existingIndex >= 0) habits[existingIndex] = nextHabit;
      else habits.push(nextHabit);
      return { ...current, habits };
    }, (next) => ({ type: 'habits', habits: next.habits.filter((candidate) => candidate.id === habit.id) }));
    if ('storage' in navigator && 'persist' in navigator.storage) {
      void navigator.storage.persist().catch(() => false);
    }
  }, [commit]);

  const archiveHabit = useCallback((habitId: string, archive: boolean) => {
    const now = new Date().toISOString();
    commit((current) => ({
      ...current,
      habits: current.habits.map((habit) => {
        if (habit.id !== habitId) return habit;
        const next = { ...habit, updatedAt: now };
        const today = toDateKey(new Date());
        if (archive) {
          next.archivedAt = today;
          if (!next.pauses?.some((pause) => !pause.end)) {
            next.pauses = [...(next.pauses ?? []), { start: today }];
          }
        } else {
          const archivedSince = next.archivedAt;
          delete next.archivedAt;
          next.pauses = next.pauses?.length
            ? next.pauses.map((pause) => pause.end ? pause : { ...pause, end: today })
            : archivedSince ? [{ start: archivedSince, end: today }] : [];
        }
        return next;
      }),
    }), (next) => ({ type: 'habits', habits: next.habits.filter((habit) => habit.id === habitId) }));
  }, [commit]);

  const moveHabit = useCallback((habitId: string, direction: -1 | 1) => {
    const now = new Date().toISOString();
    const affectedIds = new Set<string>();
    commit((current) => {
      const index = current.habits.findIndex((habit) => habit.id === habitId);
      const activeIndices = current.habits
        .map((habit, habitIndex) => habit.archivedAt ? -1 : habitIndex)
        .filter((habitIndex) => habitIndex >= 0);
      const activePosition = activeIndices.indexOf(index);
      const targetPosition = activePosition + direction;
      if (index < 0 || activePosition < 0 || targetPosition < 0 || targetPosition >= activeIndices.length) return current;
      const target = activeIndices[targetPosition];
      const habits = [...current.habits];
      [habits[index], habits[target]] = [habits[target], habits[index]];
      affectedIds.add(habits[index].id);
      affectedIds.add(habits[target].id);
      habits[index] = { ...habits[index], order: index, updatedAt: now };
      habits[target] = { ...habits[target], order: target, updatedAt: now };
      return { ...current, habits };
    }, (next) => ({ type: 'habits', habits: next.habits.filter((habit) => affectedIds.has(habit.id)) }));
  }, [commit]);

  const updateProfile = useCallback((patch: Partial<TrackerProfile>) => {
    const now = new Date().toISOString();
    commit((current) => ({
      ...current,
      profile: { ...current.profile, ...patch, updatedAt: now },
    }), (next) => ({ type: 'profile', profile: next.profile }));
  }, [commit]);

  const replaceState = useCallback((nextState: TrackerState) => {
    const now = new Date().toISOString();
    const imported = parseTrackerState(nextState, now);
    const replacement = createReplacementGeneration(imported, makeGenerationId(), now);
    commit(() => replacement, () => ({ type: 'replace', state: replacement }));
  }, [commit]);

  const resetState = useCallback(() => {
    const now = new Date().toISOString();
    const replacement = createInitialState({
      generationId: makeGenerationId(),
      generationUpdatedAt: now,
      generationPending: true,
      now,
    });
    commit(() => replacement, () => ({ type: 'replace', state: replacement }));
  }, [commit]);
  const markBackedUp = useCallback(() => updateProfile({ lastBackupAt: new Date().toISOString() }), [updateProfile]);

  const applySyncedState = useCallback((nextState: TrackerState) => {
    const normalized = parseTrackerState(nextState);
    stateRef.current = normalized;
    setState(normalized);
    setHadStoredState(true);
  }, []);

  const subscribeMutations = useCallback((listener: TrackerMutationListener) => {
    mutationListeners.current.add(listener);
    return () => mutationListeners.current.delete(listener);
  }, []);

  const clearLocalData = useCallback(async () => {
    persistenceSuspended.current = true;
    await Promise.allSettled([...pendingLocalWrites.current]);
    try {
      localStorage.removeItem(LOCAL_KEY);
      localStorage.removeItem(LEGACY_LOCAL_KEY);
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(RECOVERY_PREFIX)) localStorage.removeItem(key);
      }
    } catch {
      // IndexedDB is still cleared below when localStorage is restricted.
    }
    await clearIndexedState();
  }, []);

  return {
    state,
    storageMode,
    storageWarning,
    hadStoredState,
    setEntryValue,
    incrementEntry,
    toggleCheck,
    toggleSkip,
    setEntryNote,
    saveHabit,
    archiveHabit,
    moveHabit,
    updateProfile,
    replaceState,
    resetState,
    markBackedUp,
    applySyncedState,
    subscribeMutations,
    clearLocalData,
  };
}
