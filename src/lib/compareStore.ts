import { useSyncExternalStore } from 'react';

// Source of truth for the comparison tray. Persisted so a gene added from the
// browser or a detail page is still there when you open the Compare panel.

const KEY = 'mtbscope-compare';
const MAX = 8;

let orfs: string[] = load();
const listeners = new Set<() => void>();

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(orfs));
  } catch {
    /* ignore quota */
  }
  listeners.forEach((l) => l());
}

export const compareStore = {
  get: () => orfs,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  has: (orf: string) => orfs.includes(orf),
  add(orf: string) {
    if (orfs.includes(orf) || orfs.length >= MAX) return;
    orfs = [...orfs, orf];
    emit();
  },
  remove(orf: string) {
    orfs = orfs.filter((o) => o !== orf);
    emit();
  },
  toggle(orf: string) {
    orfs.includes(orf) ? this.remove(orf) : this.add(orf);
  },
  set(next: string[]) {
    const uniq = Array.from(new Set(next)).slice(0, MAX);
    if (uniq.join(',') === orfs.join(',')) return;
    orfs = uniq;
    emit();
  },
  clear() {
    if (!orfs.length) return;
    orfs = [];
    emit();
  },
  max: MAX,
};

export function useCompare(): string[] {
  return useSyncExternalStore(compareStore.subscribe, compareStore.get, compareStore.get);
}
