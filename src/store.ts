import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isDateKey, isTimestamp, toDateKey } from './dates';
import {
  createInitialState,
  makeId,
  DEFAULT_COLOR,
  type Block,
  type Section,
  type SlateSettings,
  type SlateState,
  type Task,
  type ThemePreference,
} from './model';
import { needsRebalance, orderBetween, rebalanced, sortByOrder, ORDER_GAP } from './order';
import { fitsDay, isValidBlockTiming, liveBlocksForDay } from './schedule';
import { mergeStates, stableStringify } from './sync-core';

const DATABASE_NAME = 'slate-todo';
const DATABASE_VERSION = 1;
const STORE_NAME = 'slate-state';
const STATE_KEY = 'current';
const LOCAL_KEY = 'slate-todo-state-v1';
const RECOVERY_PREFIX = 'slate-recovery';
const STORAGE_FORMAT = 'slate-v1';
const INDEXEDDB_SAVE_DELAY_MS = 180;

export type SlateMutation =
  | { type: 'sections'; sections: Section[] }
  | { type: 'tasks'; tasks: Task[] }
  | { type: 'blocks'; blocks: Block[] }
  | { type: 'settings'; settings: SlateSettings }
  | { type: 'replace'; state: SlateState };

export type SlateMutationListener = (mutation: SlateMutation) => void;

export type StorageMode = 'indexeddb' | 'localstorage';

export interface SlateStore {
  state: SlateState | null;
  storageMode: StorageMode;
  storageWarning?: string;
  addSection: (title: string) => void;
  renameSection: (sectionId: string, title: string) => void;
  setSectionColor: (sectionId: string, color: string) => void;
  toggleSectionCollapsed: (sectionId: string) => void;
  moveSection: (sectionId: string, direction: -1 | 1) => void;
  deleteSection: (sectionId: string) => void;
  clearCompleted: (sectionId: string) => void;
  addTask: (sectionId: string, title: string) => void;
  updateTask: (taskId: string, patch: Partial<Pick<Task, 'title' | 'notes' | 'due' | 'sectionId'>>) => void;
  toggleTask: (taskId: string) => void;
  moveTask: (taskId: string, sectionId: string, beforeTaskId: string | null) => void;
  deleteTask: (taskId: string) => void;
  saveBlock: (block: Pick<Block, 'dateKey' | 'startMin' | 'durationMin' | 'title' | 'color'> & { id?: string }) => void;
  deleteBlock: (blockId: string) => void;
  copyDayBlocks: (fromDateKey: string, toDateKey: string) => void;
  clearDayBlocks: (dateKey: string) => void;
  updateSettings: (patch: Partial<Pick<SlateSettings, 'theme' | 'hideCompleted'>>) => void;
  replaceState: (state: SlateState) => void;
  resetState: () => void;
  applySyncedState: (state: SlateState) => void;
  subscribeMutations: (listener: SlateMutationListener) => () => void;
  clearLocalData: () => Promise<void>;
}

interface StorageEnvelope {
  storageFormat: typeof STORAGE_FORMAT;
  savedAt: string;
  state: SlateState;
}

interface StoredCandidate {
  state: SlateState;
  savedAt: number;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

// Entity ids double as Firestore document ids, so ids from hand-edited
// backups must stay inside Firestore's document-id rules.
function isValidEntityId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !/^__.*__$/.test(value);
}

function isTheme(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

function parseSection(value: unknown): Section | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isValidEntityId(raw.id)) return null;
  if (typeof raw.title !== 'string') return null;
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) return null;
  if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) return null;
  return {
    id: raw.id,
    title: raw.title,
    color: isHexColor(raw.color) ? raw.color : DEFAULT_COLOR,
    order: raw.order,
    collapsed: raw.collapsed === true,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(raw.deleted === true ? { deleted: true as const } : {}),
  };
}

