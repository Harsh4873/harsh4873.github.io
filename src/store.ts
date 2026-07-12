import { useCallback, useEffect, useRef, useState } from 'react';
import { toDateKey } from './dates';
import { HABIT_ICONS, createInitialState, type Habit, type TrackerProfile, type TrackerState } from './model';

const DATABASE_NAME = 'daymark-tracker';
const DATABASE_VERSION = 1;
const STORE_NAME = 'tracker-state';
const STATE_KEY = 'current';
const LOCAL_KEY = 'daymark-tracker-state-v1';
const RECOVERY_PREFIX = 'daymark-recovery';

type StorageMode = 'indexeddb' | 'localstorage';

interface StoredEnvelope {
  storageFormat: 'daymark-v1';
  savedAt: string;
  state: TrackerState;
}

interface StoredCandidate {
  state: TrackerState;
  savedAt: number;
}

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

export function parseTrackerState(value: unknown): TrackerState {
  if (!isObject(value) || value.version !== 1) {
    throw new Error('This is not a Daymark v1 backup.');
  }
  if (!isObject(value.profile) || !Array.isArray(value.habits) || !isObject(value.entries)) {
    throw new Error('The backup is missing profile, habit, or entry data.');
  }

  const profile = value.profile as unknown as TrackerProfile;
  if (
    typeof profile.displayName !== 'string'
    || ![0, 1].includes(profile.weekStartsOn)
    || !THEMES.has(profile.theme)
    || (profile.lastBackupAt !== undefined && typeof profile.lastBackupAt !== 'string')
  ) {
    throw new Error('The backup profile is invalid.');
  }

  const habits = value.habits as unknown as Habit[];
  const habitIds = new Set<string>();
  habits.forEach((habit) => {
    if (
      !isObject(habit)
      || typeof habit.id !== 'string'
      || !habit.id
      || typeof habit.name !== 'string'
      || typeof habit.category !== 'string'
      || typeof habit.unit !== 'string'
      || typeof habit.color !== 'string'
      || !/^#[0-9a-f]{6}$/i.test(habit.color)
      || !HABIT_ICONS.includes(habit.icon)
      || !METRICS.has(habit.metric)
      || !PERIODS.has(habit.period)
      || !DIRECTIONS.has(habit.direction)
      || !TIME_SLOTS.has(habit.timeSlot)
      || !isDateKey(habit.startDate)
      || typeof habit.createdAt !== 'string'
      || (habit.archivedAt !== undefined && !isDateKey(habit.archivedAt))
    ) {
      throw new Error('The backup contains an invalid habit.');
    }
    if (habitIds.has(habit.id)) throw new Error('The backup contains duplicate habit IDs.');
    habitIds.add(habit.id);
    if (!Number.isFinite(habit.target) || habit.target <= 0) {
      throw new Error(`The goal for “${habit.name}” is invalid.`);
    }
    if (!Number.isFinite(habit.increment) || habit.increment <= 0) {
      throw new Error(`The quick increment for “${habit.name}” is invalid.`);
    }
    if (habit.metric === 'check') {
      const maximum = habit.period === 'day' ? 1 : habit.period === 'week' ? 7 : 31;
      if (habit.direction !== 'atLeast' || !Number.isInteger(habit.target) || habit.target > maximum) {
        throw new Error(`The check goal for “${habit.name}” is not reachable with one check per day.`);
      }
    }
    if (!isObject(habit.schedule) || !['everyday', 'selectedDays', 'interval'].includes(habit.schedule.type)) {
      throw new Error(`The schedule for “${habit.name}” is invalid.`);
    }
    if (habit.schedule.type === 'selectedDays') {
      if (
        !Array.isArray(habit.schedule.days)
        || habit.schedule.days.length === 0
        || habit.schedule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
        || new Set(habit.schedule.days).size !== habit.schedule.days.length
      ) {
        throw new Error(`The selected days for “${habit.name}” are invalid.`);
      }
    }
    if (habit.schedule.type === 'interval') {
      if (!Number.isInteger(habit.schedule.every) || habit.schedule.every < 1 || !['day', 'week'].includes(habit.schedule.unit)) {
        throw new Error(`The interval for “${habit.name}” is invalid.`);
      }
    }
    if (habit.pauses !== undefined) {
      if (!Array.isArray(habit.pauses) || habit.pauses.some((pause) => (
        !isObject(pause)
        || !isDateKey(pause.start)
        || (pause.end !== undefined && (!isDateKey(pause.end) || pause.end < pause.start))
      ))) {
        throw new Error(`The pause history for “${habit.name}” is invalid.`);
      }
      const openPauses = habit.pauses.filter((pause) => !pause.end);
      if (
        openPauses.length > 1
        || (openPauses.length === 1 && (!habit.archivedAt || openPauses[0].start !== habit.archivedAt))
        || (Boolean(habit.archivedAt) && habit.pauses.length > 0 && openPauses.length !== 1)
      ) {
        throw new Error(`The current pause for “${habit.name}” is invalid.`);
      }
    }
  });

  Object.entries(value.entries).forEach(([dateKey, rawEntries]) => {
    if (!isDateKey(dateKey) || !isObject(rawEntries)) {
      throw new Error('The backup contains an invalid entry date.');
    }
    Object.entries(rawEntries).forEach(([habitId, rawEntry]) => {
      if (!habitIds.has(habitId) || !isObject(rawEntry)) {
        throw new Error(`The backup contains an entry for an unknown habit on ${dateKey}.`);
      }
      if (
        typeof rawEntry.value !== 'number'
        || !Number.isFinite(rawEntry.value)
        || rawEntry.value < 0
        || typeof rawEntry.updatedAt !== 'string'
        || (rawEntry.hasValue !== undefined && typeof rawEntry.hasValue !== 'boolean')
        || (rawEntry.skipped !== undefined && typeof rawEntry.skipped !== 'boolean')
        || (rawEntry.note !== undefined && typeof rawEntry.note !== 'string')
      ) {
        throw new Error(`The backup contains an invalid entry on ${dateKey}.`);
      }
    });
  });

  return value as unknown as TrackerState;
}

