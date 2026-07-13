import type { FareState } from './model';

/**
 * Fare syncs each mutable record independently. Foods, meals, and diary
 * entries retain `deleted: true` tombstones so a device that was offline
 * during a deletion cannot bring the record back. Profile, targets, and
 * settings are singleton documents and use the same deterministic LWW rule.
 */

interface Stamped {
  updatedAt: string;
}

type FareProfile = FareState['profile'];
type FareTargets = FareState['targets'];
type FareSettings = FareState['settings'];
type FareFood = FareState['foods'][number];
type FareMeal = FareState['meals'][number];
type FareEntry = FareState['entries'][number];

export type CloudSingletonName = 'profile' | 'targets' | 'settings';

export interface CloudSingletonDocuments {
  profile: FareProfile | null;
  targets: FareTargets | null;
  settings: FareSettings | null;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value
      .filter((item) => item !== undefined)
      .map((item) => stableStringify(item))
      .join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(',')}}`;
}

/** Remove values Firestore cannot encode while preserving null and falsy data. */
export function omitUndefinedDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => omitUndefinedDeep(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    result[key] = omitUndefinedDeep(item);
  }
  return result as T;
}

function timestampValue(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** LWW with a canonical JSON tie-break, making the result argument-order independent. */
export function selectNewer<T extends Stamped>(left: T, right: T): T {
  const leftTime = timestampValue(left.updatedAt);
  const rightTime = timestampValue(right.updatedAt);
  if (leftTime !== rightTime) return leftTime > rightTime ? left : right;
  const leftText = stableStringify(left);
  const rightText = stableStringify(right);
  if (leftText === rightText) return left;
  return leftText > rightText ? left : right;
}

function mergeById<T extends Stamped & { id: string }>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of [...local, ...remote]) {
    const existing = merged.get(item.id);
    merged.set(item.id, existing ? selectNewer(existing, item) : item);
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function mergeStates(local: FareState, remote: FareState): FareState {
  return {
    version: 1,
    profile: selectNewer(local.profile, remote.profile),
    targets: selectNewer(local.targets, remote.targets),
    settings: selectNewer(local.settings, remote.settings),
    foods: mergeById(local.foods, remote.foods),
    meals: mergeById(local.meals, remote.meals),
    entries: mergeById(local.entries, remote.entries),
  };
}

export function serializeSingletonDocument<T extends Stamped>(singleton: T): T {
  return omitUndefinedDeep({ ...singleton });
}

export function serializeEntityDocument<T extends Stamped & { id: string }>(entity: T) {
  return {
    id: entity.id,
    data: omitUndefinedDeep({ ...entity }) as Record<string, unknown>,
  };
}

/**
 * Assemble the untrusted cloud payload for the store parser. Missing singleton
 * documents temporarily inherit local values; bootstrap immediately uploads
 * those missing documents before listeners begin.
 */
export function materializeCloudState(
  singletons: CloudSingletonDocuments,
  foods: unknown[],
  meals: unknown[],
  entries: unknown[],
  fallback: FareState,
): unknown {
  return {
    version: 1,
    profile: singletons.profile ?? fallback.profile,
    targets: singletons.targets ?? fallback.targets,
    settings: singletons.settings ?? fallback.settings,
    foods,
    meals,
    entries,
  };
}

export interface InitialSyncResolution {
  state: FareState;
  uploadProfile: boolean;
  uploadTargets: boolean;
  uploadSettings: boolean;
  uploadFoods: FareFood[];
  uploadMeals: FareMeal[];
  uploadEntries: FareEntry[];
}

function uploadCandidates<T extends Stamped & { id: string }>(merged: T[], cloud: T[]): T[] {
  const cloudById = new Map(cloud.map((item) => [item.id, item]));
  return merged.filter((item) => {
    const remote = cloudById.get(item.id);
    return !remote || stableStringify(item) !== stableStringify(remote);
  });
}

export function resolveInitialSync(local: FareState, cloud: FareState | null): InitialSyncResolution {
  if (!cloud) {
    return {
      state: local,
      uploadProfile: true,
      uploadTargets: true,
      uploadSettings: true,
      uploadFoods: local.foods,
      uploadMeals: local.meals,
      uploadEntries: local.entries,
    };
  }

  const state = mergeStates(local, cloud);
  return {
    state,
    uploadProfile: stableStringify(state.profile) !== stableStringify(cloud.profile),
    uploadTargets: stableStringify(state.targets) !== stableStringify(cloud.targets),
    uploadSettings: stableStringify(state.settings) !== stableStringify(cloud.settings),
    uploadFoods: uploadCandidates(state.foods, cloud.foods),
    uploadMeals: uploadCandidates(state.meals, cloud.meals),
    uploadEntries: uploadCandidates(state.entries, cloud.entries),
  };
}

export function isCloudSingleton(value: unknown): value is Stamped & Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as Partial<Stamped>).updatedAt === 'string';
}
