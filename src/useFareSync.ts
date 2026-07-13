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
  terminate,
  waitForPendingWrites,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  authPersistenceReady,
  fareFirestore,
  firebaseAuth,
  googleProvider,
} from './firebase';
import type { FareState } from './model';
import { finishSafeSignOut } from './signout';
import {
  isCloudSingleton,
  materializeCloudState,
  resolveInitialSync,
  serializeEntityDocument,
  serializeSingletonDocument,
  stableStringify,
  type CloudSingletonDocuments,
  type CloudSingletonName,
} from './sync-core';
import { parseFareState, type FareMutation, type FareStore } from './store';

const ALLOWED_EMAIL = 'hdav4873@gmail.com';
const WRITE_BATCH_SIZE = 450;
const SINGLETON_COLLECTIONS = ['profile', 'targets', 'settings'] as const;
const ENTITY_COLLECTIONS = ['foods', 'meals', 'entries'] as const;
type EntityCollection = (typeof ENTITY_COLLECTIONS)[number];

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'signed-out' | 'action-needed';

export interface FareSync {
  status: SyncStatus;
  user: User | null;
  lastSyncedAt?: string;
  message?: string;
  signingOut: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

interface PendingWrite {
  reference: DocumentReference<DocumentData>;
  data: DocumentData;
}

interface CloudReadResult {
  state: FareState | null;
  missingSingletons: Set<CloudSingletonName>;
}

function makeTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fare-tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function friendlySyncError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('popup-closed-by-user')) return 'Sign-in was cancelled. Your local nutrition log is unchanged.';
  if (code.includes('popup-blocked')) return 'Allow the Google sign-in window, then try again.';
  if (code.includes('permission-denied')) return 'Fare could not reach its private cloud record. Your local log is still safe.';
  if (code.includes('unavailable') || !navigator.onLine) return 'You are offline. Changes stay on this device and will sync after reconnection.';
  return error instanceof Error ? error.message : 'Fare could not finish syncing. Your local data is still safe.';
}

