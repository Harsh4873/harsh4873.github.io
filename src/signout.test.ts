import { describe, expect, it, vi } from 'vitest';
import { finishSafeSignOut } from './signout';

describe('safe sign-out', () => {
  it('acknowledges writes before signing out and clearing either local cache', async () => {
    const order: string[] = [];

    await finishSafeSignOut({
      waitForPendingWrites: async () => { order.push('wait'); },
      signOutAuth: async () => { order.push('auth'); },
      clearLocalData: async () => { order.push('slate-local'); },
      clearFirestoreCache: async () => { order.push('firestore-cache'); },
    });

    expect(order).toEqual(['wait', 'auth', 'slate-local', 'firestore-cache']);
  });

  it('keeps local data and the signed-in session when pending writes cannot be confirmed', async () => {
    const signOutAuth = vi.fn(async () => undefined);
    const clearLocalData = vi.fn(async () => undefined);
    const clearFirestoreCache = vi.fn(async () => undefined);

    await expect(finishSafeSignOut({
      waitForPendingWrites: async () => { throw new Error('offline'); },
      signOutAuth,
      clearLocalData,
      clearFirestoreCache,
    })).rejects.toThrow('offline');

    expect(signOutAuth).not.toHaveBeenCalled();
    expect(clearLocalData).not.toHaveBeenCalled();
    expect(clearFirestoreCache).not.toHaveBeenCalled();
  });
});