function parseStoredCandidate(value: unknown): StoredCandidate {
  if (isObject(value) && value.storageFormat === 'daymark-v1' && typeof value.savedAt === 'string' && 'state' in value) {
    const savedAt = Date.parse(value.savedAt);
    if (!Number.isFinite(savedAt)) throw new Error('The local storage timestamp is invalid.');
    return { state: parseTrackerState(value.state), savedAt };
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

async function loadState(): Promise<{ state: TrackerState; mode: StorageMode; warning?: string; preserveFirstSave?: boolean }> {
  let foundCorruption = false;
  const recoveryKey = `${RECOVERY_PREFIX}-${new Date().toISOString()}`;
  let localCandidate: StoredCandidate | undefined;
  let indexedCandidate: StoredCandidate | undefined;

  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      try {
        localCandidate = parseStoredCandidate(JSON.parse(raw));
      } catch {
        foundCorruption = true;
        try {
          localStorage.setItem(recoveryKey, raw);
        } catch {
          // The original key remains untouched until an intentional user edit.
        }
      }
    }
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
    };
  }

  return {
    state: createInitialState(),
    mode: 'indexeddb',
    warning: foundCorruption ? 'Daymark found damaged local data and preserved a recovery snapshot. Starter data is shown until you import a known-good backup or make a new edit.' : undefined,
    preserveFirstSave: foundCorruption,
  };
}

export interface TrackerStore {
  state: TrackerState | null;
  storageMode: StorageMode;
  storageWarning?: string;
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
}

export function useTrackerStore(): TrackerStore {
  const [state, setState] = useState<TrackerState | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('indexeddb');
  const [storageWarning, setStorageWarning] = useState<string>();
  const hydrated = useRef(false);
  const skipNextSave = useRef(false);

  useEffect(() => {
    let active = true;
    void loadState().then((loaded) => {
      if (!active) return;
      hydrated.current = true;
      skipNextSave.current = Boolean(loaded.preserveFirstSave);
      setState(loaded.state);
      setStorageMode(loaded.mode);
      setStorageWarning(loaded.warning);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!state || !hydrated.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    let localSaved = false;
    const envelope: StoredEnvelope = {
      storageFormat: 'daymark-v1',
      savedAt: new Date().toISOString(),
      state,
    };
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(envelope));
      localSaved = true;
    } catch {
      // IndexedDB remains available when localStorage is full or restricted.
    }

    const persistIndexed = () => {
      void writeIndexedValue(envelope)
        .then(() => setStorageMode('indexeddb'))
        .catch(() => {
          if (localSaved) setStorageMode('localstorage');
          else setStorageWarning('This browser is blocking both local storage systems. Export any visible data before leaving this page.');
        });
    };
    if (!localSaved) {
      persistIndexed();
      return;
    }
    const timeout = window.setTimeout(persistIndexed, 180);
    return () => window.clearTimeout(timeout);
  }, [state]);

  const updateEntry = useCallback(
    (habitId: string, dateKey: string, transform: (current?: TrackerState['entries'][string][string]) => TrackerState['entries'][string][string] | null) => {
      setState((current) => {
        if (!current) return current;
        const dayEntries = { ...(current.entries[dateKey] ?? {}) };
        const nextEntry = transform(dayEntries[habitId]);
        if (nextEntry) dayEntries[habitId] = nextEntry;
        else delete dayEntries[habitId];
        const entries = { ...current.entries };
        if (Object.keys(dayEntries).length) entries[dateKey] = dayEntries;
        else delete entries[dateKey];
        return { ...current, entries };
      });
    },
    [],
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
    setState((current) => {
      if (!current) return current;
      const existingIndex = current.habits.findIndex((candidate) => candidate.id === habit.id);
      const habits = [...current.habits];
      if (existingIndex >= 0) habits[existingIndex] = habit;
      else habits.push(habit);
      return { ...current, habits };
    });
    if ('storage' in navigator && 'persist' in navigator.storage) {
      void navigator.storage.persist().catch(() => false);
    }
  }, []);

  const archiveHabit = useCallback((habitId: string, archive: boolean) => {
    setState((current) => current ? {
      ...current,
      habits: current.habits.map((habit) => {
        if (habit.id !== habitId) return habit;
        const next = { ...habit };
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
    } : current);
  }, []);

  const moveHabit = useCallback((habitId: string, direction: -1 | 1) => {
    setState((current) => {
      if (!current) return current;
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
      return { ...current, habits };
    });
  }, []);

  const updateProfile = useCallback((patch: Partial<TrackerProfile>) => {
    setState((current) => current ? {
      ...current,
      profile: { ...current.profile, ...patch },
    } : current);
  }, []);

  const replaceState = useCallback((nextState: TrackerState) => setState(parseTrackerState(nextState)), []);
  const resetState = useCallback(() => setState(createInitialState()), []);
  const markBackedUp = useCallback(() => updateProfile({ lastBackupAt: new Date().toISOString() }), [updateProfile]);

  return {
    state,
    storageMode,
    storageWarning,
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
  };
}