function parseTask(value: unknown): Task | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isValidEntityId(raw.id)) return null;
  // Orphan sectionIds are tolerated: collection snapshots arrive independently,
  // so a task can momentarily reference a section this device has not seen yet.
  if (typeof raw.sectionId !== 'string' || !raw.sectionId) return null;
  if (typeof raw.title !== 'string') return null;
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) return null;
  if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) return null;
  return {
    id: raw.id,
    sectionId: raw.sectionId,
    title: raw.title,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    done: raw.done === true,
    ...(isTimestamp(raw.completedAt) ? { completedAt: raw.completedAt } : {}),
    ...(isDateKey(raw.due) ? { due: raw.due } : {}),
    order: raw.order,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(raw.deleted === true ? { deleted: true as const } : {}),
  };
}

function parseBlock(value: unknown): Block | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isValidEntityId(raw.id)) return null;
  if (!isDateKey(raw.dateKey)) return null;
  if (typeof raw.title !== 'string') return null;
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) return null;
  if (typeof raw.startMin !== 'number' || typeof raw.durationMin !== 'number') return null;
  if (!isValidBlockTiming(raw.startMin, raw.durationMin)) return null;
  return {
    id: raw.id,
    dateKey: raw.dateKey,
    startMin: raw.startMin,
    durationMin: raw.durationMin,
    title: raw.title,
    color: isHexColor(raw.color) ? raw.color : DEFAULT_COLOR,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(raw.deleted === true ? { deleted: true as const } : {}),
  };
}

export function parseSlateState(value: unknown): SlateState {
  if (!value || typeof value !== 'object') throw new Error('Slate data must be an object.');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new Error('Unsupported Slate data version.');
  if (!Array.isArray(raw.sections) || !Array.isArray(raw.tasks) || !Array.isArray(raw.blocks)) {
    throw new Error('Slate data is missing sections, tasks, or blocks.');
  }

  const settingsRaw = (raw.settings ?? {}) as Record<string, unknown>;
  const settings: SlateSettings = {
    theme: isTheme(settingsRaw.theme) ? settingsRaw.theme : 'dark',
    hideCompleted: settingsRaw.hideCompleted === true,
    updatedAt: isTimestamp(settingsRaw.updatedAt) ? settingsRaw.updatedAt : new Date(0).toISOString(),
  };

  const sections: Section[] = [];
  const seenSections = new Set<string>();
  for (const item of raw.sections) {
    const section = parseSection(item);
    if (!section) throw new Error('Slate data contains an invalid section.');
    if (seenSections.has(section.id)) throw new Error('Slate data contains duplicate section ids.');
    seenSections.add(section.id);
    sections.push(section);
  }

  const tasks: Task[] = [];
  const seenTasks = new Set<string>();
  for (const item of raw.tasks) {
    const task = parseTask(item);
    if (!task) throw new Error('Slate data contains an invalid task.');
    if (seenTasks.has(task.id)) throw new Error('Slate data contains duplicate task ids.');
    seenTasks.add(task.id);
    tasks.push(task);
  }

  const blocks: Block[] = [];
  const seenBlocks = new Set<string>();
  for (const item of raw.blocks) {
    const block = parseBlock(item);
    if (!block) throw new Error('Slate data contains an invalid schedule block.');
    if (seenBlocks.has(block.id)) throw new Error('Slate data contains duplicate block ids.');
    seenBlocks.add(block.id);
    blocks.push(block);
  }

  return {
    version: 1,
    settings,
    sections: sortByOrder(sections),
    tasks: sortByOrder(tasks),
    blocks,
  };
}

