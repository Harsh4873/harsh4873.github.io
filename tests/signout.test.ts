import { describe, expect, it, vi } from 'vitest';
import { finishSafeResearchSignOut } from '../src/useResearchSync';

describe('safe Sift sign-out', () => {
  it('acknowledges writes and clears both device stores before ending auth', async () => {
    const order: string[] = [];
    await finishSafeResearchSignOut({
      waitForPendingWrites: async () => { order.push('writes'); },
      clearFirestoreCache: async () => { order.push('firestore'); },
      clearLocalData: async () => { order.push('local'); },
      signOutAuth: async () => { order.push('auth'); },
    });
    expect(order).toEqual(['writes', 'firestore', 'local', 'auth']);
  });

  it('keeps every local copy and auth when pending writes cannot be confirmed', async () => {
    const clearFirestoreCache = vi.fn(async () => undefined);
    const clearLocalData = vi.fn(async () => undefined);
    const signOutAuth = vi.fn(async () => undefined);
    await expect(finishSafeResearchSignOut({
      waitForPendingWrites: async () => { throw new Error('offline'); },
      clearFirestoreCache,
      clearLocalData,
      signOutAuth,
    })).rejects.toThrow('offline');
    expect(clearFirestoreCache).not.toHaveBeenCalled();
    expect(clearLocalData).not.toHaveBeenCalled();
    expect(signOutAuth).not.toHaveBeenCalled();
  });

  it('does not remove app-local PDFs if another tab still owns Firestore cache', async () => {
    const clearLocalData = vi.fn(async () => undefined);
    const signOutAuth = vi.fn(async () => undefined);
    await expect(finishSafeResearchSignOut({
      waitForPendingWrites: async () => undefined,
      clearFirestoreCache: async () => { throw new Error('cache locked'); },
      clearLocalData,
      signOutAuth,
    })).rejects.toThrow('cache locked');
    expect(clearLocalData).not.toHaveBeenCalled();
    expect(signOutAuth).not.toHaveBeenCalled();
  });
});
