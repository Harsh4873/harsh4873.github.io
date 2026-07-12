import {
  addDays,
  addMonths,
  daysBetween,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  fromDateKey,
  minDate,
  startOfMonth,
  startOfWeek,
  toDateKey,
} from './dates';
import type { GoalPeriod, Habit, HabitEntry, TrackerState } from './model';

export interface PeriodProgress {
  value: number;
  target: number;
  ratio: number;
  complete: boolean;
  hasEntry: boolean;
  skipped: boolean;
  eligible: boolean;
  start: Date;
  end: Date;
}

export interface DaySnapshot {
  score: number;
  completed: number;
  scheduled: number;
  skipped: number;
  logged: number;
}

export interface HabitStats {
  currentStreak: number;
  bestStreak: number;
  consistency: number;
  total: number;
  periods: number;
}

export function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getEntry(state: TrackerState, habitId: string, date: Date | string) {
  const key = typeof date === 'string' ? date : toDateKey(date);
  return state.entries[key]?.[habitId];
}

export function hasLoggedValue(entry?: HabitEntry) {
  return Boolean(entry && !entry.skipped && entry.hasValue !== false && Number.isFinite(entry.value));
}

export function isHabitActiveOn(habit: Habit, date: Date) {
  const key = toDateKey(date);
  if (key < habit.startDate) return false;
  // Pause end dates are exclusive, so restoring a habit makes it available that day.
  if (habit.pauses?.some((pause) => key >= pause.start && (!pause.end || key < pause.end))) return false;
  // Legacy v1 records may have archivedAt without a pause range.
  if (habit.archivedAt && !habit.pauses?.length) return key < habit.archivedAt.slice(0, 10);
  return true;
}

export function isHabitScheduledOn(habit: Habit, date: Date) {
  if (!isHabitActiveOn(habit, date)) return false;
  if (habit.period !== 'day') return true;

  if (habit.schedule.type === 'everyday') return true;
  if (habit.schedule.type === 'selectedDays') {
    return habit.schedule.days.includes(date.getDay());
  }

  const start = fromDateKey(habit.startDate);
  const elapsed = differenceInCalendarDays(date, start);
  if (elapsed < 0) return false;
  const intervalDays = Math.max(1, habit.schedule.every) * (habit.schedule.unit === 'week' ? 7 : 1);
  return elapsed % intervalDays === 0;
}

export function getPeriodBounds(period: GoalPeriod, date: Date, weekStartsOn: 0 | 1) {
  if (period === 'week') {
    return { start: startOfWeek(date, weekStartsOn), end: endOfWeek(date, weekStartsOn) };
  }

  if (period === 'month') {
    return { start: startOfMonth(date), end: endOfMonth(date) };
  }

  return { start: date, end: date };
}

export function getHabitPeriodProgress(
  habit: Habit,
  anchor: Date,
  state: TrackerState,
): PeriodProgress {
  const { start, end } = getPeriodBounds(habit.period, anchor, state.profile.weekStartsOn);
  const periodDays = daysBetween(start, end);
  const eligible = habit.period === 'day'
    ? isHabitActiveOn(habit, anchor)
    : periodDays.every((date) => isHabitActiveOn(habit, date));
  const entries = periodDays
    .filter((date) => isHabitActiveOn(habit, date))
    .map((date) => getEntry(state, habit.id, date))
    .filter((entry): entry is HabitEntry => Boolean(entry));
  const usable = entries.filter((entry) => !entry.skipped && entry.hasValue !== false);
  const value = usable.reduce((sum, entry) => sum + Math.max(0, entry.value || 0), 0);
  const hasEntry = usable.length > 0;
  // A per-day skip exempts a daily goal. It cannot silently waive an entire
  // flexible week or month; those periods need an explicit period-level mode.
  const skipped = habit.period === 'day' && entries.some((entry) => entry.skipped) && usable.length === 0;
  const ratio = habit.direction === 'atMost'
    ? hasEntry
      ? value <= habit.target
        ? 1
        : clamp(habit.target / Math.max(value, 1))
      : 0
    : clamp(value / Math.max(habit.target, 0.0001));
  const complete = habit.direction === 'atMost'
    ? hasEntry
      && value <= habit.target
      && (habit.period === 'day' || toDateKey(end) < toDateKey(new Date()))
    : value >= habit.target;

  return {
    value,
    target: habit.target,
    ratio,
    complete,
    hasEntry,
    skipped,
    eligible,
    start,
    end,
  };
}

export function getDayContributionRatio(habit: Habit, date: Date, state: TrackerState) {
  if (!isHabitScheduledOn(habit, date)) return null;
  const entry = getEntry(state, habit.id, date);
  if (entry?.skipped) return null;
  if (!entry || entry.hasValue === false) return 0;

  if (habit.direction === 'atMost') {
    if (habit.period !== 'day') return getHabitPeriodProgress(habit, date, state).ratio;
    return entry.value <= habit.target ? 1 : clamp(habit.target / Math.max(entry.value, 1));
  }

  if (habit.period === 'day') {
    return clamp(entry.value / Math.max(habit.target, 0.0001));
  }

  if (habit.metric === 'check') return entry.value > 0 ? 1 : 0;
  return clamp(entry.value / Math.max(habit.increment, 0.0001));
}

