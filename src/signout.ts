export interface SafeSignOutSteps {
  waitForPendingWrites: () => Promise<void>;
  signOutAuth: () => Promise<void>;
  clearLocalData: () => Promise<void>;
  clearFirestoreCache: () => Promise<void>;
}

/**
 * Data is removed only after Firestore confirms every queued write. Keeping
 * this sequence pure makes the destructive sign-out contract testable.
 */
export async function finishSafeSignOut(steps: SafeSignOutSteps) {
  await steps.waitForPendingWrites();
  await steps.signOutAuth();
  await steps.clearLocalData();
  await steps.clearFirestoreCache();
}
