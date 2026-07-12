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
  setDoc,
  terminate,
  waitForPendingWrites,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  authPersistenceReady,
  firebaseAuth,
  googleProvider,
  slateFirestore,
} from './firebase';
import { createInitialState, makeId, type SlateState } from './model';
import { finishSafeSignOut } from './signout';
import {
  isCloudRoot,
  materializeCloudState,
  mergeStates,
  resolveInitialSync,
  serializeEntityDocument,
  serializeRootDocument,
  stableStringify,
  type CloudRootDocument,
} from './sync-core';
import { parseSlateState, type SlateMutation, type SlateStore } from './store';

const ALLOWED_EMAIL = 'hdav4873@gmail.com';
const WRITE_BATCH_SIZE = 450;
const ENTITY_COLLECTIONS = ['sections', 'tasks', 'blocks'] as const;
type EntityCollection = (typeof ENTITY_COLLECTIONS)[number];

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'action-needed';

export interface SlateSync {
  status: SyncStatus;
  user: User | null;
  lastSyncedAt?: string;
  message?: string;
  signingOut: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

function friendlySyncError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('popup-closed-by-user')) return 'Sign-in was cancelled. Your local planner is unchanged.';
  if (code.includes('popup-blocked')) return 'Allow the Google sign-in window, then try again.';
  if (code.includes('permission-denied')) return 'This Google account is not allowed to access Slate.';
  if (code.includes('unavailable') || !navigator.onLine) return 'You are offline. Changes stay on this device and will sync after reconnection.';
  return error instanceof Error ? error.message : 'Slate could not finish syncing. Your local data is still safe.';
}