export function getDaySnapshot(state: TrackerState, date: Date, habits = state.habits): DaySnapshot {
  const eligible = habits.filter((habit) => {
    if (!isHabitScheduledOn(habit, date)) return false;
    // Flexible weekly/monthly goals are opportunities, not seven daily obligations.
    // They enter a day's score only when the user records activity on that day.
    const entry = getEntry(state, habit.id, date);
    return habit.period === 'day' || Boolean(entry?.skipped) || hasLoggedValue(entry);
  });
  let completed = 0;
  let skipped = 0;
  let logged = 0;
  let ratioTotal = 0;
  let denominator = 0;

  eligible.forEach((habit) => {
    const entry = getEntry(state, habit.id, date);
    if (entry?.skipped) {
      skipped += 1;
      return;
    }

    denominator += 1;
    const ratio = getDayContributionRatio(habit, date, state) ?? 0;
    ratioTotal += ratio;
    if (hasLoggedValue(entry)) logged += 1;

    const progress = getHabitPeriodProgress(habit, date, state);
    if (progress.complete) completed += 1;
  });

  return {
    score: denominator ? ratioTotal / denominator : 0,
    completed,
    scheduled: denominator,
    skipped,
    logged,
  };
}

function getHabitCheckpoints(habit: Habit, state: TrackerState, endDate = new Date()) {
  const start = fromDateKey(habit.startDate);
  const today = minDate(endDate, new Date());

  if (habit.period === 'day') {
    return daysBetween(start, today).filter((date) => isHabitScheduledOn(habit, date));
  }

  if (habit.period === 'week') {
    const first = startOfWeek(start, state.profile.weekStartsOn);
    const last = startOfWeek(today, state.profile.weekStartsOn);
    const checkpoints: Date[] = [];
    for (let cursor = first; toDateKey(cursor) <= toDateKey(last); cursor = addDays(cursor, 7)) {
      if (daysBetween(cursor, addDays(cursor, 6)).every((day) => isHabitActiveOn(habit, day))) {
        checkpoints.push(cursor);
      }
    }
    return checkpoints;
  }

  const first = startOfMonth(start);
  const last = startOfMonth(today);
  const checkpoints: Date[] = [];
  for (let cursor = first; toDateKey(cursor) <= toDateKey(last); cursor = addMonths(cursor, 1)) {
    if (daysBetween(cursor, endOfMonth(cursor)).every((day) => isHabitActiveOn(habit, day))) {
      checkpoints.push(cursor);
    }
  }
  return checkpoints;
}

export function getHabitStats(habit: Habit, state: TrackerState, endDate = new Date()): HabitStats {
  const checkpoints = getHabitCheckpoints(habit, state, endDate);
  const outcomes = checkpoints.map((date) => getHabitPeriodProgress(habit, date, state));
  const currentIndex = outcomes.length - 1;
  const actualPeriod = getPeriodBounds(habit.period, new Date(), state.profile.weekStartsOn);
  const latestCheckpoint = checkpoints[currentIndex];
  const latestPeriodIsOpen = Boolean(
    latestCheckpoint
    && isHabitActiveOn(habit, new Date())
    && toDateKey(latestCheckpoint) === toDateKey(actualPeriod.start),
  );
  let currentStreak = 0;
  let bestStreak = 0;
  let running = 0;

  outcomes.forEach((outcome) => {
    if (outcome.skipped) return;
    if (outcome.complete) {
      running += 1;
      bestStreak = Math.max(bestStreak, running);
    } else {
      running = 0;
    }
  });

  for (let index = currentIndex; index >= 0; index -= 1) {
    const outcome = outcomes[index];
    if (outcome.skipped) continue;
    if (index === currentIndex && latestPeriodIsOpen && !outcome.complete) continue;
    if (!outcome.complete) break;
    currentStreak += 1;
  }

  const total = Object.values(state.entries).reduce((sum, entries) => {
    const entry = entries[habit.id];
    return hasLoggedValue(entry) ? sum + Math.max(0, entry.value || 0) : sum;
  }, 0);

  const eligible = outcomes.filter((outcome, index) => (
    !outcome.skipped
    && !(index === currentIndex && latestPeriodIsOpen && !outcome.hasEntry)
  ));
  const ratioTotal = eligible.reduce((sum, outcome) => sum + outcome.ratio, 0);

  return {
    currentStreak,
    bestStreak,
    consistency: eligible.length ? ratioTotal / eligible.length : 0,
    total,
    periods: eligible.length,
  };
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' }).format(value);
  }

  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

export function formatValue(value: number, habit: Habit) {
  if (habit.metric === 'check') {
    return `${formatNumber(value)} ${habit.unit || (value === 1 ? 'time' : 'times')}`;
  }
  return `${formatNumber(value)}${habit.unit ? ` ${habit.unit}` : ''}`;
}

export function goalLabel(habit: Habit) {
  const direction = habit.direction === 'atMost' ? '≤ ' : '';
  return `${direction}${formatValue(habit.target, habit)} / ${habit.period}`;
}

export function scheduleLabel(habit: Habit) {
  if (habit.period === 'week') return 'Flexible weekly goal';
  if (habit.period === 'month') return 'Flexible monthly goal';
  if (habit.schedule.type === 'everyday') return 'Every day';
  if (habit.schedule.type === 'interval') {
    const suffix = habit.schedule.every === 1 ? habit.schedule.unit : `${habit.schedule.unit}s`;
    return `Every ${habit.schedule.every} ${suffix}`;
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (habit.schedule.days.join(',') === '1,2,3,4,5') return 'Weekdays';
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((day) => habit.schedule.type === 'selectedDays' && habit.schedule.days.includes(day))
    .map((day) => dayNames[day])
    .join(', ');
}

export function getIntensityLevel(ratio: number) {
  if (ratio <= 0) return 0;
  if (ratio < 0.4) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 1) return 3;
  return 4;
}
