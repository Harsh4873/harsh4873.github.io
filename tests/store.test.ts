import { describe, expect, it } from 'vitest';
import { clearResearchStateLocalStorage } from '../src/store';

function memoryStorage(entries: Array<[string, string]>) {
  const values = new Map(entries);
  const storage: Pick<Storage, 'key' | 'length' | 'removeItem'> = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
  };
  return { storage, values };
}

describe('research local-state cleanup', () => {
  it('removes the primary state and every recovery copy without touching unrelated keys', () => {
    const { storage, values } = memoryStorage([
      ['sift-research-state-v1', 'current'],
      ['sift-research-recovery-100', 'first corrupt copy'],
      ['sift-research-recovery-200', 'second corrupt copy'],
      ['sift-active-paper', 'paper-1'],
      ['another-app', 'keep'],
    ]);

    clearResearchStateLocalStorage(storage);

    expect([...values.keys()]).toEqual(['sift-active-paper', 'another-app']);
  });
});
