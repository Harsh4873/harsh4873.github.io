import {
  Activity,
  ArrowDown,
  ArrowUp,
  Ban,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Dumbbell,
  ExternalLink,
  Flame,
  GripVertical,
  Headphones,
  Link2,
  ListChecks,
  Medal,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Settings,
  Smartphone,
  Sparkles,
  Sun,
  Target,
  Timer,
  Trophy,
  X,
} from 'lucide-react';
import type { ComponentType, CSSProperties, Dispatch, DragEvent, SetStateAction, SVGProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  endOfMonth,
  formatDateLabel,
  formatMonth,
  formatShortDate,
  getExercisesForDate,
  getWeekday,
  parseDateKey,
  startOfMonth,
  startOfWeek,
  toDateKey,
} from './dateUtils';
import { getBasketballMinutes, isStretchExercise, WEEK_DAYS } from './program';
import {
  createEmptyExerciseDetail,
  createEmptyExerciseSet,
  createEmptyLog,
  loadLogs,
  normalizeLog,
  loadProgram,
  saveLogs,
  saveProgram,
} from './storage';
import type {
  DayStatus,
  Exercise,
  ExerciseSet,
  LogsByDate,
  ProgramByDay,
  SupersetPair,
  TabId,
  ThemeMode,
  Weekday,
  WeightMode,
  WorkoutLog,
} from './types';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const THEME_STORAGE_KEY = 'harsh-gym-theme-v1';
const MOBILE_PREVIEW_STORAGE_KEY = 'harsh-gym-mobile-preview-v1';
const REP_OPTIONS = Array.from({ length: 20 }, (_, index) => String(index + 1));

type GetExercisesForDate = (dateKey: string) => Exercise[];

interface ExerciseGroup {
  id: string;
  type: 'single' | 'superset';
  exercises: Exercise[];
  supersetId?: string;
}

const TABS: Array<{ id: TabId; label: string; icon: IconType }> = [
  { id: 'today', label: 'Today', icon: Activity },
  { id: 'logbook', label: 'Logbook', icon: BookOpen },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'week', label: 'Week', icon: ListChecks },
  { id: 'milestones', label: 'Progress', icon: Trophy },
  { id: 'settings', label: 'Settings', icon: Settings },
];
const BOTTOM_TABS = TABS;

const STATUS_LABELS: Record<DayStatus, string> = {
  completed: 'Completed',
  partial: 'Partial',
  skipped: 'Skipped',
  future: 'Future',
};

function getStoredTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredMobilePreview(): boolean {
  return window.localStorage.getItem(MOBILE_PREVIEW_STORAGE_KEY) === 'mobile';
}

