import type { Habit, HabitEntry, TrackerProfile, TrackerState } from './model';

export const LEGACY_LOCAL_GENERATION_ID = 'local-v1';
export const LEGACY_GENERATION_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export interface CloudUserDocument {
  schemaVersion: 2;
  generationId: string;
  generationUpdatedAt: string;
  profileGenerationId: string;
  profile: TrackerProfile;
  updatedAt: string;
}

export type CloudHabitDocument = Habit & {
  generationId: string;
};

export type CloudEntryDocument = HabitEntry & {
  generationId: string;
  date: string;
  habitId: string;
};

export interface CloudDocument<T> {
  id: string;
  data: T;
}

export interface SerializedTrackerState {
  root: CloudUserDocument;
  habits: Array<CloudDocument<CloudHabitDocument>>;
  entries: Array<CloudDocument<CloudEntryDocument>>;
}

export interface LegacyTrackerStateV1 {
  version: 1;
  profile: Omit<TrackerProfile, 'updatedAt'> & { updatedAt?: string };
  habits: Array<Omit<Habit, 'updatedAt' | 'order'> & { updatedAt?: string; order?: number }>;
  entries: Record<string, Record<string, HabitEntry>>;
}

const STARTER_HABITS = [
  {
    id: 'starter-steps',
    name: '10K steps',
    category: 'Movement',
    icon: 'footprints',
    color: '#b8f35b',
    metric: 'quantity',
    target: 10000,
    unit: 'steps',
    period: 'day',
    direction: 'atLeast',
    schedule: { type: 'everyday' },
    timeSlot: 'anytime',
    increment: 1000,
    order: 0,
  },
  {
    id: 'starter-read',
    name: 'Read',
    category: 'Mind',
    icon: 'book',
    color: '#8d7cff',
    metric: 'duration',
    target: 20,
    unit: 'min',
    period: 'day',
    direction: 'atLeast',
    schedule: { type: 'everyday' },
    timeSlot: 'evening',
    increment: 5,
    order: 1,
  },
  {
    id: 'starter-train',
    name: 'Train',
    category: 'Movement',
    icon: 'dumbbell',
    color: '#ff8e64',
    metric: 'check',
    target: 4,
    unit: 'sessions',
    period: 'week',
    direction: 'atLeast',
    schedule: { type: 'everyday' },
    timeSlot: 'anytime',
    increment: 1,
    order: 2,
  },
  {
    id: 'starter-focus',
    name: 'Deep work',
    category: 'Craft',
    icon: 'brain',
    color: '#58c9d6',
    metric: 'duration',
    target: 90,
    unit: 'min',
    period: 'day',
    direction: 'atLeast',
    schedule: { type: 'selectedDays', days: [1, 2, 3, 4, 5] },
    timeSlot: 'morning',
    increment: 15,
    order: 3,
  },
] as const;

/** Firestore rejects undefined values unless a global compatibility flag is set. */
export function omitUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefinedDeep(item)) as T;
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, omitUndefinedDeep(item)]),
    ) as T;
  }

  return value;
}

function encodeDocumentIdPart(value: string) {
  // encodeURIComponent leaves periods intact. Encoding them too avoids the
  // special path segments "." and ".." while keeping IDs human inspectable.
  return encodeURIComponent(value).replace(/\./g, '%2E');
}

export function habitDocumentId(generationId: string, habitId: string) {
  return `${encodeDocumentIdPart(generationId)}__${encodeDocumentIdPart(habitId)}`;
}

export function entryDocumentId(generationId: string, date: string, habitId: string) {
  return `${encodeDocumentIdPart(generationId)}__${encodeDocumentIdPart(date)}__${encodeDocumentIdPart(habitId)}`;
}

export function serializeRootDocument(state: TrackerState): CloudUserDocument {
  return omitUndefinedDeep({
    schemaVersion: 2,
    generationId: state.generationId,
    generationUpdatedAt: state.generationUpdatedAt,
    profileGenerationId: state.generationId,
    profile: { ...state.profile },
    updatedAt: state.profile.updatedAt,
  });
}

