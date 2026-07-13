import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createId,
  createStarterState,
  parseResearchState,
  type Note,
  type Paper,
  type ResearchMessage,
  type ResearchProfile,
  type ResearchSettings,
  type ResearchState,
} from './model';
import { clearLocalPdfs, deleteLocalPdf, putLocalPdf } from './local-pdf-store';
import { mergeStates, stableStringify } from './sync-core';

const LOCAL_KEY = 'sift-research-state-v1';
const RECOVERY_PREFIX = 'sift-research-recovery-';
const DATABASE_NAME = 'sift-research-local';
const DATABASE_VERSION = 1;
const STORE_NAME = 'state';
const STORE_KEY = 'current';

interface StorageEnvelope {
  savedAt: number;
  state: ResearchState;
}

export type StorageMode = 'indexeddb' | 'localStorage';

export type ResearchMutation =
  | { type: 'profile'; profile: ResearchProfile }
  | { type: 'settings'; settings: ResearchSettings }
  | { type: 'papers'; papers: Paper[] }
  | { type: 'notes'; notes: Note[] }
  | { type: 'messages'; messages: ResearchMessage[] }
  | { type: 'replace'; state: ResearchState };

export type ResearchMutationListener = (mutation: ResearchMutation) => void;

type EntityKeys = 'id' | 'createdAt' | 'updatedAt' | 'deleted' | 'deletedAt';
export type NewPaper = Omit<Paper, EntityKeys | 'file'> & {
  file: Omit<Paper['file'], 'storageKey'> & { storageKey?: string };
};
export type PaperPatch = Partial<Omit<Paper, EntityKeys>>;
export type NewNote = Omit<Note, EntityKeys>;
export type NotePatch = Partial<NewNote>;
export type NewMessage = Omit<ResearchMessage, EntityKeys>;
export type MessagePatch = Partial<NewMessage>;

export interface ImportPaperDetails {
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  sourceUrl?: string;
  tags?: string[];
  autoQueue?: boolean;
}

export interface ResearchStore {
  state: ResearchState | null;
  storageMode: StorageMode;
  addPaper: (paper: NewPaper) => Paper | undefined;
  importPaper: (file: File, details?: ImportPaperDetails) => Promise<Paper | undefined>;
  updatePaper: (id: string, patch: PaperPatch) => void;
  markPaperOpened: (id: string) => void;
  deletePaper: (id: string) => void;
  addNote: (note: NewNote) => Note | undefined;
  updateNote: (id: string, patch: NotePatch) => void;
  deleteNote: (id: string) => void;
  addMessage: (message: NewMessage) => ResearchMessage | undefined;
  updateMessage: (id: string, patch: MessagePatch) => void;
  deleteMessage: (id: string) => void;
  clearPaperMessages: (paperId: string) => void;
  updateProfile: (patch: Partial<Omit<ResearchProfile, 'updatedAt'>>) => void;
  updateSettings: (patch: Partial<Omit<ResearchSettings, 'updatedAt'>>) => void;
  replaceState: (state: ResearchState) => void;
  resetState: () => void;
  clearLocalData: () => Promise<void>;
  applySyncedState: (state: ResearchState) => void;
  subscribeMutations: (listener: ResearchMutationListener) => () => void;
}

function monotonicTimestamp(previous?: string): string {
  const current = Date.now();
  const prior = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(prior) && current <= prior ? prior + 1 : current).toISOString();
}

function makeTombstone<T extends { updatedAt: string }>(entity: T): T & { deleted: true; deletedAt: string } {
  const now = monotonicTimestamp(entity.updatedAt);
  return { ...entity, updatedAt: now, deleted: true, deletedAt: now };
}