export function useSlateSync(store: SlateStore): SlateSync {
  const [status, setStatus] = useState<SyncStatus>(() => (navigator.onLine ? 'action-needed' : 'offline'));
  const [user, setUser] = useState<User | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const pendingWritesRef = useRef(0);
  const localStateRef = useRef(store.state);
  const activeUserRef = useRef<User | null>(null);
  const stopAllListenersRef = useRef<() => void>(() => undefined);
  const bootstrapActiveUserRef = useRef<() => void>(() => undefined);
  const otherTabsOpenRef = useRef<() => Promise<boolean>>(async () => false);
  localStateRef.current = store.state;

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const tabId = makeId('tab');
    const channel = new BroadcastChannel('slate-tab-presence');
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
      const requestId = makeId('probe');
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
    let rootUnsubscribe: Unsubscribe | undefined;
    const entityUnsubscribes = new Map<EntityCollection, Unsubscribe>();
    let rootDocument: CloudRootDocument | null = null;
    let rootReady = false;
    let rootFromCache = true;
    let rootHasPendingWrites = false;
    const entityDocuments: Record<EntityCollection, unknown[]> = { sections: [], tasks: [], blocks: [] };
    const entityReady: Record<EntityCollection, boolean> = { sections: false, tasks: false, blocks: false };
    const entityFromCache: Record<EntityCollection, boolean> = { sections: true, tasks: true, blocks: true };
    const entityPendingWrites: Record<EntityCollection, boolean> = { sections: false, tasks: false, blocks: false };
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

    function stopAllListeners() {
      bootstrapSequence += 1;
      rootUnsubscribe?.();
      rootUnsubscribe = undefined;
      entityUnsubscribes.forEach((unsubscribe) => unsubscribe());
      entityUnsubscribes.clear();
      rootDocument = null;
      rootReady = false;
      ENTITY_COLLECTIONS.forEach((name) => {
        entityDocuments[name] = [];
        entityReady[name] = false;
        entityFromCache[name] = true;
        entityPendingWrites[name] = false;
      });
    }
    stopAllListenersRef.current = stopAllListeners;

    function rootReference(uid: string) {
      return doc(slateFirestore, 'slate_users', uid);
    }

    function entityReference(uid: string, name: EntityCollection, id: string) {
      return doc(slateFirestore, 'slate_users', uid, name, id);
    }

    function trackWrite(write: Promise<unknown>) {
      pendingWriteCount += 1;
      pendingWritesRef.current = pendingWriteCount;
      updateConnectionStatus();
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

    async function commitEntityWrites(
      uid: string,
      writes: Array<{ reference: DocumentReference<DocumentData>; data: DocumentData }>,
      root?: CloudRootDocument,
    ) {
      const total = writes.length + (root ? 1 : 0);
      if (total === 0) return;
      if (total <= 500) {
        const batch = writeBatch(slateFirestore);
        writes.forEach(({ reference, data }) => batch.set(reference, data));
        if (root) batch.set(rootReference(uid), root as unknown as DocumentData);
        await batch.commit();
        return;
      }
      const chunks: Array<Promise<void>> = [];
      for (let index = 0; index < writes.length; index += WRITE_BATCH_SIZE) {
        const batch = writeBatch(slateFirestore);
        writes.slice(index, index + WRITE_BATCH_SIZE).forEach(({ reference, data }) => batch.set(reference, data));
        chunks.push(batch.commit());
      }
      await Promise.all(chunks);
      if (root) await setDoc(rootReference(uid), root as unknown as DocumentData);
    }

    function entityWrites(uid: string, name: EntityCollection, entities: Array<{ id: string }>) {
      return entities.map((entity) => {
        const serialized = serializeEntityDocument(entity);
        return { reference: entityReference(uid, name, serialized.id), data: serialized.data };
      });
    }

    function queueMutation(uid: string, mutation: SlateMutation) {
      const current = localStateRef.current;
      if (!current) return;

      if (mutation.type === 'replace') {
        const writes = [
          ...entityWrites(uid, 'sections', mutation.state.sections),
          ...entityWrites(uid, 'tasks', mutation.state.tasks),
          ...entityWrites(uid, 'blocks', mutation.state.blocks),
        ];
        void trackWrite(commitEntityWrites(uid, writes, serializeRootDocument(mutation.state))).catch(() => undefined);
        return;
      }

      if (mutation.type === 'settings') {
        // localStateRef refreshes on render, which happens AFTER the store
        // emits this mutation — serialize the payload itself so the newest
        // settings (not the previous ones) reach the cloud.
        const withSettings = { ...current, settings: mutation.settings };
        void trackWrite(setDoc(rootReference(uid), serializeRootDocument(withSettings) as unknown as DocumentData)).catch(() => undefined);
        return;
      }

      const entities = mutation.type === 'sections'
        ? mutation.sections
        : mutation.type === 'tasks'
          ? mutation.tasks
          : mutation.blocks;
      void trackWrite(commitEntityWrites(uid, entityWrites(uid, mutation.type, entities))).catch(() => undefined);
    }

    const unsubscribeMutations = store.subscribeMutations((mutation) => {
      if (!activeUid) return;
      queueMutation(activeUid, mutation);
    });

    function maybeApplyCloudState() {
      if (!rootReady || !ENTITY_COLLECTIONS.every((name) => entityReady[name])) return;
      try {
        const cloud = parseSlateState(materializeCloudState(
          rootDocument,
          entityDocuments.sections,
          entityDocuments.tasks,
          entityDocuments.blocks,
        ));
        const local = localStateRef.current;
        if (!local) return;

        const merged = mergeStates(local, cloud);
        if (stableStringify(merged) !== stableStringify(local)) {
          localStateRef.current = merged;
          store.applySyncedState(merged);
        }

        const hasPendingWrites = pendingWriteCount > 0
          || rootHasPendingWrites
          || ENTITY_COLLECTIONS.some((name) => entityPendingWrites[name]);
        const fromCache = rootFromCache || ENTITY_COLLECTIONS.some((name) => entityFromCache[name]);

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

    function startListeners(uid: string) {
      stopAllListeners();
      rootUnsubscribe = onSnapshot(rootReference(uid), { includeMetadataChanges: true }, (snapshot) => {
        rootReady = true;
        rootFromCache = snapshot.metadata.fromCache;
        rootHasPendingWrites = snapshot.metadata.hasPendingWrites;
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (!isCloudRoot(data)) {
            showError(new Error('The cloud copy has an unsupported format.'));
            return;
          }
          rootDocument = data;
        } else {
          rootDocument = null;
        }
        maybeApplyCloudState();
      }, showError);

      ENTITY_COLLECTIONS.forEach((name) => {
        const unsubscribe = onSnapshot(
          collection(slateFirestore, 'slate_users', uid, name),
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
        entityUnsubscribes.set(name, unsubscribe);
      });
    }

    async function readCloudState(uid: string): Promise<SlateState | null> {
      const rootSnapshot = await getDoc(rootReference(uid));
      let root: CloudRootDocument | null = null;
      if (rootSnapshot.exists()) {
        const data = rootSnapshot.data();
        if (!isCloudRoot(data)) throw new Error('The cloud copy has an unsupported format.');
        root = data;
      }
      const [sections, tasks, blocks] = await Promise.all(
        ENTITY_COLLECTIONS.map((name) => getDocs(collection(slateFirestore, 'slate_users', uid, name))),
      );
      if (!root && sections.empty && tasks.empty && blocks.empty) return null;
      return parseSlateState(materializeCloudState(
        root,
        sections.docs.map((item) => item.data()),
        tasks.docs.map((item) => item.data()),
        blocks.docs.map((item) => item.data()),
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

        const resolution = resolveInitialSync(local, cloud);
        localStateRef.current = resolution.state;
        store.applySyncedState(resolution.state);

        const writes = [
          ...entityWrites(authUser.uid, 'sections', resolution.uploadSections),
          ...entityWrites(authUser.uid, 'tasks', resolution.uploadTasks),
          ...entityWrites(authUser.uid, 'blocks', resolution.uploadBlocks),
        ];
        if (writes.length || resolution.uploadRoot) {
          await trackWrite(commitEntityWrites(
            authUser.uid,
            writes,
            resolution.uploadRoot ? serializeRootDocument(resolution.state) : undefined,
          ));
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
        setStatus(navigator.onLine ? 'action-needed' : 'offline');
        setMessage(navigator.onLine ? 'Sign in once on this device to turn on automatic sync.' : 'You are offline. Local planning is still available.');
        return;
      }
      if (authUser.email?.toLowerCase() !== ALLOWED_EMAIL || !authUser.emailVerified) {
        setStatus('action-needed');
        setMessage(`Slate only allows ${ALLOWED_EMAIL}.`);
        void firebaseSignOut(firebaseAuth);
        return;
      }

      activeUid = authUser.uid;
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
        throw new Error(`Slate only allows ${ALLOWED_EMAIL}.`);
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
      setMessage('Reconnect before signing out so Slate can confirm every pending change reached the cloud.');
      return;
    }
    if (await otherTabsOpenRef.current()) {
      setStatus('action-needed');
      setMessage('Close other open Slate tabs, then sign out again so every local cache can be removed safely.');
      return;
    }
    setStatus('syncing');
    setMessage('Finishing pending writes before removing this device’s copy…');
    setSigningOut(true);
    let authSessionEnded = false;
    try {
      await finishSafeSignOut({
        waitForPendingWrites: async () => {
          // The scrim blocks new edits from this point on; the loop covers
          // any write that slipped in before the scrim rendered.
          const drained = (async () => {
            do {
              await waitForPendingWrites(slateFirestore);
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
          authSessionEnded = true;
        },
        clearLocalData: store.clearLocalData,
        clearFirestoreCache: async () => {
          await terminate(slateFirestore);
          await clearIndexedDbPersistence(slateFirestore);
        },
      });
      store.applySyncedState(createInitialState());
      window.location.reload();
    } catch (error) {
      if (authSessionEnded) {
        await store.clearLocalData().catch(() => undefined);
        store.applySyncedState(createInitialState());
      }
      setSigningOut(false);
      setStatus('action-needed');
      setMessage(authSessionEnded
        ? 'The account is signed out and Slate hid this device’s record, but the browser cache could not be fully released. Reload after closing other Slate tabs.'
        : friendlySyncError(error));
    }
  }, [store.applySyncedState, store.clearLocalData]);

  return { status, user, lastSyncedAt, message, signingOut, signIn, signOut };
}