function createSetId(): string {
  return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function uniqueList(items: string[]): string[] {
  return Array.from(new Set(items));
}

function touchLog(log: WorkoutLog): WorkoutLog {
  return { ...log, updatedAt: new Date().toISOString() };
}

function applyExerciseOrder(exercises: Exercise[], orderedIds: string[]): Exercise[] {
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const orderedExercises = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Exercise[];
  const orderedSet = new Set(orderedExercises.map((exercise) => exercise.id));

  return [...orderedExercises, ...exercises.filter((exercise) => !orderedSet.has(exercise.id))];
}

function getProgramExercisesForDate(dateKey: string, program: ProgramByDay): Exercise[] {
  const day = getWeekday(parseDateKey(dateKey));
  return program[day];
}

function createWorkoutId(day: Weekday): string {
  return `${day.toLowerCase()}-custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function countCompleted(exercises: Exercise[], log: WorkoutLog): number {
  const ids = new Set(exercises.map((exercise) => exercise.id));
  return log.completed.filter((id) => ids.has(id)).length;
}

function hasLogActivity(log: WorkoutLog): boolean {
  return (
    log.completed.length > 0 ||
    log.skipped.length > 0 ||
    log.supersets.length > 0 ||
    Boolean(log.notes.trim()) ||
    Boolean(log.prNote.trim()) ||
    Object.values(log.details).some((detail) => {
      return Boolean(
        detail.legacyNote?.trim() ||
          detail.sets.some((set) => {
            return Boolean(set.reps.trim() || set.pounds.trim());
          }),
      );
    })
  );
}

function getDayStatus(dateKey: string, log: WorkoutLog, todayKey: string, exercises = getExercisesForDate(dateKey)): DayStatus {
  const completed = countCompleted(exercises, log);

  if (dateKey > todayKey) {
    return 'future';
  }

  if (log.daySkipped) {
    return 'skipped';
  }

  if (completed === exercises.length && exercises.length > 0) {
    return 'completed';
  }

  if (completed > 0 || hasLogActivity(log)) {
    return 'partial';
  }

  return dateKey < todayKey ? 'skipped' : 'partial';
}

function buildExerciseGroups(exercises: Exercise[], supersets: SupersetPair[]): ExerciseGroup[] {
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const supersetByExerciseId = new Map<string, SupersetPair>();
  const used = new Set<string>();
  const groups: ExerciseGroup[] = [];

  supersets.forEach((superset) => {
    const pairExists = superset.exerciseIds.every((id) => byId.has(id));
    if (!pairExists) {
      return;
    }

    superset.exerciseIds.forEach((id) => supersetByExerciseId.set(id, superset));
  });

  exercises.forEach((exercise) => {
    if (used.has(exercise.id)) {
      return;
    }

    const superset = supersetByExerciseId.get(exercise.id);
    if (superset) {
      const pair = exercises.filter((candidate) => superset.exerciseIds.includes(candidate.id));
      if (pair.length === 2 && pair.every((pairedExercise) => !used.has(pairedExercise.id))) {
        pair.forEach((pairedExercise) => used.add(pairedExercise.id));
        groups.push({
          id: superset.id,
          type: 'superset',
          exercises: pair,
          supersetId: superset.id,
        });
        return;
      }
    }

    used.add(exercise.id);
    groups.push({
      id: exercise.id,
      type: 'single',
      exercises: [exercise],
    });
  });

  return groups;
}

function getProgressMeta(exercises: Exercise[], log: WorkoutLog) {
  const completed = countCompleted(exercises, log);
  const skipped = log.skipped.filter((id) => exercises.some((exercise) => exercise.id === id)).length;
  const total = exercises.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { completed, skipped, total, percent };
}

function getSupersetExerciseCount(log: WorkoutLog): number {
  return log.supersets.reduce((total, superset) => total + superset.exerciseIds.length, 0);
}

function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function exerciseNamesMatch(leftName: string | undefined, rightName: string): boolean {
  if (!leftName?.trim() || !rightName.trim()) {
    return false;
  }

  return normalizeExerciseName(leftName) === normalizeExerciseName(rightName);
}

function isSetFilled(set: ExerciseSet): boolean {
  return Boolean(set.reps.trim() || (set.weightMode === 'pounds' && set.pounds.trim()));
}

function isExerciseDetailEmpty(detail?: ReturnType<typeof createEmptyExerciseDetail>): boolean {
  if (!detail) {
    return true;
  }

  return !detail.cardioMinutes?.trim() && !detail.legacyNote?.trim() && detail.sets.every((set) => !isSetFilled(set));
}

function getExerciseKind(exerciseName: string): 'cardio' | 'stretch' | 'strength' {
  if (/basketball/i.test(exerciseName) || getBasketballMinutes(exerciseName) > 0) {
    return 'cardio';
  }

  if (isStretchExercise(exerciseName)) {
    return 'stretch';
  }

  return 'strength';
}

function formatSetSummary(sets: ExerciseSet[], kind: 'stretch' | 'strength' = 'strength'): string {
  const filledSets = sets.filter(isSetFilled);
  if (filledSets.length === 0) {
    return '';
  }

  const summary = filledSets.slice(0, 3).map((set) => {
    const reps = set.reps.trim();
    if (kind === 'stretch') {
      return reps ? `${reps} reps` : 'Done';
    }

    if (set.weightMode === 'pounds' && set.pounds.trim()) {
      return reps ? `${set.pounds.trim()} x ${reps}` : `${set.pounds.trim()} lb`;
    }

    return reps ? `BW x ${reps}` : 'Body weight';
  });

  const remaining = filledSets.length - summary.length;
  return `${summary.join(', ')}${remaining > 0 ? ` +${remaining}` : ''}`;
}

function getSetVolume(set: ExerciseSet): number {
  const reps = Number(set.reps);
  const pounds = Number(set.pounds);
  if (!Number.isFinite(reps) || reps <= 0) {
    return 0;
  }

  if (set.weightMode !== 'pounds' || !Number.isFinite(pounds) || pounds <= 0) {
    return 0;
  }

  return pounds * reps;
}

function getSetReps(set: ExerciseSet): number {
  const reps = Number(set.reps);
  return Number.isFinite(reps) && reps > 0 ? reps : 0;
}

function getLogSetCount(log: WorkoutLog): number {
  return Object.values(log.details).reduce((total, detail) => total + detail.sets.filter(isSetFilled).length, 0);
}

function getLoggedCardioMinutes(detail?: ReturnType<typeof createEmptyExerciseDetail>): number {
  if (!detail?.cardioMinutes?.trim()) {
    return 0;
  }

  const minutes = Number(detail.cardioMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function getLogReps(log: WorkoutLog): number {
  return Object.values(log.details).reduce((total, detail) => {
    return total + detail.sets.reduce((setTotal, set) => setTotal + getSetReps(set), 0);
  }, 0);
}

function getLogVolume(log: WorkoutLog): number {
  return Object.values(log.details).reduce((total, detail) => {
    return total + detail.sets.reduce((setTotal, set) => setTotal + getSetVolume(set), 0);
  }, 0);
}

function getCompletedBasketballMinutes(exercises: Exercise[], log: WorkoutLog): number {
  return exercises.reduce((total, exercise) => {
    if (!log.completed.includes(exercise.id) || getExerciseKind(exercise.name) !== 'cardio') {
      return total;
    }

    const loggedMinutes = getLoggedCardioMinutes(log.details[exercise.id]);
    return total + (loggedMinutes || getBasketballMinutes(exercise.name));
  }, 0);
}

function findPreviousExerciseDetail(
  exercise: Exercise,
  dateKey: string,
  logs: LogsByDate,
) {
  const previousDates = Object.keys(logs)
    .filter((logDate) => logDate < dateKey)
    .sort((a, b) => b.localeCompare(a));

  for (const previousDate of previousDates) {
    const previousLog = normalizeLog(previousDate, logs[previousDate]);
    const detail = Object.values(previousLog.details).find((candidate) => {
      return exerciseNamesMatch(candidate.exerciseName, exercise.name) && !isExerciseDetailEmpty(candidate);
    });
    if (detail && !isExerciseDetailEmpty(detail)) {
      return { dateKey: previousDate, detail };
    }
  }

  return null;
}

function getExercisePreviousBest(
  exercise: Exercise,
  dateKey: string,
  logs: LogsByDate,
): number {
  return Object.keys(logs).reduce((best, logDate) => {
    if (logDate >= dateKey) {
      return best;
    }

    const previousLog = normalizeLog(logDate, logs[logDate]);
    const matchingDetails = Object.values(previousLog.details).filter((detail) =>
      exerciseNamesMatch(detail.exerciseName, exercise.name),
    );
    return Math.max(best, ...matchingDetails.flatMap((detail) => detail.sets.map(getSetVolume)));
  }, 0);
}

function buildTrainingStats(logs: LogsByDate, todayKey: string, getExercises: GetExercisesForDate) {
  const recentDates = buildRecentDates(todayKey, 28).reverse();
  const weekDates = buildRecentDates(todayKey, 7).reverse();
  let completedSessions = 0;
  let basketballMinutes = 0;
  let stretchDays = 0;
  let totalReps = 0;
  let totalVolume = 0;
  const prNotes: Array<{ dateKey: string; note: string }> = [];
  const weeklyTrend = weekDates.map((dateKey) => {
    const log = normalizeLog(dateKey, logs[dateKey]);
    const exercises = getExercises(dateKey);
    const progress = getProgressMeta(exercises, log);
    const volume = getLogVolume(log);
    const reps = getLogReps(log);

    if (progress.completed === progress.total && progress.total > 0) {
      completedSessions += 1;
    }

    basketballMinutes += getCompletedBasketballMinutes(exercises, log);
    totalReps += reps;
    totalVolume += volume;

    if (exercises.some((exercise) => log.completed.includes(exercise.id) && isStretchExercise(exercise.name))) {
      stretchDays += 1;
    }

    if (log.prNote.trim()) {
      prNotes.push({ dateKey, note: log.prNote.trim() });
    }

    return { dateKey, volume, reps, completed: progress.completed, total: progress.total };
  });

  recentDates.slice(0, -7).forEach((dateKey) => {
    const log = normalizeLog(dateKey, logs[dateKey]);
    const exercises = getExercises(dateKey);
    const progress = getProgressMeta(exercises, log);
    if (progress.completed === progress.total && progress.total > 0) {
      completedSessions += 1;
    }
    basketballMinutes += getCompletedBasketballMinutes(exercises, log);
    totalReps += getLogReps(log);
    totalVolume += getLogVolume(log);
    if (exercises.some((exercise) => log.completed.includes(exercise.id) && isStretchExercise(exercise.name))) {
      stretchDays += 1;
    }
    if (log.prNote.trim()) {
      prNotes.push({ dateKey, note: log.prNote.trim() });
    }
  });

  let streak = 0;
  for (const dateKey of buildRecentDates(todayKey, 90)) {
    const log = normalizeLog(dateKey, logs[dateKey]);
    const exercises = getExercises(dateKey);
    const progress = getProgressMeta(exercises, log);
    if (progress.completed === progress.total && progress.total > 0) {
      streak += 1;
    } else {
      break;
    }
  }

  return {
    basketballMinutes,
    completedSessions,
    prNotes,
    streak,
    stretchDays,
    totalReps,
    totalVolume,
    weeklyTrend,
  };
}

function MetricTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: IconType;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <article className="metric-tile" style={{ '--metric-accent': accent } as CSSProperties}>
      <div className="metric-icon">
        <Icon aria-hidden="true" />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: IconType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`tab-button ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function StatusPill({ status }: { status: DayStatus }) {
  return <span className={`status-pill ${status}`}>{STATUS_LABELS[status]}</span>;
}

function ModeToggle({
  active,
  activeIcon: ActiveIcon,
  inactiveIcon: InactiveIcon,
  activeLabel,
  inactiveLabel,
  onClick,
  ariaLabel,
}: {
  active: boolean;
  activeIcon: IconType;
  inactiveIcon: IconType;
  activeLabel: string;
  inactiveLabel: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  const Icon = active ? ActiveIcon : InactiveIcon;

  return (
    <button className={`mode-toggle ${active ? 'active' : ''}`} type="button" onClick={onClick} aria-label={ariaLabel} aria-pressed={active}>
      <Icon aria-hidden="true" />
      <span className="mode-toggle-track">
        <span />
      </span>
      <strong>{active ? activeLabel : inactiveLabel}</strong>
    </button>
  );
}

function AppChrome({
  currentProgress,
  theme,
  mobilePreview,
  onThemeToggle,
  onMobilePreviewToggle,
}: {
  currentProgress: ReturnType<typeof getProgressMeta>;
  theme: ThemeMode;
  mobilePreview: boolean;
  onThemeToggle: () => void;
  onMobilePreviewToggle: () => void;
}) {
  return (
    <header className="app-chrome">
      <div className="chrome-brand">
        <span className="chrome-mark">
          <Dumbbell aria-hidden="true" />
        </span>
        <div>
          <strong>Gym</strong>
          <span>Local training ledger</span>
        </div>
      </div>
      <div className="chrome-status">
        <span>{currentProgress.completed}/{currentProgress.total}</span>
        <strong>{currentProgress.percent}%</strong>
      </div>
      <div className="chrome-controls">
        <ModeToggle
          active={theme === 'light'}
          activeIcon={Sun}
          inactiveIcon={Moon}
          activeLabel="Light"
          inactiveLabel="Dark"
          onClick={onThemeToggle}
          ariaLabel="Toggle theme"
        />
        <ModeToggle
          active={mobilePreview}
          activeIcon={Smartphone}
          inactiveIcon={Monitor}
          activeLabel="Mobile"
          inactiveLabel="Desktop"
          onClick={onMobilePreviewToggle}
          ariaLabel="Toggle mobile view"
        />
      </div>
    </header>
  );
}

function WorkoutPanel({
  dateKey,
  exercises,
  log,
  logs,
  todayKey,
  getExercises,
  onReorder,
  onUpdate,
  onClear,
}: {
  dateKey: string;
  exercises: Exercise[];
  log: WorkoutLog;
  logs: LogsByDate;
  todayKey: string;
  getExercises: GetExercisesForDate;
  onReorder: (exerciseIds: string[]) => void;
  onUpdate: (updater: (log: WorkoutLog) => WorkoutLog) => void;
  onClear: () => void;
}) {
  const [firstSupersetId, setFirstSupersetId] = useState(exercises[0]?.id ?? '');
  const [secondSupersetId, setSecondSupersetId] = useState(exercises[1]?.id ?? '');
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [restSeconds, setRestSeconds] = useState(0);
  const exerciseOrderSignature = exercises.map((exercise) => exercise.id).join('|');
  const progress = getProgressMeta(exercises, log);
  const status = getDayStatus(dateKey, log, todayKey, exercises);
  const supersetExerciseCount = getSupersetExerciseCount(log);
  const loggedSets = getLogSetCount(log);
  const sessionVolume = getLogVolume(log);
  const pairedIds = new Set(log.supersets.flatMap((pair) => pair.exerciseIds));
  const unpairedExercises = exercises.filter((exercise) => !pairedIds.has(exercise.id));
  const groups = buildExerciseGroups(exercises, log.supersets);
  const previousByExerciseId = useMemo(() => {
    return new Map(
      exercises.map((exercise) => [exercise.id, findPreviousExerciseDetail(exercise, dateKey, logs)]),
    );
  }, [dateKey, exerciseOrderSignature, logs]);
  const previousBestByExerciseId = useMemo(() => {
    return new Map(
      exercises.map((exercise) => [exercise.id, getExercisePreviousBest(exercise, dateKey, logs)]),
    );
  }, [dateKey, exerciseOrderSignature, logs]);

  useEffect(() => {
    const available = exercises.filter((exercise) => !pairedIds.has(exercise.id));
    setFirstSupersetId(available[0]?.id ?? '');
    setSecondSupersetId(available[1]?.id ?? '');
  }, [dateKey, exerciseOrderSignature, log.supersets.length]);

  useEffect(() => {
    if (restSeconds <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setRestSeconds((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [restSeconds]);

  const canAddSuperset =
    firstSupersetId &&
    secondSupersetId &&
    firstSupersetId !== secondSupersetId &&
    !pairedIds.has(firstSupersetId) &&
    !pairedIds.has(secondSupersetId);

  const getExerciseName = (exerciseId: string) => exercises.find((exercise) => exercise.id === exerciseId)?.name ?? '';

  const toggleComplete = (exerciseId: string) => {
    const wasCompleted = log.completed.includes(exerciseId);
    if (!wasCompleted) {
      setRestSeconds(90);
    }

    onUpdate((current) => {
      const exercise = exercises.find((candidate) => candidate.id === exerciseId);
      const isCardio = exercise ? getExerciseKind(exercise.name) === 'cardio' : false;
      const completed = current.completed.includes(exerciseId)
        ? current.completed.filter((id) => id !== exerciseId)
        : uniqueList([...current.completed, exerciseId]);
      const currentDetail = current.details[exerciseId] ?? createEmptyExerciseDetail();
      const nextDetails = isCardio
        ? {
            ...current.details,
            [exerciseId]: {
              ...currentDetail,
              exerciseName: exercise?.name ?? currentDetail.exerciseName,
              cardioMinutes: completed.includes(exerciseId)
                ? currentDetail.cardioMinutes || String(Math.max(getBasketballMinutes(exercise?.name ?? ''), 60))
                : '0',
            },
          }
        : current.details;

      return touchLog({
        ...current,
        completed,
        skipped: current.skipped.filter((id) => id !== exerciseId),
        details: nextDetails,
        daySkipped: false,
      });
    });
  };

  const useLastSets = (exerciseId: string) => {
    const previous = previousByExerciseId.get(exerciseId);
    if (!previous) {
      return;
    }

    onUpdate((current) => {
      const currentDetail = current.details[exerciseId] ?? createEmptyExerciseDetail();
      if (!isExerciseDetailEmpty(currentDetail)) {
        return current;
      }

      return touchLog({
        ...current,
        details: {
          ...current.details,
          [exerciseId]: {
            ...currentDetail,
            exerciseName: getExerciseName(exerciseId),
            cardioMinutes: previous.detail.cardioMinutes,
            sets: previous.detail.sets.map((set) => ({
              ...set,
              id: createSetId(),
            })),
          },
        },
        daySkipped: false,
      });
    });
  };

  const updateCardioMinutes = (exerciseId: string, minutes: string) => {
    onUpdate((current) => {
      const currentDetail = current.details[exerciseId] ?? createEmptyExerciseDetail();
      const completed =
        Number(minutes) > 0 ? uniqueList([...current.completed, exerciseId]) : current.completed.filter((id) => id !== exerciseId);

      return touchLog({
        ...current,
        completed,
        skipped: current.skipped.filter((id) => id !== exerciseId),
        details: {
          ...current.details,
          [exerciseId]: {
            ...currentDetail,
            exerciseName: getExerciseName(exerciseId),
            cardioMinutes: minutes,
          },
        },
        daySkipped: false,
      });
    });
  };

  const toggleSkip = (exerciseId: string) => {
    onUpdate((current) => {
      const skipped = current.skipped.includes(exerciseId)
        ? current.skipped.filter((id) => id !== exerciseId)
        : uniqueList([...current.skipped, exerciseId]);

      return touchLog({
        ...current,
        skipped,
        completed: current.completed.filter((id) => id !== exerciseId),
        daySkipped: false,
      });
    });
  };

  const updateExerciseSet = (exerciseId: string, setId: string, setPatch: Partial<ExerciseSet>) => {
    onUpdate((current) => {
      const currentDetail = current.details[exerciseId] ?? createEmptyExerciseDetail();
      const nextSets = currentDetail.sets.map((set) => {
        if (set.id !== setId) {
          return set;
        }

        const nextSet: ExerciseSet = {
          ...set,
          ...setPatch,
        };

        return {
          ...nextSet,
          pounds: nextSet.weightMode === 'bodyweight' ? '' : nextSet.pounds,
        };
      });

      return touchLog({
        ...current,
        details: {
          ...current.details,
          [exerciseId]: {
            ...currentDetail,
            exerciseName: getExerciseName(exerciseId),
            sets: nextSets,
          },
        },
        daySkipped: false,
      });
    });
  };

  const addExerciseSet = (exerciseId: string) => {
    onUpdate((current) => {
      const currentDetail = current.details[exerciseId] ?? createEmptyExerciseDetail();
      const previousSet = currentDetail.sets[currentDetail.sets.length - 1];
      const nextSet = {
        ...createEmptyExerciseSet(createSetId()),
        weightMode: previousSet?.weightMode ?? 'bodyweight',
        pounds: previousSet?.weightMode === 'pounds' ? previousSet.pounds : '',
      };

      return touchLog({
        ...current,
        details: {
          ...current.details,
          [exerciseId]: {
            ...currentDetail,
            exerciseName: getExerciseName(exerciseId),
            sets: [...currentDetail.sets, nextSet],
          },
        },
        daySkipped: false,
      });
    });
  };

  const removeExerciseSet = (exerciseId: string, setId: string) => {
    onUpdate((current) => {
      const currentDetail = current.details[exerciseId] ?? createEmptyExerciseDetail();
      if (currentDetail.sets.length <= 1) {
        return current;
      }

      return touchLog({
        ...current,
        details: {
          ...current.details,
          [exerciseId]: {
            ...currentDetail,
            exerciseName: getExerciseName(exerciseId),
            sets: currentDetail.sets.filter((set) => set.id !== setId),
          },
        },
        daySkipped: false,
      });
    });
  };

  const reorderGroups = (nextGroups: ExerciseGroup[]) => {
    onReorder(nextGroups.flatMap((group) => group.exercises.map((exercise) => exercise.id)));
  };

  const moveGroup = (groupId: string, direction: -1 | 1) => {
    const currentIndex = groups.findIndex((group) => group.id === groupId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= groups.length) {
      return;
    }

    const nextGroups = [...groups];
    [nextGroups[currentIndex], nextGroups[nextIndex]] = [nextGroups[nextIndex], nextGroups[currentIndex]];
    reorderGroups(nextGroups);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, groupId: string) => {
    setDraggedGroupId(groupId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', groupId);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, targetGroupId: string) => {
    const sourceGroupId = draggedGroupId || event.dataTransfer.getData('text/plain');
    if (!sourceGroupId || sourceGroupId === targetGroupId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverGroupId(targetGroupId);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, targetGroupId: string) => {
    event.preventDefault();
    const sourceGroupId = draggedGroupId || event.dataTransfer.getData('text/plain');
    setDraggedGroupId(null);
    setDragOverGroupId(null);

    if (!sourceGroupId || sourceGroupId === targetGroupId) {
      return;
    }

    const sourceIndex = groups.findIndex((group) => group.id === sourceGroupId);
    const targetIndex = groups.findIndex((group) => group.id === targetGroupId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextGroups = [...groups];
    const [movedGroup] = nextGroups.splice(sourceIndex, 1);
    nextGroups.splice(targetIndex, 0, movedGroup);
    reorderGroups(nextGroups);
  };

  const addSuperset = () => {
    if (!canAddSuperset) {
      return;
    }

    onUpdate((current) =>
      touchLog({
        ...current,
        supersets: [
          ...current.supersets,
          {
            id: `${firstSupersetId}-${secondSupersetId}-${Date.now()}`,
            exerciseIds: [firstSupersetId, secondSupersetId],
          },
        ],
        daySkipped: false,
      }),
    );
  };

  const removeSuperset = (supersetId: string) => {
    onUpdate((current) =>
      touchLog({
        ...current,
        supersets: current.supersets.filter((superset) => superset.id !== supersetId),
      }),
    );
  };

  const completeAll = () => {
    onUpdate((current) =>
      touchLog({
        ...current,
        completed: exercises.map((exercise) => exercise.id),
        skipped: [],
        daySkipped: false,
      }),
    );
  };

  const skipDay = () => {
    onUpdate((current) =>
      touchLog({
        ...current,
        completed: [],
        skipped: exercises.map((exercise) => exercise.id),
        daySkipped: true,
      }),
    );
  };

  return (
    <section className="workout-stage" aria-label={`${formatDateLabel(dateKey)} workout`}>
      <div className="workout-banner">
        <div>
          <p className="eyebrow">{formatDateLabel(dateKey)}</p>
          <h2>{progress.completed}/{progress.total} logged</h2>
          <div className="banner-chips">
            <StatusPill status={status} />
            <span>{log.supersets.length} supersets</span>
            <span>{supersetExerciseCount} paired</span>
            <span>{loggedSets} sets</span>
            <span>{sessionVolume.toLocaleString()} lb</span>
            {restSeconds > 0 && (
              <span className="rest-chip">
                Rest {Math.floor(restSeconds / 60)}:{String(restSeconds % 60).padStart(2, '0')}
              </span>
            )}
          </div>
        </div>
        <div className="progress-orb" style={{ '--progress': `${progress.percent}%` } as CSSProperties}>
          <strong>{progress.percent}%</strong>
          <span>{progress.skipped} skipped</span>
        </div>
      </div>

      <div className="action-row">
        <button className="icon-text-button primary" type="button" onClick={completeAll}>
          <Check aria-hidden="true" />
          <span>Finish Workout</span>
        </button>
        <button className="icon-text-button" type="button" onClick={skipDay}>
          <Ban aria-hidden="true" />
          <span>Skip Day</span>
        </button>
        <button className="icon-only-button" type="button" onClick={onClear} aria-label="Clear day">
          <RotateCcw aria-hidden="true" />
        </button>
      </div>

      <section className="superset-builder" aria-label="Superset">
        <div className="section-title">
          <Link2 aria-hidden="true" />
          <h3>Superset</h3>
        </div>
        <div className="superset-controls">
          <select
            value={firstSupersetId}
            onChange={(event) => setFirstSupersetId(event.target.value)}
            disabled={unpairedExercises.length < 2}
          >
            {unpairedExercises.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </option>
            ))}
          </select>
          <select
            value={secondSupersetId}
            onChange={(event) => setSecondSupersetId(event.target.value)}
            disabled={unpairedExercises.length < 2}
          >
            {unpairedExercises
              .filter((exercise) => exercise.id !== firstSupersetId)
              .map((exercise) => (
                <option key={exercise.id} value={exercise.id}>
                  {exercise.name}
                </option>
              ))}
          </select>
          <button className="icon-text-button compact" type="button" onClick={addSuperset} disabled={!canAddSuperset}>
            <Plus aria-hidden="true" />
            <span>Add</span>
          </button>
        </div>
      </section>

      <div className="exercise-stack">
        {groups.map((group, groupIndex) => {
          const groupLabel =
            group.type === 'superset'
              ? `superset with ${group.exercises.map((exercise) => exercise.name).join(' and ')}`
              : group.exercises[0]?.name ?? 'exercise';

          return (
            <article
              key={group.id}
              className={`exercise-group ${group.type} ${draggedGroupId === group.id ? 'dragging' : ''} ${
                dragOverGroupId === group.id ? 'drop-target' : ''
              }`}
              onDragOver={(event) => handleDragOver(event, group.id)}
              onDrop={(event) => handleDrop(event, group.id)}
            >
              {group.type === 'superset' && (
                <div className="group-header">
                  <span>
                    <Link2 aria-hidden="true" />
                    Superset
                  </span>
                  <button
                    className="icon-only-button small"
                    type="button"
                    aria-label="Remove superset"
                    onClick={() => group.supersetId && removeSuperset(group.supersetId)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="exercise-group-body">
                <div className="group-move-controls">
                  <button
                    className="drag-button"
                    type="button"
                    draggable
                    aria-label={`Drag ${groupLabel} to reorder`}
                    onDragStart={(event) => handleDragStart(event, group.id)}
                    onDragEnd={() => {
                      setDraggedGroupId(null);
                      setDragOverGroupId(null);
                    }}
                  >
                    <GripVertical aria-hidden="true" />
                  </button>
                  <div className="move-pair">
                    <button
                      className="move-mini-button"
                      type="button"
                      aria-label={`Move ${groupLabel} up`}
                      onClick={() => moveGroup(group.id, -1)}
                      disabled={groupIndex === 0}
                    >
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button
                      className="move-mini-button"
                      type="button"
                      aria-label={`Move ${groupLabel} down`}
                      onClick={() => moveGroup(group.id, 1)}
                      disabled={groupIndex === groups.length - 1}
                    >
                      <ArrowDown aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="group-exercise-list">
                  {group.exercises.map((exercise) => {
                    const completed = log.completed.includes(exercise.id);
                    const skipped = log.skipped.includes(exercise.id);
                    const detail = log.details[exercise.id] ?? createEmptyExerciseDetail();
                    const exerciseKind = getExerciseKind(exercise.name);
                    const isCardio = exerciseKind === 'cardio';
                    const isStretch = exerciseKind === 'stretch';
                    const previous = previousByExerciseId.get(exercise.id);
                    const previousMinutes = getLoggedCardioMinutes(previous?.detail);
                    const lastSummary = isCardio
                      ? previousMinutes > 0
                        ? `${previousMinutes} min`
                        : ''
                      : previous
                        ? formatSetSummary(previous.detail.sets, isStretch ? 'stretch' : 'strength')
                        : '';
                    const currentMinutes = getLoggedCardioMinutes(detail);
                    const currentSummary = isCardio
                      ? currentMinutes > 0
                        ? `${currentMinutes} minutes`
                        : ''
                      : formatSetSummary(detail.sets, isStretch ? 'stretch' : 'strength');
                    const previousBest = previousBestByExerciseId.get(exercise.id) ?? 0;
                    const currentBest = Math.max(0, ...detail.sets.map(getSetVolume));
                    const hasLocalPr = exerciseKind === 'strength' && currentBest > 0 && currentBest > previousBest;
                    const canUseLastSets = Boolean(previous && isExerciseDetailEmpty(detail));
                    const cardioTarget = Math.max(getBasketballMinutes(exercise.name), 60);

                    return (
                      <div
                        key={exercise.id}
                        className={`exercise-row ${completed ? 'done' : ''} ${skipped ? 'skipped' : ''}`}
                      >
                        <button
                          className="check-button"
                          type="button"
                          aria-label={`Toggle ${exercise.name}`}
                          onClick={() => toggleComplete(exercise.id)}
                        >
                          {completed ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                        </button>
                        <div className="exercise-copy">
                          <div className="exercise-title-row">
                            <div>
                              <strong>{exercise.name}</strong>
                              {lastSummary && <small>Last time: {lastSummary}</small>}
                            </div>
                            {hasLocalPr && <span className="pr-chip">PR</span>}
                          </div>
                          {canUseLastSets && (
                            <button className="last-sets-button" type="button" onClick={() => useLastSets(exercise.id)}>
                              <RotateCcw aria-hidden="true" />
                              <span>Use last sets</span>
                            </button>
                          )}
                          {currentSummary && <div className="current-set-summary">{currentSummary}</div>}
                          {isCardio ? (
                            <div className="cardio-logger">
                              <div className="cardio-slider-head">
                                <span>Minutes</span>
                                <strong>{currentMinutes}/{cardioTarget}</strong>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max={cardioTarget}
                                step="5"
                                value={detail.cardioMinutes || '0'}
                                onChange={(event) => updateCardioMinutes(exercise.id, event.target.value)}
                              />
                              <div className="cardio-quick-row">
                                {[0, 15, 30, cardioTarget].filter((value, index, list) => list.indexOf(value) === index).map((minutes) => (
                                  <button
                                    key={minutes}
                                    type="button"
                                    className={currentMinutes === minutes ? 'active' : ''}
                                    onClick={() => updateCardioMinutes(exercise.id, String(minutes))}
                                  >
                                    {minutes === 0 ? 'No' : `${minutes} min`}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="set-stack">
                              {detail.sets.map((set, setIndex) => (
                                <div
                                  key={set.id}
                                  className={`set-row ${isStretch ? 'stretch-row' : ''} ${set.weightMode === 'pounds' ? 'with-pounds' : ''} ${
                                    detail.sets.length > 1 ? 'can-remove' : ''
                                  }`}
                                >
                                  <span className="set-index">{isStretch ? `Round ${setIndex + 1}` : `Set ${setIndex + 1}`}</span>
                                  {!isStretch && (
                                    <label>
                                      <span>Weight</span>
                                      <select
                                        value={set.weightMode}
                                        onChange={(event) =>
                                          updateExerciseSet(exercise.id, set.id, {
                                            weightMode: event.target.value as WeightMode,
                                          })
                                        }
                                      >
                                        <option value="bodyweight">Body weight</option>
                                        <option value="pounds">Pounds</option>
                                      </select>
                                    </label>
                                  )}
                                  {!isStretch && set.weightMode === 'pounds' && (
                                    <label>
                                      <span>Pounds</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        inputMode="decimal"
                                        value={set.pounds}
                                        onChange={(event) => updateExerciseSet(exercise.id, set.id, { pounds: event.target.value })}
                                      />
                                    </label>
                                  )}
                                  <label>
                                    <span>{isStretch ? 'Reps / Hold' : 'Reps'}</span>
                                    <select
                                      value={set.reps}
                                      onChange={(event) => updateExerciseSet(exercise.id, set.id, { reps: event.target.value })}
                                    >
                                      <option value="">-</option>
                                      {REP_OPTIONS.map((rep) => (
                                        <option key={rep} value={rep}>
                                          {rep}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  {detail.sets.length > 1 && (
                                    <button
                                      className="set-remove-button"
                                      type="button"
                                      aria-label={`Remove set ${setIndex + 1} from ${exercise.name}`}
                                      onClick={() => removeExerciseSet(exercise.id, set.id)}
                                    >
                                      <X aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button
                                className="icon-text-button compact set-add-button"
                                type="button"
                                onClick={() => addExerciseSet(exercise.id)}
                              >
                                <Plus aria-hidden="true" />
                                <span>{isStretch ? 'Add Round' : 'Add Set'}</span>
                              </button>
                            </div>
                          )}
                          {detail.legacyNote && <small className="legacy-detail">Previous detail: {detail.legacyNote}</small>}
                        </div>
                        <button
                          className={`skip-button ${skipped ? 'active' : ''}`}
                          type="button"
                          aria-label={`Skip ${exercise.name}`}
                          onClick={() => toggleSkip(exercise.id)}
                        >
                          <Ban aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="notes-grid">
        <label>
          <span>Notes</span>
          <textarea
            value={log.notes}
            onChange={(event) =>
              onUpdate((current) =>
                touchLog({
                  ...current,
                  notes: event.target.value,
                  daySkipped: false,
                }),
              )
            }
          />
        </label>
        <label>
          <span>PR Notes</span>
          <textarea
            value={log.prNote}
            onChange={(event) =>
              onUpdate((current) =>
                touchLog({
                  ...current,
                  prNote: event.target.value,
                  daySkipped: false,
                }),
              )
            }
          />
        </label>
      </div>
      <div className="session-finish-bar">
        <div>
          <strong>{progress.completed}/{progress.total}</strong>
          <span>{loggedSets} sets logged · {sessionVolume.toLocaleString()} lb volume</span>
        </div>
        <button className="icon-text-button primary" type="button" onClick={completeAll}>
          <Check aria-hidden="true" />
          <span>Finish</span>
        </button>
      </div>
    </section>
  );
}

function TodayView({
  logs,
  todayKey,
  getExercises,
  updateExerciseOrder,
  updateLog,
  clearLog,
}: {
  logs: LogsByDate;
  todayKey: string;
  getExercises: GetExercisesForDate;
  updateExerciseOrder: (dateKey: string, exerciseIds: string[]) => void;
  updateLog: (dateKey: string, updater: (log: WorkoutLog) => WorkoutLog) => void;
  clearLog: (dateKey: string) => void;
}) {
  const log = normalizeLog(todayKey, logs[todayKey]);
  const exercises = getExercises(todayKey);
  const progress = getProgressMeta(exercises, log);
  const remaining = Math.max(progress.total - progress.completed - progress.skipped, 0);
  const stats = buildTrainingStats(logs, todayKey, getExercises);
  const nextExercise = exercises.find((exercise) => !log.completed.includes(exercise.id) && !log.skipped.includes(exercise.id));
  const loggedSets = getLogSetCount(log);
  const sessionVolume = getLogVolume(log);
  const todayBasketballMinutes = getCompletedBasketballMinutes(exercises, log);
  const maxTrendVolume = Math.max(1, ...stats.weeklyTrend.map((entry) => entry.volume));

  return (
    <div className="view-stack">
      <section className="today-dashboard">
        <div className="today-hero">
          <p className="eyebrow">Today</p>
          <h1>{formatDateLabel(todayKey)}</h1>
          <p>{nextExercise ? `Up next: ${nextExercise.name}` : 'Workout is wrapped. Nice work.'}</p>
          <div className="hero-actions">
            <a className="icon-text-button spotify-inline" href="https://open.spotify.com/" target="_blank" rel="noreferrer">
              <Headphones aria-hidden="true" />
              <span>Spotify</span>
            </a>
            <span>{remaining} left</span>
          </div>
        </div>

        <div className="today-command">
          <div className="progress-orb large" style={{ '--progress': `${progress.percent}%` } as CSSProperties}>
            <strong>{progress.percent}%</strong>
            <span>{progress.completed}/{progress.total}</span>
          </div>
          <div>
            <span>Current focus</span>
            <strong>{nextExercise?.name ?? 'Recovery'}</strong>
            <p>{loggedSets} sets · {sessionVolume.toLocaleString()} lb · {todayBasketballMinutes} basketball min</p>
          </div>
        </div>
      </section>

      <div className="today-strip training-strip">
        <article>
          <Flame aria-hidden="true" />
          <span>Streak</span>
          <strong>{stats.streak}</strong>
        </article>
        <article>
          <Dumbbell aria-hidden="true" />
          <span>Sets</span>
          <strong>{loggedSets}</strong>
        </article>
        <article>
          <Timer aria-hidden="true" />
          <span>Basketball</span>
          <strong>{stats.basketballMinutes}</strong>
        </article>
        <article>
          <Sparkles aria-hidden="true" />
          <span>Reps</span>
          <strong>{stats.totalReps}</strong>
        </article>
      </div>

      <section className="trend-card">
        <div className="section-title">
          <Activity aria-hidden="true" />
          <h3>7 Day Load</h3>
        </div>
        <div className="trend-bars" aria-label="Seven day training volume">
          {stats.weeklyTrend.map((entry) => (
            <div key={entry.dateKey} className="trend-bar">
              <span style={{ height: `${Math.max(8, Math.round((entry.volume / maxTrendVolume) * 100))}%` }} />
              <small>{formatShortDate(entry.dateKey).slice(0, 3)}</small>
            </div>
          ))}
        </div>
      </section>

      <WorkoutPanel
        dateKey={todayKey}
        exercises={exercises}
        log={log}
        logs={logs}
        todayKey={todayKey}
        getExercises={getExercises}
        onReorder={(exerciseIds) => updateExerciseOrder(todayKey, exerciseIds)}
        onUpdate={(updater) => updateLog(todayKey, updater)}
        onClear={() => clearLog(todayKey)}
      />
    </div>
  );
}

function WeekView({
  logs,
  todayKey,
  selectedDate,
  getExercises,
  setSelectedDate,
  openLogbook,
}: {
  logs: LogsByDate;
  todayKey: string;
  selectedDate: string;
  getExercises: GetExercisesForDate;
  setSelectedDate: (dateKey: string) => void;
  openLogbook: (dateKey: string) => void;
}) {
  const weekStart = startOfWeek(parseDateKey(selectedDate));
  const days = WEEK_DAYS.map((day, index) => {
    const date = addDays(weekStart, index);
    const dateKey = toDateKey(date);
    const log = normalizeLog(dateKey, logs[dateKey]);
    const exercises = getExercises(dateKey);
    const progress = getProgressMeta(exercises, log);
    const status = getDayStatus(dateKey, log, todayKey, exercises);
    return { day, dateKey, exercises, progress, status };
  });

  return (
    <div className="view-stack">
      <section className="topline">
        <div>
          <p className="eyebrow">Week</p>
          <h1>
            {formatShortDate(days[0].dateKey)} - {formatShortDate(days[6].dateKey)}
          </h1>
        </div>
        <div className="date-pager">
          <button
            className="icon-only-button"
            type="button"
            aria-label="Previous week"
            onClick={() => setSelectedDate(toDateKey(addDays(weekStart, -7)))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button className="icon-text-button" type="button" onClick={() => setSelectedDate(todayKey)}>
            <Target aria-hidden="true" />
            <span>Today</span>
          </button>
          <button
            className="icon-only-button"
            type="button"
            aria-label="Next week"
            onClick={() => setSelectedDate(toDateKey(addDays(weekStart, 7)))}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <div className="week-grid">
        {days.map(({ day, dateKey, exercises, progress, status }) => (
          <article key={dateKey} className={`week-day ${status}`}>
            <div className="week-day-head">
              <div>
                <span>{day}</span>
                <strong>{formatShortDate(dateKey)}</strong>
              </div>
              <StatusPill status={status} />
            </div>
            <div className="thin-progress">
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            <p>
              {progress.completed}/{progress.total} complete
            </p>
            <ul>
              {exercises.map((exercise) => (
                <li key={exercise.id}>{exercise.name}</li>
              ))}
            </ul>
            <button className="icon-text-button compact" type="button" onClick={() => openLogbook(dateKey)}>
              <ClipboardList aria-hidden="true" />
              <span>Open</span>
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function CalendarView({
  logs,
  todayKey,
  selectedDate,
  getExercises,
  setSelectedDate,
  openLogbook,
}: {
  logs: LogsByDate;
  todayKey: string;
  selectedDate: string;
  getExercises: GetExercisesForDate;
  setSelectedDate: (dateKey: string) => void;
  openLogbook: (dateKey: string) => void;
}) {
  const monthDate = parseDateKey(selectedDate);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const dateKey = toDateKey(date);
    const log = normalizeLog(dateKey, logs[dateKey]);
    const exercises = getExercises(dateKey);
    return {
      date,
      dateKey,
      inMonth: date >= monthStart && date <= monthEnd,
      status: getDayStatus(dateKey, log, todayKey, exercises),
      progress: getProgressMeta(exercises, log),
    };
  });

  return (
    <div className="view-stack">
      <section className="topline">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1>{formatMonth(monthDate)}</h1>
        </div>
        <div className="date-pager">
          <button
            className="icon-only-button"
            type="button"
            aria-label="Previous month"
            onClick={() => setSelectedDate(toDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1)))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button className="icon-text-button" type="button" onClick={() => setSelectedDate(todayKey)}>
            <Target aria-hidden="true" />
            <span>Today</span>
          </button>
          <button
            className="icon-only-button"
            type="button"
            aria-label="Next month"
            onClick={() => setSelectedDate(toDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1)))}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <div className="calendar-shell">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <span key={day} className="calendar-label">
            {day}
          </span>
        ))}
        {cells.map(({ date, dateKey, inMonth, status, progress }) => (
          <button
            key={dateKey}
            type="button"
            className={`calendar-cell ${status} ${inMonth ? '' : 'muted'} ${dateKey === todayKey ? 'today' : ''}`}
            onClick={() => openLogbook(dateKey)}
          >
            <span>{date.getDate()}</span>
            <i />
            <small>
              {progress.completed}/{progress.total}
            </small>
          </button>
        ))}
      </div>

      <div className="legend-row">
        {(Object.keys(STATUS_LABELS) as DayStatus[]).map((status) => (
          <span key={status} className={`legend-item ${status}`}>
            <i />
            {STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    </div>
  );
}

function buildRecentDates(todayKey: string, days: number): string[] {
  const today = parseDateKey(todayKey);
  return Array.from({ length: days }, (_, index) => toDateKey(addDays(today, -index)));
}

function MilestonesView({
  logs,
  todayKey,
  getExercises,
}: {
  logs: LogsByDate;
  todayKey: string;
  getExercises: GetExercisesForDate;
}) {
  const stats = buildTrainingStats(logs, todayKey, getExercises);
  const maxVolume = Math.max(1, ...stats.weeklyTrend.map((entry) => entry.volume));

  return (
    <div className="view-stack">
      <section className="topline">
        <div>
          <p className="eyebrow">Progress</p>
          <h1>Training signal</h1>
        </div>
      </section>

      <div className="metrics-grid">
        <MetricTile icon={Flame} label="Current streak" value={`${stats.streak} days`} accent="#f26440" />
        <MetricTile icon={Check} label="Completed sessions" value={`${stats.completedSessions}`} accent="#2e8f5b" />
        <MetricTile icon={Timer} label="Basketball minutes" value={`${stats.basketballMinutes}`} accent="#e4aa24" />
        <MetricTile icon={Medal} label="Stretch days" value={`${stats.stretchDays}`} accent="#3772ff" />
        <MetricTile icon={Activity} label="28 day volume" value={`${stats.totalVolume.toLocaleString()}`} accent="#6b8cae" />
        <MetricTile icon={Target} label="28 day reps" value={`${stats.totalReps}`} accent="#9b7ba8" />
      </div>

      <section className="timeline-section progress-section">
        <div className="section-title">
          <Activity aria-hidden="true" />
          <h3>Weekly Load</h3>
        </div>
        <div className="progress-trend-list">
          {stats.weeklyTrend.map((entry) => (
            <article key={entry.dateKey} className="progress-trend-row">
              <span>{formatShortDate(entry.dateKey)}</span>
              <div className="thin-progress">
                <span style={{ width: `${Math.max(2, Math.round((entry.volume / maxVolume) * 100))}%` }} />
              </div>
              <strong>{entry.volume.toLocaleString()} lb</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="timeline-section">
        <div className="section-title">
          <Trophy aria-hidden="true" />
          <h3>PR Notes</h3>
        </div>
        {stats.prNotes.length > 0 ? (
          <div className="pr-list">
            {stats.prNotes
              .slice()
              .reverse()
              .slice(0, 8)
              .map((entry) => (
                <article key={`${entry.dateKey}-${entry.note}`} className="pr-entry">
                  <span>{formatDateLabel(entry.dateKey)}</span>
                  <p>{entry.note}</p>
                </article>
              ))}
          </div>
        ) : (
          <p className="empty-note">No PR notes yet.</p>
        )}
      </section>
    </div>
  );
}

function LogbookView({
  logs,
  todayKey,
  selectedDate,
  getExercises,
  setSelectedDate,
  updateExerciseOrder,
  updateLog,
  clearLog,
}: {
  logs: LogsByDate;
  todayKey: string;
  selectedDate: string;
  getExercises: GetExercisesForDate;
  setSelectedDate: (dateKey: string) => void;
  updateExerciseOrder: (dateKey: string, exerciseIds: string[]) => void;
  updateLog: (dateKey: string, updater: (log: WorkoutLog) => WorkoutLog) => void;
  clearLog: (dateKey: string) => void;
}) {
  const recentEntries = Object.values(logs)
    .filter(hasLogActivity)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  return (
    <div className="logbook-layout">
      <div className="view-stack">
        <section className="topline">
          <div>
            <p className="eyebrow">Logbook</p>
            <h1>{formatDateLabel(selectedDate)}</h1>
          </div>
          <div className="date-pager">
            <button
              className="icon-only-button"
              type="button"
              aria-label="Previous day"
              onClick={() => setSelectedDate(toDateKey(addDays(parseDateKey(selectedDate), -1)))}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <input
              className="date-input"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
            <button
              className="icon-only-button"
              type="button"
              aria-label="Next day"
              onClick={() => setSelectedDate(toDateKey(addDays(parseDateKey(selectedDate), 1)))}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </section>

        <WorkoutPanel
          dateKey={selectedDate}
          exercises={getExercises(selectedDate)}
          log={normalizeLog(selectedDate, logs[selectedDate])}
          logs={logs}
          todayKey={todayKey}
          getExercises={getExercises}
          onReorder={(exerciseIds) => updateExerciseOrder(selectedDate, exerciseIds)}
          onUpdate={(updater) => updateLog(selectedDate, updater)}
          onClear={() => clearLog(selectedDate)}
        />
      </div>

      <aside className="recent-panel">
        <div className="section-title">
          <ClipboardList aria-hidden="true" />
          <h3>Recent</h3>
        </div>
        {recentEntries.length > 0 ? (
          recentEntries.map((entry) => {
            const exercises = getExercises(entry.date);
            const progress = getProgressMeta(exercises, entry);
            const sets = getLogSetCount(entry);
            const volume = getLogVolume(entry);
            return (
              <button key={entry.date} type="button" className="recent-entry" onClick={() => setSelectedDate(entry.date)}>
                <div>
                  <strong>{formatDateLabel(entry.date)}</strong>
                  <small>{sets} sets · {volume.toLocaleString()} lb</small>
                </div>
                <span>{progress.completed}/{progress.total}</span>
              </button>
            );
          })
        ) : (
          <p className="empty-note">No logs yet.</p>
        )}
      </aside>
    </div>
  );
}

function SettingsView({
  program,
  setProgram,
}: {
  program: ProgramByDay;
  setProgram: Dispatch<SetStateAction<ProgramByDay>>;
}) {
  const [selectedProgramDay, setSelectedProgramDay] = useState<Weekday>(() => getWeekday(new Date()));
  const [newWorkoutName, setNewWorkoutName] = useState('');
  const dayWorkouts = program[selectedProgramDay];

  const updateWorkoutName = (exerciseId: string, name: string) => {
    setProgram((current) => ({
      ...current,
      [selectedProgramDay]: current[selectedProgramDay].map((exercise) =>
        exercise.id === exerciseId ? { ...exercise, name } : exercise,
      ),
    }));
  };

  const normalizeWorkoutName = (exerciseId: string, name: string) => {
    const trimmedName = name.trim();
    updateWorkoutName(exerciseId, trimmedName || 'Untitled Workout');
  };

  const addWorkout = () => {
    const name = newWorkoutName.trim();
    if (!name) {
      return;
    }

    setProgram((current) => ({
      ...current,
      [selectedProgramDay]: [
        ...current[selectedProgramDay],
        {
          id: createWorkoutId(selectedProgramDay),
          day: selectedProgramDay,
          name,
        },
      ],
    }));
    setNewWorkoutName('');
  };

  const removeWorkout = (exerciseId: string) => {
    setProgram((current) => ({
      ...current,
      [selectedProgramDay]: current[selectedProgramDay].filter((exercise) => exercise.id !== exerciseId),
    }));
  };

  const moveWorkout = (exerciseId: string, direction: -1 | 1) => {
    setProgram((current) => {
      const workouts = current[selectedProgramDay];
      const currentIndex = workouts.findIndex((exercise) => exercise.id === exerciseId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= workouts.length) {
        return current;
      }

      const nextWorkouts = [...workouts];
      [nextWorkouts[currentIndex], nextWorkouts[nextIndex]] = [nextWorkouts[nextIndex], nextWorkouts[currentIndex]];
      return {
        ...current,
        [selectedProgramDay]: nextWorkouts,
      };
    });
  };

  return (
    <div className="view-stack">
      <section className="topline">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Program editor</h1>
        </div>
      </section>

      <div className="program-editor-layout">
        <aside className="program-side-panel">
          <div className="section-title">
            <CalendarDays aria-hidden="true" />
            <h3>Days</h3>
          </div>
          <div className="program-day-tabs">
            {WEEK_DAYS.map((day) => (
              <button
                key={day}
                className={`program-day-button ${day === selectedProgramDay ? 'active' : ''}`}
                type="button"
                onClick={() => setSelectedProgramDay(day)}
              >
                <span>{day}</span>
                <strong>{program[day].length}</strong>
              </button>
            ))}
          </div>
          <a className="settings-action spotify-action program-spotify" href="https://open.spotify.com/" target="_blank" rel="noreferrer">
            <Headphones aria-hidden="true" />
            <span>Spotify</span>
            <ExternalLink aria-hidden="true" />
          </a>
        </aside>

        <section className="program-editor-panel">
          <div className="program-editor-head">
            <div className="section-title">
              <ListChecks aria-hidden="true" />
              <h3>{selectedProgramDay} Workouts</h3>
            </div>
            <span>{dayWorkouts.length} saved</span>
          </div>

          <form
            className="program-add-row"
            onSubmit={(event) => {
              event.preventDefault();
              addWorkout();
            }}
          >
            <input
              value={newWorkoutName}
              placeholder="Add workout"
              onChange={(event) => setNewWorkoutName(event.target.value)}
            />
            <button className="icon-text-button compact" type="submit" disabled={!newWorkoutName.trim()}>
              <Plus aria-hidden="true" />
              <span>Add</span>
            </button>
          </form>

          <div className="program-workout-list">
            {dayWorkouts.length > 0 ? (
              dayWorkouts.map((exercise, index) => (
                <article key={exercise.id} className="program-workout-row">
                  <div className="move-pair">
                    <button
                      className="move-mini-button"
                      type="button"
                      aria-label={`Move ${exercise.name} up`}
                      onClick={() => moveWorkout(exercise.id, -1)}
                      disabled={index === 0}
                    >
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button
                      className="move-mini-button"
                      type="button"
                      aria-label={`Move ${exercise.name} down`}
                      onClick={() => moveWorkout(exercise.id, 1)}
                      disabled={index === dayWorkouts.length - 1}
                    >
                      <ArrowDown aria-hidden="true" />
                    </button>
                  </div>
                  <input
                    value={exercise.name}
                    aria-label={`Rename ${exercise.name}`}
                    onChange={(event) => updateWorkoutName(exercise.id, event.target.value)}
                    onBlur={(event) => normalizeWorkoutName(exercise.id, event.target.value)}
                  />
                  <button
                    className="set-remove-button"
                    type="button"
                    aria-label={`Remove ${exercise.name}`}
                    onClick={() => removeWorkout(exercise.id)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </article>
              ))
            ) : (
              <p className="empty-note">No workouts saved for {selectedProgramDay}.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const [activeTab, setActiveTab] = useState<TabId>('today');
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [logs, setLogs] = useState<LogsByDate>(() => loadLogs());
  const [program, setProgram] = useState<ProgramByDay>(() => loadProgram());
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [mobilePreview, setMobilePreview] = useState(() => getStoredMobilePreview());

  useEffect(() => {
    saveLogs(logs);
  }, [logs]);

  useEffect(() => {
    saveProgram(program);
  }, [program]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = theme === 'dark' ? '#23221d' : '#faf9f5';
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(MOBILE_PREVIEW_STORAGE_KEY, mobilePreview ? 'mobile' : 'desktop');
  }, [mobilePreview]);

  const updateLog = (dateKey: string, updater: (log: WorkoutLog) => WorkoutLog) => {
    setLogs((current) => {
      const nextLog = updater(normalizeLog(dateKey, current[dateKey]));
      return {
        ...current,
        [dateKey]: nextLog,
      };
    });
  };

  const clearLog = (dateKey: string) => {
    setLogs((current) => {
      const next = { ...current };
      delete next[dateKey];
      return next;
    });
  };

  const openLogbook = (dateKey: string) => {
    setSelectedDate(dateKey);
    setActiveTab('logbook');
  };

  const getExercises: GetExercisesForDate = (dateKey) => getProgramExercisesForDate(dateKey, program);

  const updateExerciseOrder = (dateKey: string, exerciseIds: string[]) => {
    const day = getWeekday(parseDateKey(dateKey));
    setProgram((current) => ({
      ...current,
      [day]: applyExerciseOrder(current[day], exerciseIds),
    }));
  };

  const currentLog = normalizeLog(todayKey, logs[todayKey] ?? createEmptyLog(todayKey));
  const currentExercises = getExercises(todayKey);
  const currentProgress = getProgressMeta(currentExercises, currentLog);

  return (
    <div className={`app-shell ${mobilePreview ? 'mobile-preview' : ''}`}>
      <aside className="app-rail">
        <div className="brand-mark">
          <Dumbbell aria-hidden="true" />
          <div>
            <strong>Gym</strong>
            <span>{currentProgress.percent}% today</span>
          </div>
        </div>
        <div className="rail-summary">
          <span>Today</span>
          <strong>{currentProgress.completed}/{currentProgress.total}</strong>
          <div className="thin-progress">
            <span style={{ width: `${currentProgress.percent}%` }} />
          </div>
        </div>
        <nav>
          {TABS.map((tab) => (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              icon={tab.icon}
              label={tab.label}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
        </nav>
      </aside>

      <main className="app-main">
        <AppChrome
          currentProgress={currentProgress}
          theme={theme}
          mobilePreview={mobilePreview}
          onThemeToggle={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          onMobilePreviewToggle={() => setMobilePreview((current) => !current)}
        />
        {activeTab === 'today' && (
          <TodayView
            logs={logs}
            todayKey={todayKey}
            getExercises={getExercises}
            updateExerciseOrder={updateExerciseOrder}
            updateLog={updateLog}
            clearLog={clearLog}
          />
        )}
        {activeTab === 'week' && (
          <WeekView
            logs={logs}
            todayKey={todayKey}
            selectedDate={selectedDate}
            getExercises={getExercises}
            setSelectedDate={setSelectedDate}
            openLogbook={openLogbook}
          />
        )}
        {activeTab === 'calendar' && (
          <CalendarView
            logs={logs}
            todayKey={todayKey}
            selectedDate={selectedDate}
            getExercises={getExercises}
            setSelectedDate={setSelectedDate}
            openLogbook={openLogbook}
          />
        )}
        {activeTab === 'milestones' && <MilestonesView logs={logs} todayKey={todayKey} getExercises={getExercises} />}
        {activeTab === 'logbook' && (
          <LogbookView
            logs={logs}
            todayKey={todayKey}
            selectedDate={selectedDate}
            getExercises={getExercises}
            setSelectedDate={setSelectedDate}
            updateExerciseOrder={updateExerciseOrder}
            updateLog={updateLog}
            clearLog={clearLog}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsView
            program={program}
            setProgram={setProgram}
          />
        )}
      </main>

      <nav className="bottom-tabs" aria-label="Gym tabs">
        {BOTTOM_TABS.map((tab) => (
          <TabButton
            key={tab.id}
            active={activeTab === tab.id}
            icon={tab.icon}
            label={tab.label}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </nav>
    </div>
  );
}