export function serializeHabitDocument(
  habit: Habit,
  generationId: string,
): CloudDocument<CloudHabitDocument> {
  return {
    id: habitDocumentId(generationId, habit.id),
    data: omitUndefinedDeep({ ...habit, generationId }),
  };
}

export function serializeEntryDocument(
  date: string,
  habitId: string,
  entry: HabitEntry,
  generationId: string,
): CloudDocument<CloudEntryDocument> {
  return {
    id: entryDocumentId(generationId, date, habitId),
    data: omitUndefinedDeep({ ...entry, generationId, date, habitId }),
  };
}

export function serializeTrackerState(state: TrackerState): SerializedTrackerState {
  const habits = state.habits.map((habit) => serializeHabitDocument(habit, state.generationId));
  const entries = Object.entries(state.entries).flatMap(([date, dayEntries]) => (
    Object.entries(dayEntries).map(([habitId, entry]) => (
      serializeEntryDocument(date, habitId, entry, state.generationId)
    ))
  ));

  return {
    root: serializeRootDocument(state),
    habits,
    entries,
  };
}

function compareTimestamp(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }

  return compareLexical(left, right);
}

function compareLexical(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareLexical(left, right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export interface SerializedTrackerDelta {
  root?: CloudUserDocument;
  habits: Array<CloudDocument<CloudHabitDocument>>;
  entries: Array<CloudDocument<CloudEntryDocument>>;
}

/** Returns only documents whose merged value is absent from or differs from cloud. */
export function serializeTrackerDelta(cloud: TrackerState, merged: TrackerState): SerializedTrackerDelta {
  if (cloud.generationId !== merged.generationId) {
    throw new Error('Cannot create an incremental delta across generations.');
  }
  const cloudDocuments = serializeTrackerState(cloud);
  const mergedDocuments = serializeTrackerState(merged);
  const cloudHabits = new Map(cloudDocuments.habits.map((document) => [document.id, document.data]));
  const cloudEntries = new Map(cloudDocuments.entries.map((document) => [document.id, document.data]));

  return {
    root: stableStringify(cloudDocuments.root) === stableStringify(mergedDocuments.root)
      ? undefined
      : mergedDocuments.root,
    habits: mergedDocuments.habits.filter((document) => (
      stableStringify(cloudHabits.get(document.id)) !== stableStringify(document.data)
    )),
    entries: mergedDocuments.entries.filter((document) => (
      stableStringify(cloudEntries.get(document.id)) !== stableStringify(document.data)
    )),
  };
}

/**
 * Picks the newest entity. The canonical JSON tie-break makes the result
 * independent of which device was passed as the left or right argument.
 */
export function selectNewerEntity<T extends { updatedAt: string }>(left: T, right: T): T {
  const timestampOrder = compareTimestamp(left.updatedAt, right.updatedAt);
  if (timestampOrder !== 0) return timestampOrder > 0 ? left : right;
  return compareLexical(stableStringify(left), stableStringify(right)) >= 0 ? left : right;
}

function newerTimestamp(left: string, right: string) {
  return compareTimestamp(left, right) >= 0 ? left : right;
}

function sortHabits(habits: Habit[]) {
  return [...habits].sort((left, right) => left.order - right.order || compareLexical(left.id, right.id));
}

export function materializeCloudState(
  root: CloudUserDocument,
  habitDocuments: readonly CloudHabitDocument[],
  entryDocuments: readonly CloudEntryDocument[],
): TrackerState {
  const habitsById = new Map<string, Habit>();

  for (const document of habitDocuments) {
    if (document.generationId !== root.generationId) continue;
    const { generationId: _generationId, ...habit } = document;
    const existing = habitsById.get(habit.id);
    habitsById.set(habit.id, existing ? selectNewerEntity(existing, habit) : habit);
  }

  const entries: TrackerState['entries'] = {};
  for (const document of entryDocuments) {
    if (document.generationId !== root.generationId) continue;
    const { generationId: _generationId, date, habitId, ...entry } = document;
    const existing = entries[date]?.[habitId];
    if (!entries[date]) entries[date] = {};
    entries[date][habitId] = existing ? selectNewerEntity(existing, entry) : entry;
  }

  return {
    version: 2,
    generationId: root.generationId,
    generationUpdatedAt: root.generationUpdatedAt,
    generationPending: false,
    profile: { ...root.profile, updatedAt: root.updatedAt || root.profile.updatedAt },
    habits: sortHabits([...habitsById.values()]),
    entries,
  };
}

function habitMeaningSignature(habit: Habit, baselineUpdatedAt: string) {
  return stableStringify({
    id: habit.id,
    name: habit.name,
    category: habit.category,
    icon: habit.icon,
    color: habit.color,
    metric: habit.metric,
    target: habit.target,
    unit: habit.unit,
    period: habit.period,
    direction: habit.direction,
    schedule: habit.schedule,
    timeSlot: habit.timeSlot,
    increment: habit.increment,
    order: habit.order,
    startDate: habit.updatedAt === baselineUpdatedAt ? undefined : habit.startDate,
    archivedAt: habit.archivedAt,
    pauses: habit.pauses,
  });
}

function localDateFromTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isUntouchedStarterHabit(habit: Habit) {
  const starter = STARTER_HABITS.find((candidate) => candidate.id === habit.id);
  return Boolean(
    starter
    && habit.startDate === localDateFromTimestamp(habit.createdAt)
    && habitMeaningSignature(habit, habit.updatedAt) === stableStringify(starter),
  );
}

export function isDefaultTrackerProfile(profile: TrackerProfile) {
  return profile.displayName === 'Harsh'
    && profile.weekStartsOn === 1
    && profile.theme === 'dark'
    && profile.lastBackupAt === undefined;
}

export function isMeaningfulLocalState(state: TrackerState) {
  const hasEntries = Object.values(state.entries).some((entries) => Object.keys(entries).length > 0);
  if (hasEntries) return true;

  if (
    state.profile.displayName !== 'Harsh'
    || state.profile.weekStartsOn !== 1
    || state.profile.theme !== 'dark'
  ) {
    return true;
  }

  if (state.habits.length !== STARTER_HABITS.length) return true;

  const actualById = new Map(state.habits.map((habit) => [habit.id, habit]));
  return STARTER_HABITS.some((starter) => {
    const actual = actualById.get(starter.id);
    return !actual || habitMeaningSignature(actual, state.profile.updatedAt) !== stableStringify(starter);
  });
}

export function normalizeLegacyV1State(
  state: LegacyTrackerStateV1,
  fallbackUpdatedAt: string,
): TrackerState {
  const profileCandidate: TrackerProfile = {
    ...state.profile,
    updatedAt: state.profile.updatedAt ?? fallbackUpdatedAt,
  };
  return {
    version: 2,
    generationId: LEGACY_LOCAL_GENERATION_ID,
    generationUpdatedAt: LEGACY_GENERATION_UPDATED_AT,
    generationPending: false,
    profile: isDefaultTrackerProfile(profileCandidate)
      ? { ...profileCandidate, updatedAt: LEGACY_GENERATION_UPDATED_AT }
      : profileCandidate,
    habits: state.habits.map((habit, order) => {
      const normalized: Habit = {
        ...habit,
        order: habit.order ?? order,
        updatedAt: habit.updatedAt ?? fallbackUpdatedAt,
      };
      return isUntouchedStarterHabit(normalized)
        ? { ...normalized, updatedAt: LEGACY_GENERATION_UPDATED_AT }
        : normalized;
    }),
    entries: state.entries,
  };
}

function mergeEntries(
  left: TrackerState['entries'],
  right: TrackerState['entries'],
) {
  const merged: TrackerState['entries'] = {};
  const dates = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const date of dates) {
    const habitIds = new Set([
      ...Object.keys(left[date] ?? {}),
      ...Object.keys(right[date] ?? {}),
    ]);

    for (const habitId of habitIds) {
      const leftEntry = left[date]?.[habitId];
      const rightEntry = right[date]?.[habitId];
      const selected = leftEntry && rightEntry
        ? selectNewerEntity(leftEntry, rightEntry)
        : (leftEntry ?? rightEntry);
      if (!selected) continue;
      if (!merged[date]) merged[date] = {};
      merged[date][habitId] = selected;
    }
  }

  return merged;
}

export function mergeSameGeneration(left: TrackerState, right: TrackerState): TrackerState {
  if (left.generationId !== right.generationId) {
    throw new Error('Cannot merge tracker states from different generations.');
  }

  const habitsById = new Map<string, Habit>();
  for (const habit of [...left.habits, ...right.habits]) {
    const existing = habitsById.get(habit.id);
    habitsById.set(habit.id, existing ? selectNewerEntity(existing, habit) : habit);
  }

  return {
    version: 2,
    generationId: left.generationId,
    generationUpdatedAt: newerTimestamp(left.generationUpdatedAt, right.generationUpdatedAt),
    generationPending: left.generationPending || right.generationPending,
    profile: selectNewerEntity(left.profile, right.profile),
    habits: sortHabits([...habitsById.values()]),
    entries: mergeEntries(left.entries, right.entries),
  };
}

export function adoptGeneration(
  state: TrackerState,
  generationId: string,
  generationUpdatedAt: string,
  generationPending = state.generationPending,
): TrackerState {
  return {
    ...state,
    generationId,
    generationUpdatedAt,
    generationPending,
  };
}

export function createReplacementGeneration(
  state: TrackerState,
  generationId: string,
  updatedAt: string,
): TrackerState {
  return {
    ...state,
    generationId,
    generationUpdatedAt: updatedAt,
    generationPending: true,
    profile: { ...state.profile, updatedAt },
    habits: state.habits.map((habit, order) => ({ ...habit, order, updatedAt })),
  };
}

export type InitialSyncResolution = {
  mode:
    | 'upload-local'
    | 'hydrate-cloud'
    | 'merge'
    | 'accept-local-generation'
    | 'accept-cloud-generation';
  state: TrackerState;
  shouldWriteCloud: boolean;
};

interface InitialSyncOptions {
  firstUploadGenerationId?: string;
  now?: string;
}

/**
 * Resolves first contact with Firestore. A legacy local generation is allowed
 * to merge once; two real, different generations are never entity-merged.
 */
export function resolveInitialSync(
  local: TrackerState,
  cloud: TrackerState | null,
  options: InitialSyncOptions = {},
): InitialSyncResolution {
  if (!cloud) {
    if (local.generationId === LEGACY_LOCAL_GENERATION_ID && options.firstUploadGenerationId) {
      return {
        mode: 'upload-local',
        state: adoptGeneration(
          local,
          options.firstUploadGenerationId,
          options.now ?? new Date().toISOString(),
          true,
        ),
        shouldWriteCloud: true,
      };
    }

    return { mode: 'upload-local', state: local, shouldWriteCloud: true };
  }

  if (local.generationId === LEGACY_LOCAL_GENERATION_ID) {
    if (!isMeaningfulLocalState(local)) {
      return { mode: 'hydrate-cloud', state: cloud, shouldWriteCloud: false };
    }

    const adopted = adoptGeneration(local, cloud.generationId, cloud.generationUpdatedAt, false);
    return {
      mode: 'merge',
      state: { ...mergeSameGeneration(adopted, cloud), generationPending: false },
      shouldWriteCloud: true,
    };
  }

  if (local.generationId === cloud.generationId) {
    if (!isMeaningfulLocalState(local)) {
      return { mode: 'hydrate-cloud', state: cloud, shouldWriteCloud: false };
    }

    return {
      mode: 'merge',
      state: { ...mergeSameGeneration(local, cloud), generationPending: false },
      shouldWriteCloud: true,
    };
  }

  if (local.generationPending) {
    return {
      mode: 'accept-local-generation',
      state: local,
      shouldWriteCloud: true,
    };
  }

  return {
    mode: 'accept-cloud-generation',
    state: cloud,
    shouldWriteCloud: false,
  };
}
