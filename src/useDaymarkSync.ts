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
  query,
  setDoc,
  terminate,
  updateDoc,
  waitForPendingWrites,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  authPersistenceReady,
  daymarkFirestore,
  firebaseAuth,
  googleProvider,
} from './firebase';
import { createInitialState, makeGenerationId, type TrackerState } from './model';
import { finishSafeSignOut } from './signout';
import {
  LEGACY_LOCAL_GENERATION_ID,
  materializeCloudState,
  mergeSameGeneration,
  resolveInitialSync,
  serializeEntryDocument,
  serializeHabitDocument,
  serializeRootDocument,
  serializeTrackerDelta,
  serializeTrackerState,
  type CloudEntryDocument,
  type CloudHabitDocument,
  type CloudUserDocument,
} from './sync-core';
import { parseTrackerState, type TrackerMutation, type TrackerStore } from './store';

const ALLOWED_EMAIL = 'hdav4873@gmail.com';
const WRITE_BATCH_SIZE = 450;

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'action-needed';

export interface DaymarkSync {
  status: SyncStatus;
  user: User | null;
  lastSyncedAt?: string;
  message?: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

function timestampOrder(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }
  return left.localeCompare(right);
}

function friendlySyncError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('popup-closed-by-user')) return 'Sign-in was cancelled. Your local tracker is unchanged.';
  if (code.includes('popup-blocked')) return 'Allow the Google sign-in window, then try again.';
  if (code.includes('permission-denied')) return 'This Google account is not allowed to access Daymark.';
  if (code.includes('unavailable') || !navigator.onLine) return 'You are offline. Changes stay on this device and will sync after reconnection.';
  return error instanceof Error ? error.message : 'Daymark could not finish syncing. Your local data is still safe.';
}

function isCloudRoot(value: unknown): value is CloudUserDocument {
  if (!value || typeof value !== 'object') return false;
  const root = value as Partial<CloudUserDocument>;
  return root.schemaVersion === 2
    && typeof root.generationId === 'string'
    && typeof root.generationUpdatedAt === 'string'
    && root.profileGenerationId === root.generationId
    && typeof root.updatedAt === 'string'
    && Boolean(root.profile);
}

