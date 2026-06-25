import {
  Activity,
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
  Flame,
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
import type { ChangeEvent, ComponentType, CSSProperties, Dispatch, SetStateAction, SVGProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  endOfMonth,
  formatDateLabel,
  formatMonth,
  formatShortDate,
  getExercisesForDate,
  parseDateKey,
  startOfMonth,
  startOfWeek,
  toDateKey,
} from './dateUtils';
import { getBasketballMinutes, isStretchExercise, WEEK_DAYS } from './program';
import { createEmptyLog, loadLogs, normalizeLog, saveLogs } from './storage';
import type { DayStatus, Exercise, LogsByDate, SupersetPair, TabId, ThemeMode, WorkoutLog } from './types';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const THEME_STORAGE_KEY = 'harsh-gym-theme-v1';
const MOBILE_PREVIEW_STORAGE_KEY = 'harsh-gym-mobile-preview-v1';

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueList(items: string[]): string[] {
  return Array.from(new Set(items));
}

function touchLog(log: WorkoutLog): WorkoutLog {
  return { ...log, updatedAt: new Date().toISOString() };
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
    Object.values(log.details).some((value) => value.trim().length > 0)
  );
}

function getDayStatus(dateKey: string, log: WorkoutLog, todayKey: string): DayStatus {
  const exercises = getExercisesForDate(dateKey);
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
  const used = new Set<string>();
  const groups: ExerciseGroup[] = [];

  supersets.forEach((superset) => {
    const pair = superset.exerciseIds.map((id) => byId.get(id)).filter(Boolean) as Exercise[];
    if (pair.length !== 2 || pair.some((exercise) => used.has(exercise.id))) {
      return;
    }

    pair.forEach((exercise) => used.add(exercise.id));
    groups.push({
      id: superset.id,
      type: 'superset',
      exercises: pair,
      supersetId: superset.id,
    });
  });

  exercises.forEach((exercise) => {
    if (!used.has(exercise.id)) {
      groups.push({
        id: exercise.id,
        type: 'single',
        exercises: [exercise],
      });
    }
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
  log,
  todayKey,
  onUpdate,
  onClear,
}: {
  dateKey: string;
  log: WorkoutLog;
  todayKey: string;
  onUpdate: (updater: (log: WorkoutLog) => WorkoutLog) => void;
  onClear: () => void;
}) {
  const exercises = getExercisesForDate(dateKey);
  const [firstSupersetId, setFirstSupersetId] = useState(exercises[0]?.id ?? '');
  const [secondSupersetId, setSecondSupersetId] = useState(exercises[1]?.id ?? '');
  const progress = getProgressMeta(exercises, log);
  const status = getDayStatus(dateKey, log, todayKey);
  const supersetExerciseCount = getSupersetExerciseCount(log);
  const pairedIds = new Set(log.supersets.flatMap((pair) => pair.exerciseIds));
  const unpairedExercises = exercises.filter((exercise) => !pairedIds.has(exercise.id));
  const groups = buildExerciseGroups(exercises, log.supersets);

  useEffect(() => {
    const available = exercises.filter((exercise) => !pairedIds.has(exercise.id));
    setFirstSupersetId(available[0]?.id ?? '');
    setSecondSupersetId(available[1]?.id ?? '');
  }, [dateKey, log.supersets.length]);

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

  const updateDetail = (exerciseId: string, detail: string) => {
    onUpdate((current) =>
      touchLog({
        ...current,
        details: {
          ...current.details,
          [exerciseId]: detail,
        },
        daySkipped: false,
      }),
    );
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
        {groups.map((group) => (
          <article key={group.id} className={`exercise-group ${group.type}`}>
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

            {group.exercises.map((exercise) => {
              const completed = log.completed.includes(exercise.id);
              const skipped = log.skipped.includes(exercise.id);

              return (
                <div key={exercise.id} className={`exercise-row ${completed ? 'done' : ''} ${skipped ? 'skipped' : ''}`}>
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
                    <input
                      value={log.details[exercise.id] ?? ''}
                      placeholder="Weight / reps / details"
                      onChange={(event) => updateDetail(exercise.id, event.target.value)}
                    />
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
          </article>
        ))}
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
  updateLog,
  clearLog,
}: {
  logs: LogsByDate;
  todayKey: string;
  updateLog: (dateKey: string, updater: (log: WorkoutLog) => WorkoutLog) => void;
  clearLog: (dateKey: string) => void;
}) {
  const log = normalizeLog(todayKey, logs[todayKey]);
  const exercises = getExercisesForDate(todayKey);
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
        log={log}
        todayKey={todayKey}
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
  setSelectedDate,
  openLogbook,
}: {
  logs: LogsByDate;
  todayKey: string;
  selectedDate: string;
  setSelectedDate: (dateKey: string) => void;
  openLogbook: (dateKey: string) => void;
}) {
  const weekStart = startOfWeek(parseDateKey(selectedDate));
  const days = WEEK_DAYS.map((day, index) => {
    const date = addDays(weekStart, index);
    const dateKey = toDateKey(date);
    const log = normalizeLog(dateKey, logs[dateKey]);
    const exercises = getExercisesForDate(dateKey);
    const progress = getProgressMeta(exercises, log);
    const status = getDayStatus(dateKey, log, todayKey);
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
  setSelectedDate,
  openLogbook,
}: {
  logs: LogsByDate;
  todayKey: string;
  selectedDate: string;
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
    const exercises = getExercisesForDate(dateKey);
    return {
      date,
      dateKey,
      inMonth: date >= monthStart && date <= monthEnd,
      status: getDayStatus(dateKey, log, todayKey),
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

function MilestonesView({ logs, todayKey }: { logs: LogsByDate; todayKey: string }) {
  const allDates = buildRecentDates(todayKey, 180).reverse();
  let completedSessions = 0;
  let basketballMinutes = 0;
  let stretchDays = 0;
  const prNotes: Array<{ dateKey: string; note: string }> = [];

  allDates.forEach((dateKey) => {
    const log = normalizeLog(dateKey, logs[dateKey]);
    const exercises = getExercisesForDate(dateKey);
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
    const exercises = getExercisesForDate(dateKey);
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
  setSelectedDate,
  updateLog,
  clearLog,
}: {
  logs: LogsByDate;
  todayKey: string;
  selectedDate: string;
  setSelectedDate: (dateKey: string) => void;
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
          log={normalizeLog(selectedDate, logs[selectedDate])}
          todayKey={todayKey}
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
            const exercises = getExercisesForDate(entry.date);
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
  setLogs,
}: {
  logs: LogsByDate;
  setLogs: Dispatch<SetStateAction<LogsByDate>>;
}) {
  const [message, setMessage] = useState('');

  const exportLogs = () => {
    const payload = JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
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
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  const [mobilePreview, setMobilePreview] = useState(() => getStoredMobilePreview());

  useEffect(() => {
    saveLogs(logs);
  }, [logs]);

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

  const currentLog = normalizeLog(todayKey, logs[todayKey] ?? createEmptyLog(todayKey));
  const currentExercises = getExercisesForDate(todayKey);
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
          <TodayView logs={logs} todayKey={todayKey} updateLog={updateLog} clearLog={clearLog} />
        )}
        {activeTab === 'week' && (
          <WeekView
            logs={logs}
            todayKey={todayKey}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            openLogbook={openLogbook}
          />
        )}
        {activeTab === 'calendar' && (
          <CalendarView
            logs={logs}
            todayKey={todayKey}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            openLogbook={openLogbook}
          />
        )}
        {activeTab === 'milestones' && <MilestonesView logs={logs} todayKey={todayKey} />}
        {activeTab === 'logbook' && (
          <LogbookView
            logs={logs}
            todayKey={todayKey}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            updateLog={updateLog}
            clearLog={clearLog}
          />
        )}
        {activeTab === 'settings' && <SettingsView logs={logs} setLogs={setLogs} />}
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