function withEntityChanges<T extends { id: string }>(existing: T[], changes: T[]): T[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  changes.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Store mutation events precede React's next render, so mirror them into the
 * sync ref synchronously. This prevents an in-flight bootstrap read from
 * resolving against the previous render and rolling back a just-made edit. */
function applyMutationToRefState(current: FareState | null, mutation: FareMutation): FareState | null {
  if (mutation.type === 'replace') return mutation.state;
  if (!current) return current;
  switch (mutation.type) {
    case 'profile': return { ...current, profile: mutation.profile };
    case 'targets': return { ...current, targets: mutation.targets };
    case 'settings': return { ...current, settings: mutation.settings };
    case 'foods': return { ...current, foods: withEntityChanges(current.foods, mutation.foods) };
    case 'meals': return { ...current, meals: withEntityChanges(current.meals, mutation.meals) };
    case 'entries': return { ...current, entries: withEntityChanges(current.entries, mutation.entries) };
  }
  return current;
}

export function useFareSync(store: FareStore): FareSync {
  const [status, setStatus] = useState<SyncStatus>(() => (navigator.onLine ? 'syncing' : 'offline'));
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
    const channel = new BroadcastChannel('fare-tab-presence');
    const pending = new Map<string, () => void>();
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; requestId?: string; source?: string; target?: string };
      if (data.type === 'probe' && data.source !== tabId && data.requestId) {
        channel.postMessage({ type: 'present', requestId: data.requestId, target: data.source });
      }
      if (data.type === 'present' && data.target === tabId && data.requestId) {
        pending.get(data.requestId)?.();
      }
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
      otherTabsOpenRef.current = async () => false;
      pending.clear();
      channel.close();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let activeUid: string | null = null;
    const unsubscribes = new Set<Unsubscribe>();
    const singletonDocuments: CloudSingletonDocuments = { profile: null, targets: null, settings: null };
    const singletonReady: Record<CloudSingletonName, boolean> = { profile: false, targets: false, settings: false };
    const singletonFromCache: Record<CloudSingletonName, boolean> = { profile: true, targets: true, settings: true };
    const singletonPendingWrites: Record<CloudSingletonName, boolean> = { profile: false, targets: false, settings: false };
    const entityDocuments: Record<EntityCollection, unknown[]> = { foods: [], meals: [], entries: [] };
    const entityReady: Record<EntityCollection, boolean> = { foods: false, meals: false, entries: false };
    const entityFromCache: Record<EntityCollection, boolean> = { foods: true, meals: true, entries: true };
    const entityPendingWrites: Record<EntityCollection, boolean> = { foods: false, meals: false, entries: false };
    let pendingWriteCount = 0;
    let bootstrapInFlight = false;
    let bootstrapSequence = 0;

    function showError(error: unknown) {
      if (disposed) return;
      const offline = !navigator.onLine
        || (typeof error === 'object' && error && 'code' in error && String(error.code).includes('unavailable'));
      setStatus(offline ? 'offline' : 'action-needed');
      setMessage(friendlySyncError(error));
    }

    function markSynced() {
      if (disposed) return;
      setStatus(navigator.onLine ? 'synced' : 'offline');
      setLastSyncedAt(new Date().toISOString());
      setMessage(undefined);
    }

    function updateConnectionStatus() {
      if (disposed) return;
      if (!navigator.onLine) {
        setStatus('offline');
        setMessage('Changes are saved here and will sync automatically when this device reconnects.');
      } else if (activeUid && pendingWriteCount > 0) {
        setStatus('syncing');
        setMessage(undefined);
      }
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
      return doc(fareFirestore, 'fare_users', uid, name, 'current');
    }

    function entityReference(uid: string, name: EntityCollection, id: string) {
      return doc(fareFirestore, 'fare_users', uid, name, id);
    }

    function singletonWrite(uid: string, name: CloudSingletonName, value: FareState[CloudSingletonName]): PendingWrite {
      return {
        reference: singletonReference(uid, name),
        data: serializeSingletonDocument(value) as unknown as DocumentData,
      };
    }

    function entityWrites(uid: string, name: EntityCollection, entities: Array<{ id: string; updatedAt: string }>) {
      return entities.map((entity) => {
        const serialized = serializeEntityDocument(entity);
        return { reference: entityReference(uid, name, serialized.id), data: serialized.data };
      });
    }

    async function commitWrites(writes: PendingWrite[]) {
      if (writes.length === 0) return;
      for (let index = 0; index < writes.length; index += WRITE_BATCH_SIZE) {
        const batch = writeBatch(fareFirestore);
        writes.slice(index, index + WRITE_BATCH_SIZE).forEach(({ reference, data }) => batch.set(reference, data));
        await batch.commit();
      }
    }

    function trackWrite(write: Promise<unknown>) {
      pendingWriteCount += 1;
      pendingWritesRef.current = pendingWriteCount;
      if (navigator.onLine) setStatus('syncing');
      setMessage(undefined);

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

    function queueMutation(uid: string, mutation: FareMutation) {
      if (mutation.type === 'replace') {
        const writes: PendingWrite[] = [
          singletonWrite(uid, 'profile', mutation.state.profile),
          singletonWrite(uid, 'targets', mutation.state.targets),
          singletonWrite(uid, 'settings', mutation.state.settings),
          ...entityWrites(uid, 'foods', mutation.state.foods),
          ...entityWrites(uid, 'meals', mutation.state.meals),
          ...entityWrites(uid, 'entries', mutation.state.entries),
        ];
        void trackWrite(commitWrites(writes)).catch(() => undefined);
        return;
      }

      switch (mutation.type) {
        case 'profile':
          void trackWrite(commitWrites([singletonWrite(uid, 'profile', mutation.profile)]))
            .catch(() => undefined);
          return;
        case 'targets':
          void trackWrite(commitWrites([singletonWrite(uid, 'targets', mutation.targets)]))
            .catch(() => undefined);
          return;
        case 'settings':
          void trackWrite(commitWrites([singletonWrite(uid, 'settings', mutation.settings)]))
            .catch(() => undefined);
          return;
        case 'foods':
          void trackWrite(commitWrites(entityWrites(uid, 'foods', mutation.foods))).catch(() => undefined);
          return;
        case 'meals':
          void trackWrite(commitWrites(entityWrites(uid, 'meals', mutation.meals))).catch(() => undefined);
          return;
        case 'entries':
          void trackWrite(commitWrites(entityWrites(uid, 'entries', mutation.entries))).catch(() => undefined);
          return;
      }
    }

    const unsubscribeMutations = store.subscribeMutations((mutation) => {
      localStateRef.current = applyMutationToRefState(localStateRef.current, mutation);
      if (activeUid && !mutationsPausedRef.current) queueMutation(activeUid, mutation);
    });

    function maybeApplyCloudState() {
      const singletonsReady = SINGLETON_COLLECTIONS.every((name) => singletonReady[name]);
      const entitiesReady = ENTITY_COLLECTIONS.every((name) => entityReady[name]);
      if (!singletonsReady || !entitiesReady) return;
      try {
        const local = localStateRef.current;
        if (!local) return;
        const cloud = parseFareState(materializeCloudState(
          singletonDocuments,
          entityDocuments.foods,
          entityDocuments.meals,
          entityDocuments.entries,
          local,
        ));
        const resolution = resolveInitialSync(local, cloud);
        const merged = resolution.state;
        if (stableStringify(merged) !== stableStringify(local)) {
          localStateRef.current = merged;
          store.applySyncedState(merged);
        }

        const snapshotHasPendingWrites = SINGLETON_COLLECTIONS.some((name) => singletonPendingWrites[name])
          || ENTITY_COLLECTIONS.some((name) => entityPendingWrites[name]);
        const hasPendingWrites = pendingWriteCount > 0
          || snapshotHasPendingWrites;
        const fromCache = SINGLETON_COLLECTIONS.some((name) => singletonFromCache[name])
          || ENTITY_COLLECTIONS.some((name) => entityFromCache[name]);

        // Firestore commits are arrival-ordered, while Fare conflicts are
        // timestamp-ordered. If another device's older write arrived last,
        // repair the cloud with the deterministic winner so a third device
        // cannot inherit the stale copy.
        if (activeUid && navigator.onLine && !fromCache && !hasPendingWrites) {
          const repairs: PendingWrite[] = [
            ...(resolution.uploadProfile ? [singletonWrite(activeUid, 'profile', merged.profile)] : []),
            ...(resolution.uploadTargets ? [singletonWrite(activeUid, 'targets', merged.targets)] : []),
            ...(resolution.uploadSettings ? [singletonWrite(activeUid, 'settings', merged.settings)] : []),
            ...entityWrites(activeUid, 'foods', resolution.uploadFoods),
            ...entityWrites(activeUid, 'meals', resolution.uploadMeals),
            ...entityWrites(activeUid, 'entries', resolution.uploadEntries),
          ];
          if (repairs.length > 0) {
            void trackWrite(commitWrites(repairs)).catch(() => undefined);
            return;
          }
        }

        const currentHasPendingWrites = pendingWriteCount > 0
          || SINGLETON_COLLECTIONS.some((name) => singletonPendingWrites[name])
          || ENTITY_COLLECTIONS.some((name) => entityPendingWrites[name]);

        if (!navigator.onLine || fromCache) {
          setStatus('offline');
          setMessage('Showing the latest nutrition record available on this device.');
        } else if (currentHasPendingWrites) {
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
            if (!snapshot.exists()) {
              singletonDocuments[name] = null as never;
            } else {
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
          collection(fareFirestore, 'fare_users', uid, name),
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

    async function readCloudState(uid: string, fallback: FareState): Promise<CloudReadResult> {
      const singletonSnapshots = await Promise.all(
        SINGLETON_COLLECTIONS.map((name) => getDoc(singletonReference(uid, name))),
      );
      const entitySnapshots = await Promise.all(
        ENTITY_COLLECTIONS.map((name) => getDocs(collection(fareFirestore, 'fare_users', uid, name))),
      );
      const missingSingletons = new Set<CloudSingletonName>();
      const singletons: CloudSingletonDocuments = { profile: null, targets: null, settings: null };

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

      const state = parseFareState(materializeCloudState(
        singletons,
        entitySnapshots[0].docs.map((item) => item.data()),
        entitySnapshots[1].docs.map((item) => item.data()),
        entitySnapshots[2].docs.map((item) => item.data()),
        fallback,
      ));
      return { state, missingSingletons };
    }

    async function bootstrap(authUser: User) {
      if (bootstrapInFlight || disposed) return;
      const local = localStateRef.current;
      if (!local) return;
      bootstrapInFlight = true;
      const sequence = ++bootstrapSequence;
      setStatus(navigator.onLine ? 'syncing' : 'offline');
      setMessage(undefined);
      try {
        const cloud = await readCloudState(authUser.uid, local);
        if (disposed || sequence !== bootstrapSequence) return;
        // Local mutations remain available while the initial reads are in
        // flight. Resolve against the newest in-memory state, not the stale
        // pre-read capture, so a just-logged meal cannot be rolled back.
        const latestLocal = localStateRef.current;
        if (!latestLocal) return;
        const resolution = resolveInitialSync(latestLocal, cloud.state);
        localStateRef.current = resolution.state;
        store.applySyncedState(resolution.state);

        const writes: PendingWrite[] = [
          ...(resolution.uploadProfile || cloud.missingSingletons.has('profile')
            ? [singletonWrite(authUser.uid, 'profile', resolution.state.profile)] : []),
          ...(resolution.uploadTargets || cloud.missingSingletons.has('targets')
            ? [singletonWrite(authUser.uid, 'targets', resolution.state.targets)] : []),
          ...(resolution.uploadSettings || cloud.missingSingletons.has('settings')
            ? [singletonWrite(authUser.uid, 'settings', resolution.state.settings)] : []),
          ...entityWrites(authUser.uid, 'foods', resolution.uploadFoods),
          ...entityWrites(authUser.uid, 'meals', resolution.uploadMeals),
          ...entityWrites(authUser.uid, 'entries', resolution.uploadEntries),
        ];
        if (writes.length > 0) {
          await trackWrite(commitWrites(writes));
          if (disposed || sequence !== bootstrapSequence) return;
        }
        startListeners(authUser.uid);
        if (navigator.onLine && pendingWriteCount === 0) markSynced();
        else updateConnectionStatus();
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
          ? 'Sign in once on this device to turn on automatic sync.'
          : 'You are offline. Local calorie tracking is still available.');
        return;
      }
      if (authUser.email?.toLowerCase() !== ALLOWED_EMAIL || !authUser.emailVerified) {
        setStatus('action-needed');
        setMessage(`Fare only allows ${ALLOWED_EMAIL}.`);
        void firebaseSignOut(firebaseAuth);
        return;
      }

      activeUid = authUser.uid;
      mutationsPausedRef.current = false;
      void bootstrap(authUser);
    });

    function handleOffline() {
      updateConnectionStatus();
    }

    function handleOnline() {
      if (activeUserRef.current && unsubscribes.size > 0) {
        setStatus('syncing');
        setMessage(undefined);
      } else if (activeUserRef.current) {
        void bootstrap(activeUserRef.current);
      } else {
        setStatus('signed-out');
        setMessage('Sign in once on this device to turn on automatic sync.');
      }
    }

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
  }, [store.applySyncedState, store.subscribeMutations]);

  useEffect(() => {
    if (store.state) bootstrapActiveUserRef.current();
  }, [Boolean(store.state)]);

  const signIn = useCallback(async () => {
    setStatus(navigator.onLine ? 'syncing' : 'offline');
    setMessage(undefined);
    if (!navigator.onLine) {
      setMessage('Connect to the internet for the one-time Google sign-in.');
      return;
    }
    try {
      await authPersistenceReady;
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      if (result.user.email?.toLowerCase() !== ALLOWED_EMAIL || !result.user.emailVerified) {
        await firebaseSignOut(firebaseAuth);
        throw new Error(`Fare only allows ${ALLOWED_EMAIL}.`);
      }
    } catch (error) {
      setStatus('action-needed');
      setMessage(friendlySyncError(error));
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!activeUserRef.current) return;
    if (!navigator.onLine) {
      setStatus('action-needed');
      setMessage('Reconnect before signing out so Fare can confirm every pending change reached the cloud.');
      return;
    }
    if (await otherTabsOpenRef.current()) {
      setStatus('action-needed');
      setMessage('Close other open Fare tabs, then sign out again so every local cache can be removed safely.');
      return;
    }
    // This ref closes the mutation-listener race synchronously; the signingOut
    // scrim blocks user edits as soon as React commits this event.
    mutationsPausedRef.current = true;
    setStatus('syncing');
    setMessage('Finishing pending writes before removing this device’s copy…');
    setSigningOut(true);
    let cleanupStarted = false;
    try {
      await finishSafeSignOut({
        waitForPendingWrites: async () => {
          const drained = (async () => {
            do {
              await waitForPendingWrites(fareFirestore);
            } while (pendingWritesRef.current > 0);
          })();
          await Promise.race([
            drained,
            new Promise<never>((_, reject) => window.setTimeout(
              () => reject(new Error('Sync is taking longer than expected. Keep this tab open and try sign-out again after it shows Synced.')),
              20_000,
            )),
          ]);
          stopAllListenersRef.current();
        },
        signOutAuth: async () => {
          await firebaseSignOut(firebaseAuth);
        },
        clearLocalData: store.clearLocalData,
        clearFirestoreCache: async () => {
          cleanupStarted = true;
          await terminate(fareFirestore);
          await clearIndexedDbPersistence(fareFirestore);
        },
      });
      window.location.reload();
    } catch (error) {
      if (cleanupStarted) {
        // Firestore was terminated (and may already be cleared), so reload to
        // restore a usable signed-in session without claiming sign-out worked.
        window.location.reload();
        return;
      }
      mutationsPausedRef.current = false;
      setSigningOut(false);
      setStatus('action-needed');
      setMessage(friendlySyncError(error));
    }
  }, [store.clearLocalData]);

  return { status, user, lastSyncedAt, message, signingOut, signIn, signOut };
}
