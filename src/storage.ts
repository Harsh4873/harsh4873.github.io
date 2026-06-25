import type { ExerciseDetail, LogsByDate, WorkoutLog } from './types';

export const STORAGE_KEY = 'harsh-gym-logs-v1';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createEmptyExerciseDetail(): ExerciseDetail {
  return {
    weightMode: 'bodyweight',
    pounds: '',
    reps: '',
  };
}

function normalizeExerciseDetail(value: unknown): ExerciseDetail {
  if (typeof value === 'string') {
    return {
      ...createEmptyExerciseDetail(),
      legacyNote: value,
    };
  }

  if (!isPlainRecord(value)) {
    return createEmptyExerciseDetail();
  }

  return {
    weightMode: value.weightMode === 'pounds' ? 'pounds' : 'bodyweight',
    pounds: typeof value.pounds === 'string' ? value.pounds : '',
    reps: typeof value.reps === 'string' ? value.reps : '',
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