function parseEnvelope(value: unknown): StorageEnvelope | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    if (typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt) || raw.savedAt < 0) return undefined;
    return { savedAt: raw.savedAt, state: parseResearchState(raw.state) };
  } catch {
    return undefined;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
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

async function writeIndexedDb(envelope: StorageEnvelope): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(envelope, STORE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function clearIndexedDbState(): Promise<void> {
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
  if (typeof localStorage === 'undefined') return undefined;
  const serialized = localStorage.getItem(LOCAL_KEY);
  if (!serialized) return undefined;
  try {
    return parseEnvelope(JSON.parse(serialized));
  } catch {
    try { localStorage.setItem(`${RECOVERY_PREFIX}${Date.now()}`, serialized); } catch { /* best effort */ }
    return undefined;
  }
}

function persistLocal(envelope: StorageEnvelope): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(envelope));
}

export function clearResearchStateLocalStorage(storage: Pick<Storage, 'key' | 'length' | 'removeItem'>): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === LOCAL_KEY || key?.startsWith(RECOVERY_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

function defaultPaperTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || 'Untitled paper';
}

export function useResearchStore(): ResearchStore {
  const [state, setState] = useState<ResearchState | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>('localStorage');
  const stateRef = useRef<ResearchState | null>(null);
  const listenersRef = useRef(new Set<ResearchMutationListener>());
  stateRef.current = state;

  const persist = useCallback((next: ResearchState) => {
    const envelope = { savedAt: Date.now(), state: next };
    try { persistLocal(envelope); } catch { /* IndexedDB remains the primary copy */ }
    void writeIndexedDb(envelope)
      .then(() => setStorageMode('indexeddb'))
      .catch(() => setStorageMode('localStorage'));
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
      const selected = [local, indexed]
        .filter((item): item is StorageEnvelope => Boolean(item))
        .sort((left, right) => right.savedAt - left.savedAt)[0];
      const initial = selected?.state ?? createStarterState();
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
      } catch { /* Ignore corrupt cross-tab state. */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const emit = useCallback((mutation: ResearchMutation) => {
    listenersRef.current.forEach((listener) => listener(mutation));
  }, []);

  const commit = useCallback((next: ResearchState, mutation?: ResearchMutation) => {
    const parsed = parseResearchState(next);
    stateRef.current = parsed;
    setState(parsed);
    persist(parsed);
    if (mutation) emit(mutation);
  }, [emit, persist]);

  const addPaper = useCallback((draft: NewPaper) => {
    const current = stateRef.current;
    if (!current) return undefined;
    const now = monotonicTimestamp();
    const id = createId('paper');
    const paper = parseResearchState({
      ...current,
      papers: [...current.papers, {
        ...draft,
        id,
        createdAt: now,
        updatedAt: now,
        file: { ...draft.file, storageKey: id },
      }],
    }).papers.at(-1)!;
    commit({ ...current, papers: [...current.papers, paper] }, { type: 'papers', papers: [paper] });
    return paper;
  }, [commit]);

  const importPaper = useCallback(async (file: File, details: ImportPaperDetails = {}) => {
    const current = stateRef.current;
    if (!current) return undefined;
    const now = monotonicTimestamp();
    const id = createId('paper');
    const localPdf = await putLocalPdf(id, file, file.name);
    const paper: Paper = {
      id,
      createdAt: now,
      updatedAt: now,
      title: details.title?.trim() || defaultPaperTitle(file.name),
      authors: details.authors ?? [],
      year: details.year,
      venue: details.venue,
      doi: details.doi,
      sourceUrl: details.sourceUrl,
      file: {
        storageKey: id,
        name: file.name,
        sizeBytes: file.size,
        mimeType: 'application/pdf',
        sha256: localPdf.sha256,
      },
      tags: details.tags ?? [],
      favorite: false,
      archived: false,
      analysisStatus: details.autoQueue ? 'queued' : 'local',
      analysisProgress: details.autoQueue ? 0 : undefined,
    };
    try {
      const parsed = parseResearchState({ ...current, papers: [...current.papers, paper] });
      commit(parsed, { type: 'papers', papers: [paper] });
      return paper;
    } catch (error) {
      await deleteLocalPdf(id).catch(() => undefined);
      throw error;
    }
  }, [commit]);

  const updatePaper = useCallback((id: string, patch: PaperPatch) => {
    const current = stateRef.current;
    const existing = current?.papers.find((paper) => paper.id === id && !paper.deleted);
    if (!current || !existing) return;
    const paper: Paper = { ...existing, ...patch, updatedAt: monotonicTimestamp(existing.updatedAt) };
    commit(
      { ...current, papers: current.papers.map((item) => item.id === id ? paper : item) },
      { type: 'papers', papers: [paper] },
    );
  }, [commit]);

  const markPaperOpened = useCallback((id: string) => {
    updatePaper(id, { lastOpenedAt: monotonicTimestamp() });
  }, [updatePaper]);

  const deletePaper = useCallback((id: string) => {
    const current = stateRef.current;
    const existing = current?.papers.find((paper) => paper.id === id && !paper.deleted);
    if (!current || !existing) return;
    const paper = makeTombstone(existing);
    const relatedNotes = current.notes
      .filter((note) => note.paperId === id && !note.deleted)
      .map(makeTombstone);
    const relatedMessages = current.messages
      .filter((message) => message.paperId === id && !message.deleted)
      .map(makeTombstone);
    const notesById = new Map(relatedNotes.map((note) => [note.id, note]));
    const messagesById = new Map(relatedMessages.map((message) => [message.id, message]));
    const next: ResearchState = {
      ...current,
      papers: current.papers.map((item) => item.id === id ? paper : item),
      notes: current.notes.map((note) => notesById.get(note.id) ?? note),
      messages: current.messages.map((message) => messagesById.get(message.id) ?? message),
    };
    commit(next, { type: 'replace', state: next });
    void deleteLocalPdf(existing.file.storageKey).catch(() => undefined);
  }, [commit]);

  const addNote = useCallback((draft: NewNote) => {
    const current = stateRef.current;
    if (!current || !current.papers.some((paper) => paper.id === draft.paperId && !paper.deleted)) return undefined;
    const now = monotonicTimestamp();
    const note: Note = { ...draft, id: createId('note'), createdAt: now, updatedAt: now };
    commit({ ...current, notes: [...current.notes, note] }, { type: 'notes', notes: [note] });
    return note;
  }, [commit]);

  const updateNote = useCallback((id: string, patch: NotePatch) => {
    const current = stateRef.current;
    const existing = current?.notes.find((note) => note.id === id && !note.deleted);
    if (!current || !existing) return;
    const note: Note = { ...existing, ...patch, updatedAt: monotonicTimestamp(existing.updatedAt) };
    commit(
      { ...current, notes: current.notes.map((item) => item.id === id ? note : item) },
      { type: 'notes', notes: [note] },
    );
  }, [commit]);

  const deleteNote = useCallback((id: string) => {
    const current = stateRef.current;
    const existing = current?.notes.find((note) => note.id === id && !note.deleted);
    if (!current || !existing) return;
    const note = makeTombstone(existing);
    commit(
      { ...current, notes: current.notes.map((item) => item.id === id ? note : item) },
      { type: 'notes', notes: [note] },
    );
  }, [commit]);

  const addMessage = useCallback((draft: NewMessage) => {
    const current = stateRef.current;
    if (!current || !current.papers.some((paper) => paper.id === draft.paperId && !paper.deleted)) return undefined;
    const now = monotonicTimestamp();
    const message: ResearchMessage = { ...draft, id: createId('message'), createdAt: now, updatedAt: now };
    commit(
      { ...current, messages: [...current.messages, message] },
      { type: 'messages', messages: [message] },
    );
    return message;
  }, [commit]);

  const updateMessage = useCallback((id: string, patch: MessagePatch) => {
    const current = stateRef.current;
    const existing = current?.messages.find((message) => message.id === id && !message.deleted);
    if (!current || !existing) return;
    const message: ResearchMessage = { ...existing, ...patch, updatedAt: monotonicTimestamp(existing.updatedAt) };
    commit(
      { ...current, messages: current.messages.map((item) => item.id === id ? message : item) },
      { type: 'messages', messages: [message] },
    );
  }, [commit]);

  const deleteMessage = useCallback((id: string) => {
    const current = stateRef.current;
    const existing = current?.messages.find((message) => message.id === id && !message.deleted);
    if (!current || !existing) return;
    const message = makeTombstone(existing);
    commit(
      { ...current, messages: current.messages.map((item) => item.id === id ? message : item) },
      { type: 'messages', messages: [message] },
    );
  }, [commit]);

  const clearPaperMessages = useCallback((paperId: string) => {
    const current = stateRef.current;
    if (!current) return;
    const changed = current.messages
      .filter((message) => message.paperId === paperId && !message.deleted)
      .map(makeTombstone);
    if (!changed.length) return;
    const byId = new Map(changed.map((message) => [message.id, message]));
    commit(
      { ...current, messages: current.messages.map((message) => byId.get(message.id) ?? message) },
      { type: 'messages', messages: changed },
    );
  }, [commit]);

  const updateProfile = useCallback((patch: Partial<Omit<ResearchProfile, 'updatedAt'>>) => {
    const current = stateRef.current;
    if (!current) return;
    const profile = { ...current.profile, ...patch, updatedAt: monotonicTimestamp(current.profile.updatedAt) };
    commit({ ...current, profile }, { type: 'profile', profile });
  }, [commit]);

  const updateSettings = useCallback((patch: Partial<Omit<ResearchSettings, 'updatedAt'>>) => {
    const current = stateRef.current;
    if (!current) return;
    const settings = { ...current.settings, ...patch, updatedAt: monotonicTimestamp(current.settings.updatedAt) };
    commit({ ...current, settings }, { type: 'settings', settings });
  }, [commit]);

  const replaceState = useCallback((incoming: ResearchState) => {
    const current = stateRef.current;
    if (!current) return;
    const parsed = parseResearchState(incoming);
    const replaceEntities = <T extends { id: string; updatedAt: string }>(existing: T[], next: T[]) => {
      const nextIds = new Set(next.map((item) => item.id));
      return [
        ...next.map((item) => ({ ...item, updatedAt: monotonicTimestamp(item.updatedAt) })),
        ...existing.filter((item) => !nextIds.has(item.id)).map(makeTombstone),
      ];
    };
    const next: ResearchState = {
      ...parsed,
      profile: { ...parsed.profile, updatedAt: monotonicTimestamp(current.profile.updatedAt) },
      settings: { ...parsed.settings, updatedAt: monotonicTimestamp(current.settings.updatedAt) },
      papers: replaceEntities(current.papers, parsed.papers) as Paper[],
      notes: replaceEntities(current.notes, parsed.notes) as Note[],
      messages: replaceEntities(current.messages, parsed.messages) as ResearchMessage[],
    };
    commit(next, { type: 'replace', state: next });
  }, [commit]);

  const resetState = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const fresh = createStarterState(monotonicTimestamp());
    const next: ResearchState = {
      ...fresh,
      papers: current.papers.map(makeTombstone),
      notes: current.notes.map(makeTombstone),
      messages: current.messages.map(makeTombstone),
    };
    commit(next, { type: 'replace', state: next });
    void clearLocalPdfs().catch(() => undefined);
  }, [commit]);

  const clearLocalData = useCallback(async () => {
    clearResearchStateLocalStorage(localStorage);
    await clearIndexedDbState();
    await clearLocalPdfs();
  }, []);

  const applySyncedState = useCallback((incoming: ResearchState) => {
    const parsed = parseResearchState(incoming);
    stateRef.current = parsed;
    setState(parsed);
    persist(parsed);
  }, [persist]);

  const subscribeMutations = useCallback((listener: ResearchMutationListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  return {
    state,
    storageMode,
    addPaper,
    importPaper,
    updatePaper,
    markPaperOpened,
    deletePaper,
    addNote,
    updateNote,
    deleteNote,
    addMessage,
    updateMessage,
    deleteMessage,
    clearPaperMessages,
    updateProfile,
    updateSettings,
    replaceState,
    resetState,
    clearLocalData,
    applySyncedState,
    subscribeMutations,
  };
}