export function useDaymarkSync(store: TrackerStore): DaymarkSync {
  const [status, setStatus] = useState<SyncStatus>(() => navigator.onLine ? 'action-needed' : 'offline');
  const [user, setUser] = useState<User | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>();
  const [message, setMessage] = useState<string>();
  const localStateRef = useRef(store.state);
  const activeUserRef = useRef<User | null>(null);
  const stopAllListenersRef = useRef<() => void>(() => undefined);
  const bootstrapActiveUserRef = useRef<() => void>(() => undefined);
  const otherTabsOpenRef = useRef<() => Promise<boolean>>(async () => false);
  localStateRef.current = store.state;

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const tabId = makeGenerationId();
    const channel = new BroadcastChannel('daymark-tab-presence');
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
      const requestId = makeGenerationId();
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
    let activeGeneration: string | null = null;
    let rootUnsubscribe: Unsubscribe | undefined;
    let habitUnsubscribe: Unsubscribe | undefined;
    let entryUnsubscribe: Unsubscribe | undefined;
    let subscribedGeneration: string | null = null;
    let rootDocument: CloudUserDocument | null = null;
    let habitDocuments: CloudHabitDocument[] = [];
    let entryDocuments: CloudEntryDocument[] = [];
    let habitsReady = false;
    let entriesReady = false;
    let rootFromCache = true;
    let habitsFromCache = true;
    let entriesFromCache = true;
    let rootHasPendingWrites = false;
    let habitsHavePendingWrites = false;
    let entriesHavePendingWrites = false;
    let pendingWriteCount = 0;
    let pendingGeneration: string | null = null;
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
      const now = new Date().toISOString();
      setStatus(navigator.onLine ? 'synced' : 'offline');
      setLastSyncedAt(now);
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

    function stopDataListeners() {
      habitUnsubscribe?.();
      entryUnsubscribe?.();
      habitUnsubscribe = undefined;
      entryUnsubscribe = undefined;
      subscribedGeneration = null;
      rootDocument = null;
      habitDocuments = [];
      entryDocuments = [];
      habitsReady = false;
      entriesReady = false;
    }

    function stopAllListeners() {
      bootstrapSequence += 1;
      rootUnsubscribe?.();
      rootUnsubscribe = undefined;
      stopDataListeners();
    }
    stopAllListenersRef.current = stopAllListeners;

    function rootReference(uid: string) {
      return doc(daymarkFirestore, 'daymark_users', uid);
    }

    function trackWrite(write: Promise<unknown>) {
      pendingWriteCount += 1;
      updateConnectionStatus();
      if (navigator.onLine) setStatus('syncing');
      setMessage(undefined);

      return write.then(() => {
        pendingWriteCount = Math.max(0, pendingWriteCount - 1);
        if (pendingWriteCount === 0) markSynced();
      }).catch((error) => {
        pendingWriteCount = Math.max(0, pendingWriteCount - 1);
        showError(error);
        throw error;
      });
    }

    async function queueFullStateWrite(uid: string, state: TrackerState) {
      const serialized = serializeTrackerState(state);
      const root = rootReference(uid);
      const children: Array<{ reference: DocumentReference<DocumentData>; data: DocumentData }> = [
        ...serialized.habits.map(({ id, data }) => ({
          reference: doc(daymarkFirestore, 'daymark_users', uid, 'habits', id),
          data,
        })),
        ...serialized.entries.map(({ id, data }) => ({
          reference: doc(daymarkFirestore, 'daymark_users', uid, 'entries', id),
          data,
        })),
      ];

      if (children.length + 1 <= 500) {
        const batch = writeBatch(daymarkFirestore);
        children.forEach(({ reference, data }) => batch.set(reference, data));
        batch.set(root, serialized.root);
        await batch.commit();
      } else {
        const childWrites: Array<Promise<void>> = [];
        for (let index = 0; index < children.length; index += WRITE_BATCH_SIZE) {
          const batch = writeBatch(daymarkFirestore);
          children.slice(index, index + WRITE_BATCH_SIZE).forEach(({ reference, data }) => batch.set(reference, data));
          childWrites.push(batch.commit());
        }
        // Generation-scoped child IDs make staging safe. The authoritative
        // root flips only after every child batch is acknowledged.
        await Promise.all(childWrites);
        const rootBatch = writeBatch(daymarkFirestore);
        rootBatch.set(root, serialized.root);
        await rootBatch.commit();
      }

      activeGeneration = state.generationId;
    }

    async function queueMergeDeltaWrite(uid: string, cloud: TrackerState, merged: TrackerState) {
      const delta = serializeTrackerDelta(cloud, merged);
      const children: Array<{ reference: DocumentReference<DocumentData>; data: DocumentData }> = [
        ...delta.habits.map(({ id, data }) => ({
          reference: doc(daymarkFirestore, 'daymark_users', uid, 'habits', id),
          data,
        })),
        ...delta.entries.map(({ id, data }) => ({
          reference: doc(daymarkFirestore, 'daymark_users', uid, 'entries', id),
          data,
        })),
      ];
      const writes: Array<Promise<void>> = [];
      for (let index = 0; index < children.length; index += WRITE_BATCH_SIZE) {
        const batch = writeBatch(daymarkFirestore);
        children.slice(index, index + WRITE_BATCH_SIZE).forEach(({ reference, data }) => batch.set(reference, data));
        writes.push(batch.commit());
      }
      if (delta.root) {
        writes.push(updateDoc(rootReference(uid), {
          profile: delta.root.profile,
          updatedAt: delta.root.updatedAt,
          profileGenerationId: merged.generationId,
        }));
      }
      await Promise.all(writes);
    }

    function queueMutation(uid: string, mutation: TrackerMutation) {
      const current = localStateRef.current;
      if (!current) return;

      if (mutation.type === 'replace') {
        activeGeneration = mutation.state.generationId;
        pendingGeneration = mutation.state.generationId;
        stopDataListeners();
        void trackWrite(queueFullStateWrite(uid, mutation.state))
          .then(() => {
            const latest = localStateRef.current;
            if (latest?.generationId !== mutation.state.generationId) return;
            const acknowledged = { ...latest, generationPending: false };
            localStateRef.current = acknowledged;
            store.applySyncedState(acknowledged);
          })
          .finally(() => {
            if (pendingGeneration === mutation.state.generationId) pendingGeneration = null;
          })
          .catch(() => undefined);
        return;
      }

      if (current.generationId === LEGACY_LOCAL_GENERATION_ID || !activeGeneration) {
        updateConnectionStatus();
        return;
      }

      if (mutation.type === 'entry') {
        const serialized = serializeEntryDocument(
          mutation.dateKey,
          mutation.habitId,
          mutation.entry,
          current.generationId,
        );
        void trackWrite(setDoc(
          doc(daymarkFirestore, 'daymark_users', uid, 'entries', serialized.id),
          serialized.data,
        )).catch(() => undefined);
        return;
      }

      if (mutation.type === 'habits') {
        const batch = writeBatch(daymarkFirestore);
        mutation.habits.forEach((habit) => {
          const serialized = serializeHabitDocument(habit, current.generationId);
          batch.set(doc(daymarkFirestore, 'daymark_users', uid, 'habits', serialized.id), serialized.data);
        });
        void trackWrite(batch.commit()).catch(() => undefined);
        return;
      }

      const serializedRoot = serializeRootDocument(current);
      void trackWrite(updateDoc(rootReference(uid), {
        profile: serializedRoot.profile,
        updatedAt: serializedRoot.updatedAt,
        profileGenerationId: current.generationId,
      })).catch(() => undefined);
    }

    const unsubscribeMutations = store.subscribeMutations((mutation) => {
      if (!activeUid) return;
      queueMutation(activeUid, mutation);
    });

    function remoteGenerationWins(local: TrackerState, remote: CloudUserDocument, fromCache: boolean) {
      if (local.generationId === remote.generationId) return true;
      if (local.generationPending || pendingGeneration === local.generationId) return false;
      if (!fromCache) return true;
      if (local.generationId === LEGACY_LOCAL_GENERATION_ID) return true;
      const order = timestampOrder(remote.generationUpdatedAt, local.generationUpdatedAt);
      return order > 0 || (order === 0 && remote.generationId.localeCompare(local.generationId) > 0);
    }

    function maybeApplyCloudState() {
      if (!rootDocument || !habitsReady || !entriesReady) return;
      try {
        const cloud = parseTrackerState(materializeCloudState(rootDocument, habitDocuments, entryDocuments));
        const local = localStateRef.current;
        if (!local || !remoteGenerationWins(local, rootDocument, rootFromCache)) return;

        const hasPendingWrites = pendingWriteCount > 0
          || rootHasPendingWrites
          || habitsHavePendingWrites
          || entriesHavePendingWrites;
        const fromCache = rootFromCache || habitsFromCache || entriesFromCache;
        const next = local.generationId === cloud.generationId && (hasPendingWrites || fromCache)
          ? mergeSameGeneration(local, cloud)
          : cloud;
        localStateRef.current = next;
        store.applySyncedState(next);
        activeGeneration = next.generationId;

        if (!navigator.onLine || fromCache) {
          setStatus('offline');
          setMessage('Showing the latest record available on this device.');
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

    function startDataListeners(uid: string, root: CloudUserDocument, snapshotFromCache = false, snapshotPending = false) {
      rootDocument = root;
      rootFromCache = snapshotFromCache;
      rootHasPendingWrites = snapshotPending;
      if (subscribedGeneration === root.generationId) {
        maybeApplyCloudState();
        return;
      }

      stopDataListeners();
      subscribedGeneration = root.generationId;
      rootDocument = root;
      rootFromCache = snapshotFromCache;
      rootHasPendingWrites = snapshotPending;
      const habitsQuery = query(
        collection(daymarkFirestore, 'daymark_users', uid, 'habits'),
        where('generationId', '==', root.generationId),
      );
      const entriesQuery = query(
        collection(daymarkFirestore, 'daymark_users', uid, 'entries'),
        where('generationId', '==', root.generationId),
      );

      habitUnsubscribe = onSnapshot(habitsQuery, { includeMetadataChanges: true }, (snapshot) => {
        habitDocuments = snapshot.docs.map((item) => item.data() as CloudHabitDocument);
        habitsReady = true;
        habitsFromCache = snapshot.metadata.fromCache;
        habitsHavePendingWrites = snapshot.metadata.hasPendingWrites;
        maybeApplyCloudState();
      }, showError);

      entryUnsubscribe = onSnapshot(entriesQuery, { includeMetadataChanges: true }, (snapshot) => {
        entryDocuments = snapshot.docs.map((item) => item.data() as CloudEntryDocument);
        entriesReady = true;
        entriesFromCache = snapshot.metadata.fromCache;
        entriesHavePendingWrites = snapshot.metadata.hasPendingWrites;
        maybeApplyCloudState();
      }, showError);
    }

    function startRootListener(uid: string) {
      rootUnsubscribe?.();
      rootUnsubscribe = onSnapshot(rootReference(uid), { includeMetadataChanges: true }, (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (!isCloudRoot(data)) {
          showError(new Error('The cloud profile has an unsupported format.'));
          return;
        }
        const local = localStateRef.current;
        if (local && !remoteGenerationWins(local, data, snapshot.metadata.fromCache)) return;
        startDataListeners(uid, data, snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
      }, showError);
    }

    async function readCloudState(uid: string) {
      const rootSnapshot = await getDoc(rootReference(uid));
      if (!rootSnapshot.exists()) return null;
      const root = rootSnapshot.data();
      if (!isCloudRoot(root)) throw new Error('The cloud profile has an unsupported format.');
      const [habitSnapshot, entrySnapshot] = await Promise.all([
        getDocs(query(
          collection(daymarkFirestore, 'daymark_users', uid, 'habits'),
          where('generationId', '==', root.generationId),
        )),
        getDocs(query(
          collection(daymarkFirestore, 'daymark_users', uid, 'entries'),
          where('generationId', '==', root.generationId),
        )),
      ]);
      return parseTrackerState(materializeCloudState(
        root,
        habitSnapshot.docs.map((item) => item.data() as CloudHabitDocument),
        entrySnapshot.docs.map((item) => item.data() as CloudEntryDocument),
      ));
    }

    async function bootstrap(authUser: User) {
      if (bootstrapInFlight || disposed) return;
      bootstrapInFlight = true;
      const sequence = ++bootstrapSequence;
      setStatus(navigator.onLine ? 'syncing' : 'offline');
      setMessage(undefined);
      try {
        const cloud = await readCloudState(authUser.uid);
        if (disposed || sequence !== bootstrapSequence) return;
        const local = localStateRef.current;
        if (!local) return;
        const now = new Date().toISOString();
        const resolution = resolveInitialSync(local, cloud, {
          firstUploadGenerationId: makeGenerationId(),
          now,
        });
        localStateRef.current = resolution.state;
        store.applySyncedState(resolution.state);
        activeGeneration = resolution.state.generationId;

        if (resolution.shouldWriteCloud) {
          const write = resolution.mode === 'merge' && cloud
            ? queueMergeDeltaWrite(authUser.uid, cloud, resolution.state)
            : queueFullStateWrite(authUser.uid, resolution.state);
          const isGenerationWrite = resolution.mode !== 'merge';
          if (isGenerationWrite) pendingGeneration = resolution.state.generationId;
          try {
            await trackWrite(write);
            if (isGenerationWrite) {
              const acknowledged = { ...resolution.state, generationPending: false };
              localStateRef.current = acknowledged;
              store.applySyncedState(acknowledged);
            }
          } finally {
            if (isGenerationWrite && pendingGeneration === resolution.state.generationId) pendingGeneration = null;
          }
          if (disposed || sequence !== bootstrapSequence) return;
        }
        startRootListener(authUser.uid);
        startDataListeners(authUser.uid, serializeRootDocument(resolution.state));
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
      activeGeneration = null;
      activeUserRef.current = authUser;
      setUser(authUser);

      if (!authUser) {
        setStatus(navigator.onLine ? 'action-needed' : 'offline');
        setMessage(navigator.onLine ? 'Sign in once on this device to turn on automatic sync.' : 'You are offline. Local tracking is still available.');
        return;
      }
      if (authUser.email?.toLowerCase() !== ALLOWED_EMAIL || !authUser.emailVerified) {
        setStatus('action-needed');
        setMessage(`Daymark only allows ${ALLOWED_EMAIL}.`);
        void firebaseSignOut(firebaseAuth);
        return;
      }

      activeUid = authUser.uid;
      activeGeneration = localStateRef.current?.generationId === LEGACY_LOCAL_GENERATION_ID
        ? null
        : localStateRef.current?.generationId ?? null;
      void bootstrap(authUser);
    });

    function handleOffline() {
      updateConnectionStatus();
    }

    function handleOnline() {
      if (activeUserRef.current && rootUnsubscribe) {
        setStatus('syncing');
        setMessage(undefined);
      } else if (activeUserRef.current) void bootstrap(activeUserRef.current);
      else {
        setStatus('action-needed');
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
        throw new Error(`Daymark only allows ${ALLOWED_EMAIL}.`);
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
      setMessage('Reconnect before signing out so Daymark can confirm every pending change reached the cloud.');
      return;
    }
    if (await otherTabsOpenRef.current()) {
      setStatus('action-needed');
      setMessage('Close other open Daymark tabs, then sign out again so every local cache can be removed safely.');
      return;
    }
    setStatus('syncing');
    setMessage('Finishing pending writes before removing this device’s copy…');
    let authSessionEnded = false;
    try {
      await finishSafeSignOut({
        waitForPendingWrites: async () => {
          await Promise.race([
            waitForPendingWrites(daymarkFirestore),
            new Promise<never>((_, reject) => window.setTimeout(
              () => reject(new Error('Sync is taking longer than expected. Keep this tab open and try sign-out again after it shows Synced.')),
              20_000,
            )),
          ]);
          stopAllListenersRef.current();
        },
        signOutAuth: async () => {
          await firebaseSignOut(firebaseAuth);
          authSessionEnded = true;
        },
        clearLocalData: store.clearLocalData,
        clearFirestoreCache: async () => {
          await terminate(daymarkFirestore);
          await clearIndexedDbPersistence(daymarkFirestore);
        },
      });
      store.applySyncedState(createInitialState());
      window.location.reload();
    } catch (error) {
      if (authSessionEnded) {
        await store.clearLocalData().catch(() => undefined);
        store.applySyncedState(createInitialState());
      }
      setStatus('action-needed');
      setMessage(authSessionEnded
        ? 'The account is signed out and Daymark hid this device’s record, but the browser cache could not be fully released. Reload after closing other Daymark tabs.'
        : friendlySyncError(error));
    }
  }, [store.applySyncedState, store.clearLocalData]);

  return { status, user, lastSyncedAt, message, signIn, signOut };
}
