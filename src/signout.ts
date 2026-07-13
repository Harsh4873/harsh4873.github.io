export interface SafeSignOutSteps {
  waitForPendingWrites: () => Promise<void>;
  signOutAuth: () => Promise<void>;
  clearLocalData: () => Promise<void>;
  clearFirestoreCache: () => Promise<void>;
}

/**
 * Never remove either device copy until every queued mutation is acknowledged.
 * Firestore cache erasure is a precondition for local removal and auth sign-out:
 * if another tab still owns the cache, the account session and app copy remain.
 */
export async function finishSafeSignOut(steps: SafeSignOutSteps) {
  await steps.waitForPendingWrites();
  await steps.clearFirestoreCache();
  await steps.clearLocalData();
  await steps.signOutAuth();
}
