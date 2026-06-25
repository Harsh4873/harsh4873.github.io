import { PROGRAM, WEEK_DAYS } from './program';
import type {
  ExerciseDetail,
  ExerciseOrderByDay,
  ExerciseSet,
  LogsByDate,
  Weekday,
  WeightMode,
  WorkoutLog,
} from './types';

export const STORAGE_KEY = 'harsh-gym-logs-v1';
export const EXERCISE_ORDER_STORAGE_KEY = 'harsh-gym-exercise-order-v1';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createEmptyExerciseSet(id = 'set-1'): ExerciseSet {
  return {
    id,
    weightMode: 'bodyweight',
    pounds: '',
    reps: '',
  };
}

export function createEmptyExerciseDetail(): ExerciseDetail {
  return {
    sets: [createEmptyExerciseSet()],
  };
}

function normalizeWeightMode(value: unknown): WeightMode {
  return value === 'pounds' ? 'pounds' : 'bodyweight';
}

function normalizeExerciseSet(value: unknown, fallbackId: string): ExerciseSet {
  if (!isPlainRecord(value)) {
    return createEmptyExerciseSet(fallbackId);
  }

  const weightMode = normalizeWeightMode(value.weightMode);

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : fallbackId,
    weightMode,
    pounds: weightMode === 'pounds' && typeof value.pounds === 'string' ? value.pounds : '',
    reps: typeof value.reps === 'string' ? value.reps : '',
  };
}

function normalizeLegacyDetail(value: Record<string, unknown>): ExerciseDetail {
  const set = normalizeExerciseSet(
    {
      id: 'set-1',
      weightMode: value.weightMode,
      pounds: value.pounds,
      reps: value.reps,
    },
    'set-1',
  );

  return {
    sets: [set],
    legacyNote: typeof value.legacyNote === 'string' ? value.legacyNote : undefined,
  };
}

export function normalizeExerciseDetail(value: unknown): ExerciseDetail {
  if (typeof value === 'string') {
    return {
      ...createEmptyExerciseDetail(),
      legacyNote: value,
    };
  }

  if (!isPlainRecord(value)) {
    return createEmptyExerciseDetail();
  }

  if (!Array.isArray(value.sets)) {
    return normalizeLegacyDetail(value);
  }

  const sets = value.sets.map((set, index) => normalizeExerciseSet(set, `set-${index + 1}`));

  return {
    sets: sets.length > 0 ? sets : [createEmptyExerciseSet()],
    legacyNote: typeof value.legacyNote === 'string' ? value.legacyNote : undefined,
  };
}

function normalizeDetails(details: unknown): WorkoutLog['details'] {
  if (!isPlainRecord(details)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(details).map(([exerciseId, detail]) => [exerciseId, normalizeExerciseDetail(detail)]),
  );
}

export function createEmptyLog(date: string): WorkoutLog {
  return {
    date,
    completed: [],
    skipped: [],
    details: {},
    notes: '',
    prNote: '',
    supersets: [],
    daySkipped: false,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeLog(date: string, log?: Partial<WorkoutLog>): WorkoutLog {
  return {
    ...createEmptyLog(date),
    ...log,
    date,
    completed: Array.isArray(log?.completed) ? log.completed : [],
    skipped: Array.isArray(log?.skipped) ? log.skipped : [],
    details: normalizeDetails(log?.details),
    supersets: Array.isArray(log?.supersets)
      ? log.supersets.filter((pair): pair is WorkoutLog['supersets'][number] => {
          return (
            typeof pair?.id === 'string' &&
            Array.isArray(pair.exerciseIds) &&
            pair.exerciseIds.length === 2 &&
            typeof pair.exerciseIds[0] === 'string' &&
            typeof pair.exerciseIds[1] === 'string'
          );
        })
      : [],
    daySkipped: Boolean(log?.daySkipped),
    updatedAt: typeof log?.updatedAt === 'string' ? log.updatedAt : new Date().toISOString(),
  };
}

function getDefaultExerciseOrder(): ExerciseOrderByDay {
  return WEEK_DAYS.reduce((order, day) => {
    order[day] = PROGRAM[day].map((exercise) => exercise.id);
    return order;
  }, {} as ExerciseOrderByDay);
}

function normalizeDayOrder(day: Weekday, value: unknown): string[] {
  const defaultIds = PROGRAM[day].map((exercise) => exercise.id);
  const validIds = new Set(defaultIds);
  const orderedIds = Array.isArray(value) ? value : [];
  const pickedIds: string[] = [];

  orderedIds.forEach((id) => {
    if (typeof id === 'string' && validIds.has(id) && !pickedIds.includes(id)) {
      pickedIds.push(id);
    }
  });

  return [...pickedIds, ...defaultIds.filter((id) => !pickedIds.includes(id))];
}

export function normalizeExerciseOrder(value: unknown): ExerciseOrderByDay {
  const source = isPlainRecord(value) ? value : {};

  return WEEK_DAYS.reduce((order, day) => {
    order[day] = normalizeDayOrder(day, source[day]);
    return order;
  }, {} as ExerciseOrderByDay);
}

export function loadExerciseOrder(): ExerciseOrderByDay {
  try {
    const raw = window.localStorage.getItem(EXERCISE_ORDER_STORAGE_KEY);
    if (!raw) {
      return getDefaultExerciseOrder();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainRecord(parsed)) {
      return getDefaultExerciseOrder();
    }

    return normalizeExerciseOrder(isPlainRecord(parsed.order) ? parsed.order : parsed);
  } catch {
    return getDefaultExerciseOrder();
  }
}

export function saveExerciseOrder(order: ExerciseOrderByDay): void {
  window.localStorage.setItem(
    EXERCISE_ORDER_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      order: normalizeExerciseOrder(order),
      savedAt: new Date().toISOString(),
    }),
  );
}

export function loadLogs(): LogsByDate {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainRecord(parsed)) {
      return {};
    }

    const source = isPlainRecord(parsed.logs) ? parsed.logs : parsed;
    return Object.fromEntries(
      Object.entries(source).map(([date, log]) => [date, normalizeLog(date, log as Partial<WorkoutLog>)]),
    );
  } catch {
    return {};
  }
}

export function saveLogs(logs: LogsByDate): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      logs,
      savedAt: new Date().toISOString(),
    }),
  );
}
