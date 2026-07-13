import { useCallback, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  terminate,
  waitForPendingWrites,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import { authPersistenceReady, firebaseAuth, googleProvider, researchFirestore } from './firebase';
import { PaperSchema, RESEARCH_ADMIN_EMAIL, parseResearchState, type Paper, type ResearchState } from './model';
import {
  analysisMutationHasConflict,
  applyAnalysisPaperPatch,
  pickAnalysisPaperPatch,
  type AnalysisPaperMutationOperation,
  type AnalysisPaperMutationResult,
  type AnalysisPaperPatch,
} from './lib/analysis-paper-coordinator';
import {
  isCloudSingleton,
  materializeCloudState,
  mergePaperRecords,
  resolveInitialSync,
  serializeEntityDocument,
  serializeSingletonDocument,
  stableStringify,
  type CloudSingletonDocuments,
  type CloudSingletonName,
  type EntityCollectionName,
} from './sync-core';
import type { ResearchMutation, ResearchStore } from './store';

const WRITE_BATCH_SIZE = 450;
const SINGLETON_COLLECTIONS = ['profile', 'settings'] as const;
const ENTITY_COLLECTIONS = ['papers', 'notes', 'messages'] as const;

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'signed-out' | 'action-needed';

export interface ResearchSync {
  status: SyncStatus;
  user: User | null;
  lastSyncedAt?: string;
  message?: string;
  signingOut: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | undefined>;
  mutateAnalysisPaper: (
    paper: Paper,
    patch: AnalysisPaperPatch,
    operation: AnalysisPaperMutationOperation,
  ) => Promise<AnalysisPaperMutationResult>;
}

interface PendingWrite {
  reference: DocumentReference<DocumentData>;
  data: DocumentData;
}

interface SyncWritePlan {
  writes: PendingWrite[];
  papers: Paper[];
}

interface CloudReadResult {
  state: ResearchState | null;
  missingSingletons: Set<CloudSingletonName>;
}

export interface SafeSignOutSteps {
  waitForPendingWrites: () => Promise<void>;
  clearFirestoreCache: () => Promise<void>;
  clearLocalData: () => Promise<void>;
  signOutAuth: () => Promise<void>;
}

export async function finishSafeResearchSignOut(steps: SafeSignOutSteps): Promise<void> {
  await steps.waitForPendingWrites();
  await steps.clearFirestoreCache();
  await steps.clearLocalData();
  await steps.signOutAuth();
}

function makeTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `research-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

function friendlySyncError(error: unknown): string {
  const code = errorCode(error);
  if (code.includes('popup-closed-by-user')) return 'Sign-in was cancelled. Your local research library is unchanged.';
  if (code.includes('popup-blocked')) return 'Allow the Google sign-in window, then try again.';
  if (code.includes('permission-denied')) return 'Sift could not access its private cloud library. Your local papers are still safe.';
  if (code.includes('unavailable') || !navigator.onLine) {
    return 'You are offline. Changes stay on this device and will sync automatically after reconnection.';
  }
  return error instanceof Error ? error.message : 'Sift could not finish syncing. Your local research library is still safe.';
}

function isAuthorizedUser(user: User): boolean {
  return user.email?.toLowerCase() === RESEARCH_ADMIN_EMAIL
    && user.emailVerified
    && user.providerData.some((provider) => provider.providerId === 'google.com');
}

function withEntityChanges<T extends { id: string }>(existing: T[], changes: T[]): T[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  changes.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function applyMutationToState(
  current: ResearchState | null,
  mutation: ResearchMutation,
): ResearchState | null {
  if (mutation.type === 'replace') return mutation.state;
  if (!current) return current;
  switch (mutation.type) {
    case 'profile': return { ...current, profile: mutation.profile };
    case 'settings': return { ...current, settings: mutation.settings };
    case 'papers': return { ...current, papers: withEntityChanges(current.papers, mutation.papers) };
    case 'notes': return { ...current, notes: withEntityChanges(current.notes, mutation.notes) };
    case 'messages': return { ...current, messages: withEntityChanges(current.messages, mutation.messages) };
  }
}

export function useResearchSync(store: ResearchStore): ResearchSync {
  const [status, setStatus] = useState<SyncStatus>(() => navigator.onLine ? 'syncing' : 'offline');
  const [user, setUser] = useState<User | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const pendingWritesRef = useRef(0);
  const localStateRef = useRef(store.state);
  const activeUserRef = useRef<User | null>(null);
  const mutationsPausedRef = useRef(false);
  const stopAllListenersRef = useRef<() => void>(() => undefined);
  const bootstrapActiveUserRef = useRef<() => void>(() => undefined);
  const otherTabsOpenRef = useRef<() => Promise<boolean>>(async () => false);
  localStateRef.current = store.state;

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const tabId = makeTabId();
    const channel = new BroadcastChannel('sift-research-tab-presence');
    const pending = new Map<string, () => void>();
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; requestId?: string; source?: string; target?: string };
      if (data.type === 'probe' && data.source !== tabId && data.requestId) {
        channel.postMessage({ type: 'present', requestId: data.requestId, target: data.source });
      }
      if (data.type === 'present' && data.target === tabId && data.requestId) pending.get(data.requestId)?.();
    };
    otherTabsOpenRef.current = () => new Promise((resolve) => {
      const requestId = makeTabId();
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        pending.delete(requestId);
        resolve(value);
      };
      pending.set(requestId, () => finish(true));
      channel.postMessage({ type: 'probe', requestId, source: tabId });
      window.setTimeout(() => finish(false), 250);
    });
    return () => {
      pending.clear();
      channel.close();
      otherTabsOpenRef.current = async () => false;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let activeUid: string | null = null;
    const unsubscribes = new Set<Unsubscribe>();
    const singletonDocuments: CloudSingletonDocuments = { profile: null, settings: null };
    const singletonReady: Record<CloudSingletonName, boolean> = { profile: false, settings: false };
    const singletonFromCache: Record<CloudSingletonName, boolean> = { profile: true, settings: true };
    const singletonPendingWrites: Record<CloudSingletonName, boolean> = { profile: false, settings: false };
    const entityDocuments: Record<EntityCollectionName, unknown[]> = { papers: [], notes: [], messages: [] };
    const entityReady: Record<EntityCollectionName, boolean> = { papers: false, notes: false, messages: false };
    const entityFromCache: Record<EntityCollectionName, boolean> = { papers: true, notes: true, messages: true };
    const entityPendingWrites: Record<EntityCollectionName, boolean> = { papers: false, notes: false, messages: false };
    let pendingWriteCount = 0;
    let bootstrapInFlight = false;
    let bootstrapSequence = 0;

    function showError(error: unknown) {
      if (disposed) return;
      const offline = !navigator.onLine || errorCode(error).includes('unavailable');
      setStatus(offline ? 'offline' : 'action-needed');
      setMessage(friendlySyncError(error));
    }

    function markSynced() {
      if (disposed) return;
      setStatus(navigator.onLine ? 'synced' : 'offline');
      if (navigator.onLine) setLastSyncedAt(new Date().toISOString());
      setMessage(navigator.onLine ? undefined : 'Changes are saved here and will sync after reconnection.');
    }

    function stopAllListeners() {
      bootstrapSequence += 1;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      unsubscribes.clear();
      SINGLETON_COLLECTIONS.forEach((name) => {
        singletonDocuments[name] = null as never;
        singletonReady[name] = false;
        singletonFromCache[name] = true;
        singletonPendingWrites[name] = false;
      });
      ENTITY_COLLECTIONS.forEach((name) => {
        entityDocuments[name] = [];
        entityReady[name] = false;
        entityFromCache[name] = true;
        entityPendingWrites[name] = false;
      });
    }
    stopAllListenersRef.current = stopAllListeners;

    function singletonReference(uid: string, name: CloudSingletonName) {
      return doc(researchFirestore, 'research_users', uid, name, 'current');
    }

    function entityReference(uid: string, name: EntityCollectionName, id: string) {
      return doc(researchFirestore, 'research_users', uid, name, id);
    }

    function singletonWrite(
      uid: string,
      name: CloudSingletonName,
      value: ResearchState[CloudSingletonName],
    ): PendingWrite {
      return {
        reference: singletonReference(uid, name),
        data: serializeSingletonDocument(value) as DocumentData,
      };
    }

    function entityWrites(
      uid: string,
      name: EntityCollectionName,
      entities: Array<{ id: string; updatedAt: string; deleted?: true }>,
    ): PendingWrite[] {
      return entities.map((entity) => {
        const serialized = serializeEntityDocument(entity);
        return { reference: entityReference(uid, name, serialized.id), data: serialized.data };
      });
    }

    async function commitWrites(writes: PendingWrite[]) {
      for (let index = 0; index < writes.length; index += WRITE_BATCH_SIZE) {
        const batch = writeBatch(researchFirestore);
        writes.slice(index, index + WRITE_BATCH_SIZE).forEach(({ reference, data }) => batch.set(reference, data));
        await batch.commit();
      }
    }

    async function commitPaperWrites(uid: string, papers: Paper[]) {
      // Paper documents contain both ordinary metadata and transaction-owned
      // analysis fields. Read/merge/write each paper transactionally so a
      // stale title/tag edit can never replace a newer analysis generation.
      const concurrency = 12;
      for (let index = 0; index < papers.length; index += concurrency) {
        await Promise.all(papers.slice(index, index + concurrency).map(async (candidate) => {
          const proposed = PaperSchema.parse(candidate);
          const reference = entityReference(uid, 'papers', proposed.id);
          await runTransaction(researchFirestore, async (transaction) => {
            const snapshot = await transaction.get(reference);
            if (!snapshot.exists()) {
              transaction.set(reference, serializeEntityDocument(proposed).data);
              return;
            }
            const current = PaperSchema.parse(snapshot.data());
            const merged = mergePaperRecords(current, proposed, { preferredActiveSide: 'left' });
            if (stableStringify(merged) === stableStringify(current)) return;
            transaction.set(reference, serializeEntityDocument(merged).data);
          });
        }));
      }
    }

    async function commitWritePlan(uid: string, plan: SyncWritePlan) {
      await Promise.all([
        plan.writes.length ? commitWrites(plan.writes) : Promise.resolve(),
        plan.papers.length ? commitPaperWrites(uid, plan.papers) : Promise.resolve(),
      ]);
    }

    function trackWrite(write: Promise<unknown>) {
      pendingWriteCount += 1;
      pendingWritesRef.current = pendingWriteCount;
      if (navigator.onLine) setStatus('syncing');
      setMessage(navigator.onLine ? undefined : 'Saved on this device. Waiting to reconnect before syncing.');
      return write.then(() => {
        pendingWriteCount = Math.max(0, pendingWriteCount - 1);
        pendingWritesRef.current = pendingWriteCount;
        if (pendingWriteCount === 0) markSynced();
      }).catch((error) => {
        pendingWriteCount = Math.max(0, pendingWriteCount - 1);
        pendingWritesRef.current = pendingWriteCount;
        showError(error);
        throw error;
      });
    }

    function queueMutation(uid: string, mutation: ResearchMutation) {
      if (mutation.type === 'replace') {
        void trackWrite(commitWritePlan(uid, {
          writes: [
            singletonWrite(uid, 'profile', mutation.state.profile),
            singletonWrite(uid, 'settings', mutation.state.settings),
            ...entityWrites(uid, 'notes', mutation.state.notes),
            ...entityWrites(uid, 'messages', mutation.state.messages),
          ],
          papers: mutation.state.papers,
        })).catch(() => undefined);
        return;
      }
      switch (mutation.type) {
        case 'profile':
          void trackWrite(commitWrites([singletonWrite(uid, 'profile', mutation.profile)])).catch(() => undefined);
          return;
        case 'settings':
          void trackWrite(commitWrites([singletonWrite(uid, 'settings', mutation.settings)])).catch(() => undefined);
          return;
        case 'papers':
          void trackWrite(commitPaperWrites(uid, mutation.papers)).catch(() => undefined);
          return;
        case 'notes':
          void trackWrite(commitWrites(entityWrites(uid, 'notes', mutation.notes))).catch(() => undefined);
          return;
        case 'messages':
          void trackWrite(commitWrites(entityWrites(uid, 'messages', mutation.messages))).catch(() => undefined);
      }
    }

    const unsubscribeMutations = store.subscribeMutations((mutation) => {
      localStateRef.current = applyMutationToState(localStateRef.current, mutation);
      if (activeUid && !mutationsPausedRef.current) queueMutation(activeUid, mutation);
    });

    function resolutionWritePlan(uid: string, resolution: ReturnType<typeof resolveInitialSync>): SyncWritePlan {
      return {
        writes: [
          ...(resolution.uploadProfile ? [singletonWrite(uid, 'profile', resolution.state.profile)] : []),
          ...(resolution.uploadSettings ? [singletonWrite(uid, 'settings', resolution.state.settings)] : []),
          ...entityWrites(uid, 'notes', resolution.uploadNotes),
          ...entityWrites(uid, 'messages', resolution.uploadMessages),
        ],
        papers: resolution.uploadPapers,
      };
    }

    function maybeApplyCloudState() {
      if (!SINGLETON_COLLECTIONS.every((name) => singletonReady[name])) return;
      if (!ENTITY_COLLECTIONS.every((name) => entityReady[name])) return;
      try {
        const local = localStateRef.current;
        if (!local) return;
        const cloud = parseResearchState(materializeCloudState(
          singletonDocuments,
          entityDocuments.papers,
          entityDocuments.notes,
          entityDocuments.messages,
          local,
        ));
        const resolution = resolveInitialSync(local, cloud);
        if (stableStringify(resolution.state) !== stableStringify(local)) {
          localStateRef.current = resolution.state;
          store.applySyncedState(resolution.state);
        }

        const hasPendingWrites = pendingWriteCount > 0
          || SINGLETON_COLLECTIONS.some((name) => singletonPendingWrites[name])
          || ENTITY_COLLECTIONS.some((name) => entityPendingWrites[name]);
        const fromCache = SINGLETON_COLLECTIONS.some((name) => singletonFromCache[name])
          || ENTITY_COLLECTIONS.some((name) => entityFromCache[name]);

        // Repair arrival-order cloud conflicts with the deterministic local
        // winner only after a complete server snapshot is quiet.
        if (activeUid && navigator.onLine && !fromCache && !hasPendingWrites) {
          const repairs = resolutionWritePlan(activeUid, resolution);
          if (repairs.writes.length || repairs.papers.length) {
            void trackWrite(commitWritePlan(activeUid, repairs)).catch(() => undefined);
            return;
          }
        }

        if (!navigator.onLine) {
          setStatus('offline');
          setMessage('Showing the latest research library saved on this device.');
        } else if (fromCache) {
          setStatus('syncing');
          setMessage('Using the saved sync snapshot while Sift checks the cloud.');
        } else if (hasPendingWrites) {
          setStatus('syncing');
          setMessage(undefined);
        } else {
          markSynced();
        }
      } catch (error) {
        showError(error);
      }
    }

    function startListeners(uid: string) {
      stopAllListeners();
      SINGLETON_COLLECTIONS.forEach((name) => {
        const unsubscribe = onSnapshot(
          singletonReference(uid, name),
          { includeMetadataChanges: true },
          (snapshot) => {
            singletonReady[name] = true;
            singletonFromCache[name] = snapshot.metadata.fromCache;
            singletonPendingWrites[name] = snapshot.metadata.hasPendingWrites;
            if (!snapshot.exists()) singletonDocuments[name] = null as never;
            else {
              const data = snapshot.data();
              if (!isCloudSingleton(data)) {
                showError(new Error(`The cloud ${name} record has an unsupported format.`));
                return;
              }
              singletonDocuments[name] = data as never;
            }
            maybeApplyCloudState();
          },
          showError,
        );
        unsubscribes.add(unsubscribe);
      });
      ENTITY_COLLECTIONS.forEach((name) => {
        const unsubscribe = onSnapshot(
          collection(researchFirestore, 'research_users', uid, name),
          { includeMetadataChanges: true },
          (snapshot) => {
            entityDocuments[name] = snapshot.docs.map((item) => item.data());
            entityReady[name] = true;
            entityFromCache[name] = snapshot.metadata.fromCache;
            entityPendingWrites[name] = snapshot.metadata.hasPendingWrites;
            maybeApplyCloudState();
          },
          showError,
        );
        unsubscribes.add(unsubscribe);
      });
    }

    async function readCloudState(uid: string, fallback: ResearchState): Promise<CloudReadResult> {
      const singletonSnapshots = await Promise.all(
        SINGLETON_COLLECTIONS.map((name) => getDoc(singletonReference(uid, name))),
      );
      const entitySnapshots = await Promise.all(
        ENTITY_COLLECTIONS.map((name) => getDocs(collection(researchFirestore, 'research_users', uid, name))),
      );
      const singletons: CloudSingletonDocuments = { profile: null, settings: null };
      const missingSingletons = new Set<CloudSingletonName>();
      SINGLETON_COLLECTIONS.forEach((name, index) => {
        const snapshot = singletonSnapshots[index];
        if (!snapshot.exists()) {
          missingSingletons.add(name);
          return;
        }
        const data = snapshot.data();
        if (!isCloudSingleton(data)) throw new Error(`The cloud ${name} record has an unsupported format.`);
        singletons[name] = data as never;
      });
      const hasAnyCloudData = singletonSnapshots.some((snapshot) => snapshot.exists())
        || entitySnapshots.some((snapshot) => !snapshot.empty);
      if (!hasAnyCloudData) return { state: null, missingSingletons };
      return {
        state: parseResearchState(materializeCloudState(
          singletons,
          entitySnapshots[0].docs.map((item) => item.data()),
          entitySnapshots[1].docs.map((item) => item.data()),
          entitySnapshots[2].docs.map((item) => item.data()),
          fallback,
        )),
        missingSingletons,
      };
    }

    async function bootstrap(authUser: User) {
      if (bootstrapInFlight || disposed) return;
      const local = localStateRef.current;
      if (!local) return;
      bootstrapInFlight = true;
      const sequence = ++bootstrapSequence;
      setStatus(navigator.onLine ? 'syncing' : 'offline');
      setMessage(navigator.onLine ? undefined : 'Saved locally. Waiting to reconnect before syncing.');
      try {
        const cloud = await readCloudState(authUser.uid, local);
        if (disposed || sequence !== bootstrapSequence) return;
        const latestLocal = localStateRef.current;
        if (!latestLocal) return;
        const resolution = resolveInitialSync(latestLocal, cloud.state);
        localStateRef.current = resolution.state;
        store.applySyncedState(resolution.state);
        const writes = resolutionWritePlan(authUser.uid, {
          ...resolution,
          uploadProfile: resolution.uploadProfile || cloud.missingSingletons.has('profile'),
          uploadSettings: resolution.uploadSettings || cloud.missingSingletons.has('settings'),
        });
        if (writes.writes.length || writes.papers.length) {
          await trackWrite(commitWritePlan(authUser.uid, writes));
          if (disposed || sequence !== bootstrapSequence) return;
        }
        startListeners(authUser.uid);
        if (navigator.onLine && pendingWriteCount === 0) markSynced();
      } catch (error) {
        showError(error);
      } finally {
        bootstrapInFlight = false;
      }
    }
    bootstrapActiveUserRef.current = () => {
      if (activeUserRef.current) void bootstrap(activeUserRef.current);
    };

    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (authUser) => {
      if (disposed) return;
      stopAllListeners();
      activeUid = null;
      activeUserRef.current = authUser;
      setUser(authUser);
      if (!authUser) {
        setStatus(navigator.onLine ? 'signed-out' : 'offline');
        setMessage(navigator.onLine
          ? 'Your research library is local. Sign in to turn on private Google sync.'
          : 'You are offline. Your local research library remains available.');
        return;
      }
      if (!isAuthorizedUser(authUser)) {
        setStatus('action-needed');
        setMessage(`Sift only allows the verified Google account ${RESEARCH_ADMIN_EMAIL}.`);
        void firebaseSignOut(firebaseAuth);
        return;
      }
      activeUid = authUser.uid;
      mutationsPausedRef.current = false;
      const currentProfile = localStateRef.current?.profile;
      if (currentProfile && (
        currentProfile.email !== RESEARCH_ADMIN_EMAIL
        || currentProfile.displayName !== (authUser.displayName ?? '')
        || currentProfile.photoURL !== (authUser.photoURL ?? undefined)
        || !currentProfile.onboardingComplete
      )) {
        store.updateProfile({
          email: RESEARCH_ADMIN_EMAIL,
          displayName: authUser.displayName ?? '',
          photoURL: authUser.photoURL ?? undefined,
          onboardingComplete: true,
        });
      }
      void bootstrap(authUser);
    });

    const handleOffline = () => {
      setStatus('offline');
      setMessage('Changes are saved here and will sync automatically when this device reconnects.');
    };
    const handleOnline = () => {
      if (activeUserRef.current && unsubscribes.size) {
        setStatus('syncing');
        setMessage(undefined);
      } else if (activeUserRef.current) {
        void bootstrap(activeUserRef.current);
      } else {
        setStatus('signed-out');
        setMessage('Your research library is local. Sign in to turn on private Google sync.');
      }
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      unsubscribeAuth();
      unsubscribeMutations();
      stopAllListeners();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      bootstrapActiveUserRef.current = () => undefined;
    };
  }, [store.applySyncedState, store.subscribeMutations, store.updateProfile]);

  useEffect(() => {
    if (store.state) bootstrapActiveUserRef.current();
  }, [Boolean(store.state)]);

  const signIn = useCallback(async () => {
    if (!navigator.onLine) {
      setStatus('offline');
      setMessage('Connect to the internet for Google sign-in. Your local library remains available.');
      return;
    }
    setStatus('syncing');
    setMessage(undefined);
    try {
      await authPersistenceReady;
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      if (!isAuthorizedUser(result.user)) {
        await firebaseSignOut(firebaseAuth);
        throw new Error(`Sift only allows the verified Google account ${RESEARCH_ADMIN_EMAIL}.`);
      }
    } catch (error) {
      const cancelled = errorCode(error).includes('popup-closed-by-user');
      setStatus(cancelled ? 'signed-out' : 'action-needed');
      setMessage(friendlySyncError(error));
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!activeUserRef.current) return;
    if (!navigator.onLine) {
      setStatus('action-needed');
      setMessage('Reconnect before signing out so Sift can confirm every pending change reached the cloud.');
      return;
    }
    if (await otherTabsOpenRef.current()) {
      setStatus('action-needed');
      setMessage('Close other open Sift tabs, then sign out again so this device’s private cache can be removed safely.');
      return;
    }
    mutationsPausedRef.current = true;
    setSigningOut(true);
    setStatus('syncing');
    setMessage('Finishing pending writes before removing this device’s private copy…');
    let cleanupStarted = false;
    try {
      await finishSafeResearchSignOut({
        waitForPendingWrites: async () => {
          const drain = (async () => {
            do {
              await waitForPendingWrites(researchFirestore);
            } while (pendingWritesRef.current > 0);
          })();
          await Promise.race([
            drain,
            new Promise<never>((_, reject) => window.setTimeout(
              () => reject(new Error('Sync is taking longer than expected. Keep this tab open and try sign-out again after it shows Synced.')),
              20_000,
            )),
          ]);
          stopAllListenersRef.current();
        },
        clearFirestoreCache: async () => {
          cleanupStarted = true;
          await terminate(researchFirestore);
          await clearIndexedDbPersistence(researchFirestore);
        },
        clearLocalData: store.clearLocalData,
        signOutAuth: async () => firebaseSignOut(firebaseAuth),
      });
      window.location.reload();
    } catch (error) {
      if (cleanupStarted) {
        window.location.reload();
        return;
      }
      mutationsPausedRef.current = false;
      setSigningOut(false);
      setStatus('action-needed');
      setMessage(friendlySyncError(error));
    }
  }, [store.clearLocalData]);

  const getIdToken = useCallback(async () => {
    const current = activeUserRef.current;
    if (!current || !isAuthorizedUser(current)) return undefined;
    return current.getIdToken();
  }, []);

  const mutateAnalysisPaper = useCallback(async (
    paper: Paper,
    patch: AnalysisPaperPatch,
    operation: AnalysisPaperMutationOperation,
  ): Promise<AnalysisPaperMutationResult> => {
    let basePaper: Paper;
    let localPaper: Paper;
    const analysisPatch = pickAnalysisPaperPatch(patch);
    try {
      basePaper = PaperSchema.parse(paper);
      localPaper = applyAnalysisPaperPatch(basePaper, analysisPatch);
    } catch (error) {
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : 'The analysis update is invalid.',
      };
    }

    const currentUser = activeUserRef.current;
    if (!navigator.onLine || !currentUser || !isAuthorizedUser(currentUser)) {
      if (analysisMutationHasConflict(basePaper, analysisPatch, operation)) {
        return { status: 'conflict', paper: basePaper };
      }
      return { status: 'local-only', paper: localPaper };
    }

    setStatus('syncing');
    setMessage(undefined);
    try {
      await waitForPendingWrites(researchFirestore);
      const reference = doc(researchFirestore, 'research_users', currentUser.uid, 'papers', paper.id);
      const result = await runTransaction<AnalysisPaperMutationResult>(researchFirestore, async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) {
          if (operation.type !== 'claim') return { status: 'conflict' };
          if (analysisMutationHasConflict(basePaper, analysisPatch, operation)) {
            return { status: 'conflict', paper: basePaper };
          }
          const created = applyAnalysisPaperPatch(basePaper, analysisPatch);
          transaction.set(reference, serializeEntityDocument(created).data);
          return { status: 'applied', paper: created };
        }

        const current = PaperSchema.parse(snapshot.data());
        const nowMs = Date.now();
        if (analysisMutationHasConflict(current, analysisPatch, operation, nowMs)) {
          return { status: 'conflict', paper: current };
        }
        const next = applyAnalysisPaperPatch(current, analysisPatch, nowMs);
        transaction.set(reference, serializeEntityDocument(next).data);
        return { status: 'applied', paper: next };
      });
      if (pendingWritesRef.current === 0) {
        setStatus('synced');
        setLastSyncedAt(new Date().toISOString());
      }
      return result;
    } catch (error) {
      const unavailableMessage = friendlySyncError(error);
      const offline = !navigator.onLine || errorCode(error).includes('unavailable');
      setStatus(offline ? 'offline' : 'action-needed');
      setMessage(unavailableMessage);
      return { status: 'unavailable', message: unavailableMessage };
    }
  }, []);

  return { status, user, lastSyncedAt, message, signingOut, signIn, signOut, getIdToken, mutateAnalysisPaper };
}
