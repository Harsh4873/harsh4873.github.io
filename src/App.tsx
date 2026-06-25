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
  Download,
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
  Trash2,
  Trophy,
  Upload,
  X,
} from 'lucide-react';
import type { ChangeEvent, ComponentType, CSSProperties, Dispatch, DragEvent, SetStateAction, SVGProps } from 'react';
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
  loadExerciseOrder,
  loadLogs,
  normalizeExerciseOrder,
  normalizeLog,
  saveExerciseOrder,
  saveLogs,
} from './storage';
import type {
  DayStatus,
  Exercise,
  ExerciseOrderByDay,
  ExerciseSet,
  LogsByDate,
  SupersetPair,
  TabId,
  ThemeMode,
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
  { id: 'week', label: 'Week', icon: ListChecks },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'milestones', label: 'Milestones', icon: Trophy },
  { id: 'logbook', label: 'Logbook', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const STATUS_LABELS: Record<DayStatus, string> = {
  completed: 'Completed',
  partial: 'Partial',
  skipped: 'Skipped',
  future: 'Future',
};

function getStoredTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

function getStoredMobilePreview(): boolean {
  return window.localStorage.getItem(MOBILE_PREVIEW_STORAGE_KEY) === 'mobile';
}

function createSetId(): string {
  return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function getOrderedExercisesForDate(dateKey: string, exerciseOrder: ExerciseOrderByDay): Exercise[] {
  const exercises = getExercisesForDate(dateKey);
  const day = getWeekday(parseDateKey(dateKey));
  return applyExerciseOrder(exercises, exerciseOrder[day]);
}

function mergeExerciseOrderForDate(dateKey: string, orderedIds: string[]): string[] {
  const defaultIds = getExercisesForDate(dateKey).map((exercise) => exercise.id);
  const validIds = new Set(defaultIds);
  const nextIds: string[] = [];

  orderedIds.forEach((id) => {
    if (validIds.has(id) && !nextIds.includes(id)) {
      nextIds.push(id);
    }
  });

  return [...nextIds, ...defaultIds.filter((id) => !nextIds.includes(id))];
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
          inactiveLabel="Desk"
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
  todayKey,
  onReorder,
  onUpdate,
  onClear,
}: {
  dateKey: string;
  exercises: Exercise[];
  log: WorkoutLog;
  todayKey: string;
  onReorder: (exerciseIds: string[]) => void;
  onUpdate: (updater: (log: WorkoutLog) => WorkoutLog) => void;
  onClear: () => void;
}) {
  const [firstSupersetId, setFirstSupersetId] = useState(exercises[0]?.id ?? '');
  const [secondSupersetId, setSecondSupersetId] = useState(exercises[1]?.id ?? '');
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const exerciseOrderSignature = exercises.map((exercise) => exercise.id).join('|');
  const progress = getProgressMeta(exercises, log);
  const status = getDayStatus(dateKey, log, todayKey, exercises);
  const supersetExerciseCount = getSupersetExerciseCount(log);
  const pairedIds = new Set(log.supersets.flatMap((pair) => pair.exerciseIds));
  const unpairedExercises = exercises.filter((exercise) => !pairedIds.has(exercise.id));
  const groups = buildExerciseGroups(exercises, log.supersets);

  useEffect(() => {
    const available = exercises.filter((exercise) => !pairedIds.has(exercise.id));
    setFirstSupersetId(available[0]?.id ?? '');
    setSecondSupersetId(available[1]?.id ?? '');
  }, [dateKey, exerciseOrderSignature, log.supersets.length]);

  const canAddSuperset =
    firstSupersetId &&
    secondSupersetId &&
    firstSupersetId !== secondSupersetId &&
    !pairedIds.has(firstSupersetId) &&
    !pairedIds.has(secondSupersetId);

  const toggleComplete = (exerciseId: string) => {
    onUpdate((current) => {
      const completed = current.completed.includes(exerciseId)
        ? current.completed.filter((id) => id !== exerciseId)
        : uniqueList([...current.completed, exerciseId]);

      return touchLog({
        ...current,
        completed,
        skipped: current.skipped.filter((id) => id !== exerciseId),
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
          <span>Complete All</span>
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
                          <strong>{exercise.name}</strong>
                          <div className="set-stack">
                            {detail.sets.map((set, setIndex) => (
                              <div
                                key={set.id}
                                className={`set-row ${set.weightMode === 'pounds' ? 'with-pounds' : ''} ${
                                  detail.sets.length > 1 ? 'can-remove' : ''
                                }`}
                              >
                                <span className="set-index">Set {setIndex + 1}</span>
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
                                {set.weightMode === 'pounds' && (
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
                                  <span>Reps</span>
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
                              <span>Add Set</span>
                            </button>
                          </div>
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

  return (
    <div className="view-stack">
      <section className="topline">
        <div>
          <p className="eyebrow">Today</p>
          <h1>{formatDateLabel(todayKey)}</h1>
        </div>
        <div className="topline-stat">
          <Dumbbell aria-hidden="true" />
          <strong>{progress.total}</strong>
          <span>moves</span>
        </div>
      </section>
      <div className="today-strip">
        <article>
          <Check aria-hidden="true" />
          <span>Done</span>
          <strong>{progress.completed}</strong>
        </article>
        <article>
          <Link2 aria-hidden="true" />
          <span>Supersets</span>
          <strong>{log.supersets.length}</strong>
        </article>
        <article>
          <Sparkles aria-hidden="true" />
          <span>Remaining</span>
          <strong>{remaining}</strong>
        </article>
      </div>
      <WorkoutPanel
        dateKey={todayKey}
        exercises={exercises}
        log={log}
        todayKey={todayKey}
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
  const allDates = buildRecentDates(todayKey, 180).reverse();
  let completedSessions = 0;
  let basketballMinutes = 0;
  let stretchDays = 0;
  const prNotes: Array<{ dateKey: string; note: string }> = [];

  allDates.forEach((dateKey) => {
    const log = normalizeLog(dateKey, logs[dateKey]);
    const exercises = getExercises(dateKey);
    const progress = getProgressMeta(exercises, log);
    if (progress.completed === progress.total && progress.total > 0) {
      completedSessions += 1;
    }

    basketballMinutes += exercises.reduce((total, exercise) => {
      return log.completed.includes(exercise.id) ? total + getBasketballMinutes(exercise.name) : total;
    }, 0);

    const completedStretch = exercises.some(
      (exercise) => log.completed.includes(exercise.id) && isStretchExercise(exercise.name),
    );
    if (completedStretch) {
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

  return (
    <div className="view-stack">
      <section className="topline">
        <div>
          <p className="eyebrow">Milestones</p>
          <h1>Training signal</h1>
        </div>
      </section>

      <div className="metrics-grid">
        <MetricTile icon={Flame} label="Current streak" value={`${streak} days`} accent="#f26440" />
        <MetricTile icon={Check} label="Completed sessions" value={`${completedSessions}`} accent="#2e8f5b" />
        <MetricTile icon={Timer} label="Basketball minutes" value={`${basketballMinutes}`} accent="#e4aa24" />
        <MetricTile icon={Medal} label="Stretch days" value={`${stretchDays}`} accent="#3772ff" />
      </div>

      <section className="timeline-section">
        <div className="section-title">
          <Trophy aria-hidden="true" />
          <h3>PR Notes</h3>
        </div>
        {prNotes.length > 0 ? (
          <div className="pr-list">
            {prNotes
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
          todayKey={todayKey}
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
            return (
              <button key={entry.date} type="button" className="recent-entry" onClick={() => setSelectedDate(entry.date)}>
                <strong>{formatDateLabel(entry.date)}</strong>
                <span>
                  {progress.completed}/{progress.total}
                </span>
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
  logs,
  exerciseOrder,
  setLogs,
  setExerciseOrder,
}: {
  logs: LogsByDate;
  exerciseOrder: ExerciseOrderByDay;
  setLogs: Dispatch<SetStateAction<LogsByDate>>;
  setExerciseOrder: Dispatch<SetStateAction<ExerciseOrderByDay>>;
}) {
  const [message, setMessage] = useState('');

  const exportLogs = () => {
    const payload = JSON.stringify(
      {
        version: 2,
        exportedAt: new Date().toISOString(),
        exerciseOrder,
        logs,
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gym-logbook-${toDateKey(new Date())}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    setMessage('Export ready.');
  };

  const importLogs = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as unknown;
        if (!isPlainRecord(parsed)) {
          throw new Error('Invalid import');
        }
        const source = isPlainRecord(parsed.logs) ? parsed.logs : parsed;
        const nextLogs = Object.fromEntries(
          Object.entries(source).map(([date, log]) => [date, normalizeLog(date, log as Partial<WorkoutLog>)]),
        );
        setLogs(nextLogs);
        if (isPlainRecord(parsed) && isPlainRecord(parsed.exerciseOrder)) {
          setExerciseOrder(normalizeExerciseOrder(parsed.exerciseOrder));
        }
        setMessage('Import complete.');
      } catch {
        setMessage('Import failed.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const clearAll = () => {
    if (window.confirm('Clear all Gym logs on this device?')) {
      setLogs({});
      setMessage('Logs cleared.');
    }
  };

  return (
    <div className="view-stack">
      <section className="topline">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Device backup</h1>
        </div>
      </section>

      <div className="settings-grid">
        <button className="settings-action" type="button" onClick={exportLogs}>
          <Download aria-hidden="true" />
          <span>Export JSON</span>
        </button>
        <a className="settings-action spotify-action" href="https://open.spotify.com/" target="_blank" rel="noreferrer">
          <Headphones aria-hidden="true" />
          <span>Spotify</span>
          <ExternalLink aria-hidden="true" />
        </a>
        <label className="settings-action">
          <Upload aria-hidden="true" />
          <span>Import JSON</span>
          <input type="file" accept="application/json" onChange={importLogs} />
        </label>
        <button className="settings-action danger" type="button" onClick={clearAll}>
          <Trash2 aria-hidden="true" />
          <span>Reset Logs</span>
        </button>
      </div>

      <section className="storage-panel">
        <div>
          <span>Stored days</span>
          <strong>{Object.keys(logs).length}</strong>
        </div>
        <div>
          <span>Backup status</span>
          <strong>{message || 'Local'}</strong>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const [activeTab, setActiveTab] = useState<TabId>('today');
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [logs, setLogs] = useState<LogsByDate>(() => loadLogs());
  const [exerciseOrder, setExerciseOrder] = useState<ExerciseOrderByDay>(() => loadExerciseOrder());
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [mobilePreview, setMobilePreview] = useState(() => getStoredMobilePreview());

  useEffect(() => {
    saveLogs(logs);
  }, [logs]);

  useEffect(() => {
    saveExerciseOrder(exerciseOrder);
  }, [exerciseOrder]);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = theme === 'dark' ? '#08110d' : '#f5f7f2';
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle('gym-mobile-preview', mobilePreview);
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

  const getExercises: GetExercisesForDate = (dateKey) => getOrderedExercisesForDate(dateKey, exerciseOrder);

  const updateExerciseOrder = (dateKey: string, exerciseIds: string[]) => {
    const day = getWeekday(parseDateKey(dateKey));
    setExerciseOrder((current) => ({
      ...current,
      [day]: mergeExerciseOrderForDate(dateKey, exerciseIds),
    }));
  };

  const currentLog = normalizeLog(todayKey, logs[todayKey] ?? createEmptyLog(todayKey));
  const currentExercises = getExercises(todayKey);
  const currentProgress = getProgressMeta(currentExercises, currentLog);

  return (
    <div className={`app-shell ${mobilePreview ? 'mobile-preview' : ''}`} data-theme={theme}>
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
            logs={logs}
            exerciseOrder={exerciseOrder}
            setLogs={setLogs}
            setExerciseOrder={setExerciseOrder}
          />
        )}
      </main>

      <nav className="bottom-tabs" aria-label="Gym tabs">
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
    </div>
  );
}