function parseEnvelope(rawValue: unknown): StoredCandidate | null {
  if (!rawValue || typeof rawValue !== 'object') return null;
  const envelope = rawValue as Partial<StorageEnvelope>;
  if (envelope.storageFormat === STORAGE_FORMAT && envelope.state) {
    const savedAt = Date.parse(envelope.savedAt ?? '');
    return {
      state: parseSlateState(envelope.state),
      savedAt: Number.isFinite(savedAt) ? savedAt : 0,
    };
  }
  // Bare state (no envelope) also loads, so hand-edited backups can be pasted in.
  return { state: parseSlateState(rawValue), savedAt: 0 };
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readFromIndexedDb(): Promise<unknown> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function writeToIndexedDb(envelope: StorageEnvelope) {
  const database = await openDatabase();
  if (!database) throw new Error('IndexedDB is unavailable.');
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(envelope, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function clearIndexedDbStore() {
  const database = await openDatabase();
  if (!database) return;
  try {
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } finally {
    database.close();
  }
}

function preserveCorruptCopy(key: string, rawText: string) {
  try {
    localStorage.setItem(`${RECOVERY_PREFIX}-${new Date().toISOString()}-${key}`, rawText);
  } catch {
    // Recovery copies are best-effort.
  }
}

export function useSlateStore(): SlateStore {
  const [state, setState] = useState<SlateState | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('localstorage');
  const [storageWarning, setStorageWarning] = useState<string>();
  const stateRef = useRef<SlateState | null>(null);
  const hydratedRef = useRef(false);
  const skipNextSaveRef = useRef(false);
  const persistenceSuspendedRef = useRef(false);
  const pendingLocalWritesRef = useRef(new Set<Promise<void>>());
  const mutationListenersRef = useRef(new Set<SlateMutationListener>());
  const saveTimerRef = useRef<number>();
  const lastSavedTextRef = useRef<string>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const candidates: StoredCandidate[] = [];
      let warning: string | undefined;

      let localText: string | null = null;
      try {
        localText = localStorage.getItem(LOCAL_KEY);
      } catch {
        localText = null;
      }
      if (localText) {
        try {
          const candidate = parseEnvelope(JSON.parse(localText));
          if (candidate) candidates.push(candidate);
        } catch {
          preserveCorruptCopy(LOCAL_KEY, localText);
          warning = 'A stored copy could not be read and was preserved for recovery.';
        }
      }

      try {
        const stored = await readFromIndexedDb();
        if (stored) {
          const candidate = parseEnvelope(stored);
          if (candidate) {
            candidate.savedAt += 0.5; // IndexedDB wins exact ties.
            candidates.push(candidate);
          }
        }
      } catch {
        warning = warning ?? 'The browser database copy could not be read; using the most recent readable copy.';
      }

      if (cancelled) return;

      candidates.sort((left, right) => right.savedAt - left.savedAt);
      const chosen = candidates[0]?.state ?? null;
      if (!chosen) skipNextSaveRef.current = true;
      const initial = chosen ?? createInitialState();
      hydratedRef.current = true;
      stateRef.current = initial;
      setState(initial);
      setStorageWarning(warning);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || !state) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (persistenceSuspendedRef.current) return;

    // Another signed-out tab may have persisted since we last wrote; merging
    // per entity (updatedAt + tombstones) keeps whole-envelope saves from
    // clobbering that tab's work.
    let stateToPersist = state;
    try {
      const existingText = localStorage.getItem(LOCAL_KEY);
      if (existingText && existingText !== lastSavedTextRef.current) {
        const existing = parseEnvelope(JSON.parse(existingText));
        if (existing) {
          const merged = mergeStates(state, existing.state);
          if (stableStringify(merged) !== stableStringify(state)) stateToPersist = merged;
        }
      }
    } catch {
      // Unreadable foreign copies are handled by the load-time recovery path.
    }

    const envelope: StorageEnvelope = {
      storageFormat: STORAGE_FORMAT,
      savedAt: new Date().toISOString(),
      state: stateToPersist,
    };

    let localSaved = false;
    try {
      const text = JSON.stringify(envelope);
      localStorage.setItem(LOCAL_KEY, text);
      lastSavedTextRef.current = text;
      localSaved = true;
    } catch {
      localSaved = false;
    }

    const persistToIndexedDb = () => {
      const write = writeToIndexedDb(envelope)
        .then(() => {
          setStorageMode('indexeddb');
          setStorageWarning(undefined);
        })
        .catch(() => {
          if (localSaved) setStorageMode('localstorage');
          else {
            setStorageWarning('This browser is blocking both local storage systems. Export any visible data before leaving this page.');
          }
        });
      const tracked = write.finally(() => pendingLocalWritesRef.current.delete(tracked));
      pendingLocalWritesRef.current.add(tracked);
    };

    if (localSaved) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(persistToIndexedDb, INDEXEDDB_SAVE_DELAY_MS);
      return () => window.clearTimeout(saveTimerRef.current);
    }
    persistToIndexedDb();
  }, [state]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== LOCAL_KEY || !event.newValue || event.newValue === lastSavedTextRef.current) return;
      const current = stateRef.current;
      if (!current) return;
      try {
        const incoming = parseEnvelope(JSON.parse(event.newValue));
        if (!incoming) return;
        const merged = mergeStates(current, incoming.state);
        if (stableStringify(merged) === stableStringify(current)) return;
        // Re-saving the merged copy is harmless: the other tab's mirror merge
        // converges to the same state, so the exchange terminates.
        stateRef.current = merged;
        setState(merged);
      } catch {
        // A foreign tab wrote something unreadable; ignore and keep our copy.
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const emitMutation = useCallback((mutation: SlateMutation) => {
    mutationListenersRef.current.forEach((listener) => listener(mutation));
  }, []);

  const commit = useCallback((
    update: (previous: SlateState) => SlateState,
    describeMutations: (next: SlateState, previous: SlateState) => Array<SlateMutation | null>,
  ) => {
    const previous = stateRef.current;
    if (!previous) return;
    const next = update(previous);
    if (next === previous) return;
    stateRef.current = next;
    setState(next);
    for (const mutation of describeMutations(next, previous)) {
      if (mutation) emitMutation(mutation);
    }
  }, [emitMutation]);

  const changedTasksMutation = useCallback((next: SlateState, previous: SlateState): SlateMutation | null => {
    const previousById = new Map(previous.tasks.map((task) => [task.id, task]));
    const changed = next.tasks.filter((task) => previousById.get(task.id) !== task);
    return changed.length ? { type: 'tasks', tasks: changed } : null;
  }, []);

  const changedSectionsMutation = useCallback((next: SlateState, previous: SlateState): SlateMutation | null => {
    const previousById = new Map(previous.sections.map((section) => [section.id, section]));
    const changed = next.sections.filter((section) => previousById.get(section.id) !== section);
    return changed.length ? { type: 'sections', sections: changed } : null;
  }, []);

  const changedBlocksMutation = useCallback((next: SlateState, previous: SlateState): SlateMutation | null => {
    const previousById = new Map(previous.blocks.map((block) => [block.id, block]));
    const changed = next.blocks.filter((block) => previousById.get(block.id) !== block);
    return changed.length ? { type: 'blocks', blocks: changed } : null;
  }, []);

  const addSection = useCallback((title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    commit((previous) => {
      const now = new Date().toISOString();
      const live = previous.sections.filter((section) => !section.deleted);
      const lastOrder = live.length ? Math.max(...live.map((section) => section.order)) : 0;
      const section: Section = {
        id: makeId('section'),
        title: trimmed,
        color: DEFAULT_COLOR,
        order: lastOrder + ORDER_GAP,
        collapsed: false,
        createdAt: now,
        updatedAt: now,
      };
      return { ...previous, sections: [...previous.sections, section] };
    }, (next, previous) => [changedSectionsMutation(next, previous)]);
  }, [commit, changedSectionsMutation]);

  const patchSection = useCallback((sectionId: string, patch: Partial<Section>) => {
    commit((previous) => {
      const now = new Date().toISOString();
      let changed = false;
      const sections = previous.sections.map((section) => {
        if (section.id !== sectionId || section.deleted) return section;
        changed = true;
        return { ...section, ...patch, updatedAt: now };
      });
      return changed ? { ...previous, sections } : previous;
    }, (next, previous) => [changedSectionsMutation(next, previous)]);
  }, [commit, changedSectionsMutation]);

  const renameSection = useCallback((sectionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    patchSection(sectionId, { title: trimmed });
  }, [patchSection]);

  const setSectionColor = useCallback((sectionId: string, color: string) => {
    patchSection(sectionId, { color });
  }, [patchSection]);

  const toggleSectionCollapsed = useCallback((sectionId: string) => {
    commit((previous) => {
      const now = new Date().toISOString();
      let changed = false;
      const sections = previous.sections.map((section) => {
        if (section.id !== sectionId || section.deleted) return section;
        changed = true;
        return { ...section, collapsed: !section.collapsed, updatedAt: now };
      });
      return changed ? { ...previous, sections } : previous;
    }, (next, previous) => [changedSectionsMutation(next, previous)]);
  }, [commit, changedSectionsMutation]);

  const moveSection = useCallback((sectionId: string, direction: -1 | 1) => {
    commit((previous) => {
      const live = sortByOrder(previous.sections.filter((section) => !section.deleted));
      const index = live.findIndex((section) => section.id === sectionId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= live.length) return previous;
      const now = new Date().toISOString();
      const current = live[index];
      const neighbour = live[targetIndex];
      if (current.order === neighbour.order) {
        // Equal orders (possible after a cross-device merge) make a swap a
        // no-op, so re-space the whole live sequence with the two exchanged.
        const sequence = [...live];
        sequence[index] = neighbour;
        sequence[targetIndex] = current;
        const assignments = rebalanced(sequence);
        const sections = previous.sections.map((section) => {
          const assigned = assignments.get(section.id);
          if (assigned === undefined || assigned === section.order) return section;
          return { ...section, order: assigned, updatedAt: now };
        });
        return { ...previous, sections };
      }
      const sections = previous.sections.map((section) => {
        if (section.id === current.id) return { ...section, order: neighbour.order, updatedAt: now };
        if (section.id === neighbour.id) return { ...section, order: current.order, updatedAt: now };
        return section;
      });
      return { ...previous, sections };
    }, (next, previous) => [changedSectionsMutation(next, previous)]);
  }, [commit, changedSectionsMutation]);

  const deleteSection = useCallback((sectionId: string) => {
    commit((previous) => {
      const now = new Date().toISOString();
      let changed = false;
      const sections = previous.sections.map((section) => {
        if (section.id !== sectionId || section.deleted) return section;
        changed = true;
        return { ...section, deleted: true as const, updatedAt: now };
      });
      if (!changed) return previous;
      const tasks = previous.tasks.map((task) => (
        task.sectionId === sectionId && !task.deleted
          ? { ...task, deleted: true as const, updatedAt: now }
          : task
      ));
      return { ...previous, sections, tasks };
    }, (next, previous) => [
      changedSectionsMutation(next, previous),
      changedTasksMutation(next, previous),
    ]);
  }, [commit, changedSectionsMutation, changedTasksMutation]);

  const clearCompleted = useCallback((sectionId: string) => {
    commit((previous) => {
      const now = new Date().toISOString();
      const doneIds = new Set(
        previous.tasks
          .filter((task) => task.sectionId === sectionId && task.done && !task.deleted)
          .map((task) => task.id),
      );
      if (!doneIds.size) return previous;
      const tasks = previous.tasks.map((task) => (
        doneIds.has(task.id) ? { ...task, deleted: true as const, updatedAt: now } : task
      ));
      return { ...previous, tasks };
    }, (next, previous) => [changedTasksMutation(next, previous)]);
  }, [commit, changedTasksMutation]);

  const addTask = useCallback((sectionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    commit((previous) => {
      const section = previous.sections.find((item) => item.id === sectionId && !item.deleted);
      if (!section) return previous;
      const now = new Date().toISOString();
      const siblings = previous.tasks.filter((task) => task.sectionId === sectionId && !task.deleted);
      const lastOrder = siblings.length ? Math.max(...siblings.map((task) => task.order)) : 0;
      const task: Task = {
        id: makeId('task'),
        sectionId,
        title: trimmed,
        notes: '',
        done: false,
        order: lastOrder + ORDER_GAP,
        createdAt: now,
        updatedAt: now,
      };
      return { ...previous, tasks: [...previous.tasks, task] };
    }, (next, previous) => [changedTasksMutation(next, previous)]);
  }, [commit, changedTasksMutation]);

  const updateTask = useCallback((taskId: string, patch: Partial<Pick<Task, 'title' | 'notes' | 'due' | 'sectionId'>>) => {
    commit((previous) => {
      const now = new Date().toISOString();
      let changed = false;
      const tasks = previous.tasks.map((task) => {
        if (task.id !== taskId || task.deleted) return task;
        const nextTask: Task = { ...task, ...patch, updatedAt: now };
        if (patch.due === undefined && 'due' in patch) delete nextTask.due;
        if (patch.title !== undefined && !patch.title.trim()) nextTask.title = task.title;
        if (patch.sectionId && patch.sectionId !== task.sectionId) {
          const siblings = previous.tasks.filter((item) => item.sectionId === patch.sectionId && !item.deleted);
          nextTask.order = (siblings.length ? Math.max(...siblings.map((item) => item.order)) : 0) + ORDER_GAP;
        }
        changed = true;
        return nextTask;
      });
      return changed ? { ...previous, tasks } : previous;
    }, (next, previous) => [changedTasksMutation(next, previous)]);
  }, [commit, changedTasksMutation]);

  const toggleTask = useCallback((taskId: string) => {
    commit((previous) => {
      const now = new Date().toISOString();
      let changed = false;
      const tasks = previous.tasks.map((task) => {
        if (task.id !== taskId || task.deleted) return task;
        changed = true;
        const done = !task.done;
        const next: Task = { ...task, done, updatedAt: now };
        if (done) next.completedAt = now;
        else delete next.completedAt;
        return next;
      });
      return changed ? { ...previous, tasks } : previous;
    }, (next, previous) => [changedTasksMutation(next, previous)]);
  }, [commit, changedTasksMutation]);

  const moveTask = useCallback((taskId: string, sectionId: string, beforeTaskId: string | null) => {
    commit((previous) => {
      const moving = previous.tasks.find((task) => task.id === taskId && !task.deleted);
      const targetSection = previous.sections.find((section) => section.id === sectionId && !section.deleted);
      if (!moving || !targetSection) return previous;
      if (beforeTaskId === taskId) return previous;

      const now = new Date().toISOString();
      const siblings = sortByOrder(
        previous.tasks.filter((task) => task.sectionId === sectionId && !task.deleted && task.id !== taskId),
      );
      const beforeIndex = beforeTaskId ? siblings.findIndex((task) => task.id === beforeTaskId) : siblings.length;
      const anchorIndex = beforeIndex < 0 ? siblings.length : beforeIndex;
      const previousOrder = anchorIndex > 0 ? siblings[anchorIndex - 1].order : undefined;
      const nextOrder = anchorIndex < siblings.length ? siblings[anchorIndex].order : undefined;

      if (needsRebalance(previousOrder, nextOrder)) {
        const reordered = [...siblings];
        reordered.splice(anchorIndex, 0, { ...moving, sectionId });
        const assignments = rebalanced(reordered);
        const touched = new Set<string>();
        const tasks = previous.tasks.map((task) => {
          const assigned = assignments.get(task.id);
          if (assigned === undefined) return task;
          if (task.id === taskId) {
            touched.add(task.id);
            return { ...task, sectionId, order: assigned, updatedAt: now };
          }
          if (task.order === assigned) return task;
          touched.add(task.id);
          return { ...task, order: assigned, updatedAt: now };
        });
        return touched.size ? { ...previous, tasks } : previous;
      }

      const order = orderBetween(previousOrder, nextOrder);
      if (moving.sectionId === sectionId && moving.order === order) return previous;
      const tasks = previous.tasks.map((task) => (
        task.id === taskId ? { ...task, sectionId, order, updatedAt: now } : task
      ));
      return { ...previous, tasks };
    }, (next, previous) => [changedTasksMutation(next, previous)]);
  }, [commit, changedTasksMutation]);

  const deleteTask = useCallback((taskId: string) => {
    commit((previous) => {
      const now = new Date().toISOString();
      let changed = false;
      const tasks = previous.tasks.map((task) => {
        if (task.id !== taskId || task.deleted) return task;
        changed = true;
        return { ...task, deleted: true as const, updatedAt: now };
      });
      return changed ? { ...previous, tasks } : previous;
    }, (next, previous) => [changedTasksMutation(next, previous)]);
  }, [commit, changedTasksMutation]);

  const saveBlock = useCallback((input: Pick<Block, 'dateKey' | 'startMin' | 'durationMin' | 'title' | 'color'> & { id?: string }) => {
    commit((previous) => {
      const now = new Date().toISOString();
      const day = liveBlocksForDay(previous.blocks, input.dateKey);
      if (!fitsDay(day, input.startMin, input.durationMin, input.id)) return previous;
      if (input.id) {
        let changed = false;
        const blocks = previous.blocks.map((block) => {
          if (block.id !== input.id || block.deleted) return block;
          changed = true;
          return {
            ...block,
            dateKey: input.dateKey,
            startMin: input.startMin,
            durationMin: input.durationMin,
            title: input.title,
            color: input.color,
            updatedAt: now,
          };
        });
        return changed ? { ...previous, blocks } : previous;
      }
      const block: Block = {
        id: makeId('block'),
        dateKey: input.dateKey,
        startMin: input.startMin,
        durationMin: input.durationMin,
        title: input.title,
        color: input.color,
        createdAt: now,
        updatedAt: now,
      };
      return { ...previous, blocks: [...previous.blocks, block] };
    }, (next, previous) => [changedBlocksMutation(next, previous)]);
  }, [commit, changedBlocksMutation]);

  const deleteBlock = useCallback((blockId: string) => {
    commit((previous) => {
      const now = new Date().toISOString();
      let changed = false;
      const blocks = previous.blocks.map((block) => {
        if (block.id !== blockId || block.deleted) return block;
        changed = true;
        return { ...block, deleted: true as const, updatedAt: now };
      });
      return changed ? { ...previous, blocks } : previous;
    }, (next, previous) => [changedBlocksMutation(next, previous)]);
  }, [commit, changedBlocksMutation]);

  const copyDayBlocks = useCallback((fromDateKey: string, toDateKey: string) => {
    commit((previous) => {
      const now = new Date().toISOString();
      const source = previous.blocks.filter((block) => !block.deleted && block.dateKey === fromDateKey);
      const existing = previous.blocks.filter((block) => !block.deleted && block.dateKey === toDateKey);
      const copies: Block[] = [];
      for (const block of source) {
        const candidate = { startMin: block.startMin, durationMin: block.durationMin };
        const collides = [...existing, ...copies].some((other) => (
          candidate.startMin < other.startMin + other.durationMin
          && other.startMin < candidate.startMin + candidate.durationMin
        ));
        if (collides) continue;
        copies.push({
          id: makeId('block'),
          dateKey: toDateKey,
          startMin: block.startMin,
          durationMin: block.durationMin,
          title: block.title,
          color: block.color,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (!copies.length) return previous;
      return { ...previous, blocks: [...previous.blocks, ...copies] };
    }, (next, previous) => [changedBlocksMutation(next, previous)]);
  }, [commit, changedBlocksMutation]);

  const clearDayBlocks = useCallback((dateKey: string) => {
    commit((previous) => {
      const now = new Date().toISOString();
      let changed = false;
      const blocks = previous.blocks.map((block) => {
        if (block.dateKey !== dateKey || block.deleted) return block;
        changed = true;
        return { ...block, deleted: true as const, updatedAt: now };
      });
      return changed ? { ...previous, blocks } : previous;
    }, (next, previous) => [changedBlocksMutation(next, previous)]);
  }, [commit, changedBlocksMutation]);

  const updateSettings = useCallback((patch: Partial<Pick<SlateSettings, 'theme' | 'hideCompleted'>>) => {
    commit((previous) => {
      const settings: SlateSettings = { ...previous.settings, ...patch, updatedAt: new Date().toISOString() };
      return { ...previous, settings };
    }, (next) => [{ type: 'settings' as const, settings: next.settings }]);
  }, [commit]);

  const replaceState = useCallback((incoming: SlateState) => {
    commit((previous) => {
      const now = new Date().toISOString();
      const keepIds = new Set([
        ...incoming.sections.map((section) => section.id),
        ...incoming.tasks.map((task) => task.id),
        ...incoming.blocks.map((block) => block.id),
      ]);
      // Everything not present in the imported state becomes a tombstone so the
      // replacement propagates as deletions to every synced device.
      const tombstoneSections = previous.sections
        .filter((section) => !keepIds.has(section.id))
        .map((section) => ({ ...section, deleted: true as const, updatedAt: now }));
      const tombstoneTasks = previous.tasks
        .filter((task) => !keepIds.has(task.id))
        .map((task) => ({ ...task, deleted: true as const, updatedAt: now }));
      const tombstoneBlocks = previous.blocks
        .filter((block) => !keepIds.has(block.id))
        .map((block) => ({ ...block, deleted: true as const, updatedAt: now }));

      const stamp = { updatedAt: now };
      return {
        version: 1 as const,
        settings: { ...incoming.settings, ...stamp },
        sections: [...incoming.sections.map((section) => ({ ...section, ...stamp })), ...tombstoneSections],
        tasks: [...incoming.tasks.map((task) => ({ ...task, ...stamp })), ...tombstoneTasks],
        blocks: [...incoming.blocks.map((block) => ({ ...block, ...stamp })), ...tombstoneBlocks],
      };
    }, (next) => [{ type: 'replace' as const, state: next }]);
  }, [commit]);

  const resetState = useCallback(() => {
    replaceState(createInitialState());
  }, [replaceState]);

  const applySyncedState = useCallback((next: SlateState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const subscribeMutations = useCallback((listener: SlateMutationListener) => {
    mutationListenersRef.current.add(listener);
    return () => {
      mutationListenersRef.current.delete(listener);
    };
  }, []);

  const clearLocalData = useCallback(async () => {
    persistenceSuspendedRef.current = true;
    window.clearTimeout(saveTimerRef.current);
    await Promise.allSettled([...pendingLocalWritesRef.current]);
    try {
      localStorage.removeItem(LOCAL_KEY);
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(RECOVERY_PREFIX)) localStorage.removeItem(key);
      }
    } catch {
      // localStorage may be blocked entirely; IndexedDB clear still runs.
    }
    await clearIndexedDbStore();
    persistenceSuspendedRef.current = false;
  }, []);

  return useMemo(() => ({
    state,
    storageMode,
    storageWarning,
    addSection,
    renameSection,
    setSectionColor,
    toggleSectionCollapsed,
    moveSection,
    deleteSection,
    clearCompleted,
    addTask,
    updateTask,
    toggleTask,
    moveTask,
    deleteTask,
    saveBlock,
    deleteBlock,
    copyDayBlocks,
    clearDayBlocks,
    updateSettings,
    replaceState,
    resetState,
    applySyncedState,
    subscribeMutations,
    clearLocalData,
  }), [
    state,
    storageMode,
    storageWarning,
    addSection,
    renameSection,
    setSectionColor,
    toggleSectionCollapsed,
    moveSection,
    deleteSection,
    clearCompleted,
    addTask,
    updateTask,
    toggleTask,
    moveTask,
    deleteTask,
    saveBlock,
    deleteBlock,
    copyDayBlocks,
    clearDayBlocks,
    updateSettings,
    replaceState,
    resetState,
    applySyncedState,
    subscribeMutations,
    clearLocalData,
  ]);
}
