import { describe, expect, it, vi } from 'vitest';
import { finishSafeSignOut } from './signout';

describe('safe sign-out', () => {
  it('acknowledges writes, erases both device copies, then ends auth', async () => {
    const order: string[] = [];
    await finishSafeSignOut({
      waitForPendingWrites: async () => { order.push('wait'); },
      signOutAuth: async () => { order.push('auth'); },
      clearLocalData: async () => { order.push('fare-local'); },
      clearFirestoreCache: async () => { order.push('firestore-cache'); },
    });
    expect(order).toEqual(['wait', 'firestore-cache', 'fare-local', 'auth']);
  });

  it('preserves local data and auth when pending writes cannot be confirmed', async () => {
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

  it('keeps auth and app-local data when the private Firestore cache cannot be erased', async () => {
    const signOutAuth = vi.fn(async () => undefined);
    const clearLocalData = vi.fn(async () => undefined);

    await expect(finishSafeSignOut({
      waitForPendingWrites: async () => undefined,
      signOutAuth,
      clearLocalData,
      clearFirestoreCache: async () => { throw new Error('another tab owns cache'); },
    })).rejects.toThrow('another tab owns cache');

    expect(clearLocalData).not.toHaveBeenCalled();
    expect(signOutAuth).not.toHaveBeenCalled();
  });
});
