import { describe, expect, it } from 'vitest';
import { fromDateKey } from './dates';
import {
  getDayContributionRatio,
  getDaySnapshot,
  getHabitPeriodProgress,
  getHabitStats,
  isHabitActiveOn,
  isHabitScheduledOn,
} from './metrics';
import type { Habit, HabitEntry, TrackerState } from './model';
import { parseTrackerState } from './store';

const timestamp = '2026-07-01T12:00:00.000Z';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    name: 'Test habit',
    category: 'Test',
    icon: 'activity',
    color: '#b8f35b',
    metric: 'count',
    target: 10,
    unit: 'reps',
    period: 'day',
    direction: 'atLeast',
    schedule: { type: 'everyday' },
    timeSlot: 'anytime',
    increment: 2,
    startDate: '2026-07-01',
    createdAt: timestamp,
    updatedAt: timestamp,
    order: 0,
    ...overrides,
  };
}

function entry(value: number, extra: Partial<HabitEntry> = {}): HabitEntry {
  return { value, updatedAt: timestamp, ...extra };
}

function tracker(testHabit: Habit, entries: TrackerState['entries'] = {}): TrackerState {
  return {
    version: 2,
    generationId: 'test-generation',
    generationUpdatedAt: timestamp,
    generationPending: false,
    profile: { displayName: 'Harsh', weekStartsOn: 1, theme: 'dark', updatedAt: timestamp },
    habits: [testHabit],
    entries,
  };
}

describe('habit scheduling', () => {
  it('honors selected weekdays', () => {
    const testHabit = habit({ schedule: { type: 'selectedDays', days: [1, 3, 5] } });
    expect(isHabitScheduledOn(testHabit, fromDateKey('2026-07-06'))).toBe(true); // Monday
    expect(isHabitScheduledOn(testHabit, fromDateKey('2026-07-07'))).toBe(false); // Tuesday
    expect(isHabitScheduledOn(testHabit, fromDateKey('2026-07-08'))).toBe(true); // Wednesday
  });

  it('anchors interval schedules to the habit start date', () => {
    const testHabit = habit({ schedule: { type: 'interval', every: 2, unit: 'day' } });
    expect(isHabitScheduledOn(testHabit, fromDateKey('2026-07-01'))).toBe(true);
    expect(isHabitScheduledOn(testHabit, fromDateKey('2026-07-02'))).toBe(false);
    expect(isHabitScheduledOn(testHabit, fromDateKey('2026-07-03'))).toBe(true);
  });
});

describe('goal progress', () => {
  it('aggregates a flexible weekly check goal across the real week', () => {
    const testHabit = habit({ metric: 'check', target: 4, unit: 'sessions', period: 'week', increment: 1 });
    const state = tracker(testHabit, {
      '2026-07-06': { [testHabit.id]: entry(1) },
      '2026-07-08': { [testHabit.id]: entry(1) },
      '2026-07-10': { [testHabit.id]: entry(1) },
      '2026-07-12': { [testHabit.id]: entry(1) },
    });
    const progress = getHabitPeriodProgress(testHabit, fromDateKey('2026-07-09'), state);
    expect(progress.value).toBe(4);
    expect(progress.ratio).toBe(1);
    expect(progress.complete).toBe(true);
  });

  it('requires an explicit entry for stay-under goals', () => {
    const testHabit = habit({ metric: 'duration', target: 60, unit: 'min', direction: 'atMost' });
    const blank = tracker(testHabit);
    expect(getHabitPeriodProgress(testHabit, fromDateKey('2026-07-06'), blank).complete).toBe(false);

    const within = tracker(testHabit, { '2026-07-06': { [testHabit.id]: entry(45) } });
    expect(getHabitPeriodProgress(testHabit, fromDateKey('2026-07-06'), within).complete).toBe(true);

    const over = tracker(testHabit, { '2026-07-06': { [testHabit.id]: entry(90) } });
    expect(getHabitPeriodProgress(testHabit, fromDateKey('2026-07-06'), over).ratio).toBeCloseTo(2 / 3);
  });

  it('does not let a note-only entry complete a stay-under goal', () => {
    const testHabit = habit({ metric: 'duration', target: 60, unit: 'min', direction: 'atMost' });
    const state = tracker(testHabit, {
      '2026-07-06': { [testHabit.id]: entry(0, { hasValue: false, note: 'A note without a measurement' }) },
    });
    const progress = getHabitPeriodProgress(testHabit, fromDateKey('2026-07-06'), state);
    expect(progress.complete).toBe(false);
    expect(progress.skipped).toBe(false);
  });

  it('uses cumulative period progress for a flexible stay-under heatmap', () => {
    const testHabit = habit({ metric: 'duration', target: 60, unit: 'min', period: 'week', direction: 'atMost' });
    const state = tracker(testHabit, {
      '2026-07-06': { [testHabit.id]: entry(40) },
      '2026-07-07': { [testHabit.id]: entry(40) },
    });
    expect(getDayContributionRatio(testHabit, fromDateKey('2026-07-06'), state)).toBe(0.75);
    expect(getDayContributionRatio(testHabit, fromDateKey('2026-07-07'), state)).toBe(0.75);
    expect(getHabitPeriodProgress(testHabit, fromDateKey('2026-07-07'), state).complete).toBe(false);

    const closedState = tracker(testHabit, {
      '2026-06-29': { [testHabit.id]: entry(40) },
      '2026-07-01': { [testHabit.id]: entry(10) },
    });
    expect(getHabitPeriodProgress(testHabit, fromDateKey('2026-07-01'), closedState).complete).toBe(true);
  });

  it('normalizes flexible-goal heatmap activity by the quick increment', () => {
    const testHabit = habit({ target: 100, period: 'week', increment: 20 });
    const state = tracker(testHabit, { '2026-07-06': { [testHabit.id]: entry(10) } });
    expect(getDayContributionRatio(testHabit, fromDateKey('2026-07-06'), state)).toBe(0.5);
  });

  it('does not treat a flexible weekly rest day as a failed daily obligation', () => {
    const daily = habit({ id: 'daily', target: 10 });
    const flexible = habit({ id: 'flexible', target: 4, period: 'week', metric: 'check', unit: 'sessions', increment: 1 });
    const state: TrackerState = {
      ...tracker(daily),
      habits: [daily, flexible],
      entries: { '2026-07-06': { daily: entry(10) } },
    };
    expect(getDaySnapshot(state, fromDateKey('2026-07-06')).score).toBe(1);
    expect(getDaySnapshot(state, fromDateKey('2026-07-06')).scheduled).toBe(1);
  });

  it('excludes intentional skips from the daily denominator', () => {
    const first = habit({ id: 'first' });
    const second = habit({ id: 'second' });
    const state: TrackerState = {
      ...tracker(first),
      habits: [first, second],
      entries: {
        '2026-07-06': {
          first: entry(10),
          second: entry(0, { skipped: true }),
        },
      },
    };
    expect(getDaySnapshot(state, fromDateKey('2026-07-06')).score).toBe(1);
    expect(getDaySnapshot(state, fromDateKey('2026-07-06')).scheduled).toBe(1);
    expect(getDaySnapshot(state, fromDateKey('2026-07-06')).skipped).toBe(1);
  });

  it('does not let one day-level skip waive a flexible weekly goal', () => {
    const testHabit = habit({ metric: 'check', target: 2, unit: 'sessions', period: 'week', increment: 1 });
    const state = tracker(testHabit, {
      '2026-07-06': { [testHabit.id]: entry(0, { hasValue: false, skipped: true }) },
    });
    const progress = getHabitPeriodProgress(testHabit, fromDateKey('2026-07-08'), state);
    expect(progress.skipped).toBe(false);
    expect(progress.complete).toBe(false);
  });
});

describe('period-aware streaks', () => {
  it('ignores unscheduled weekend days for a weekday habit', () => {
    const testHabit = habit({ target: 1, schedule: { type: 'selectedDays', days: [1, 2, 3, 4, 5] }, startDate: '2026-07-06' });
    const state = tracker(testHabit, {
      '2026-07-06': { [testHabit.id]: entry(1) },
      '2026-07-07': { [testHabit.id]: entry(1) },
      '2026-07-08': { [testHabit.id]: entry(1) },
      '2026-07-09': { [testHabit.id]: entry(1) },
      '2026-07-10': { [testHabit.id]: entry(1) },
    });
    const stats = getHabitStats(testHabit, state, fromDateKey('2026-07-13'));
    expect(stats.currentStreak).toBe(5);
    expect(stats.bestStreak).toBe(5);
  });

  it('counts weekly goals as weekly streaks and leaves an open week unpenalized', () => {
    const testHabit = habit({ metric: 'check', target: 2, unit: 'sessions', period: 'week', increment: 1, startDate: '2026-06-29' });
    const state = tracker(testHabit, {
      '2026-06-29': { [testHabit.id]: entry(1) },
      '2026-07-01': { [testHabit.id]: entry(1) },
      '2026-07-06': { [testHabit.id]: entry(1) },
      '2026-07-09': { [testHabit.id]: entry(1) },
    });
    const stats = getHabitStats(testHabit, state, fromDateKey('2026-07-13'));
    expect(stats.currentStreak).toBe(2);
    expect(stats.bestStreak).toBe(2);
  });

  it('does not give a closed historical period the current-period grace', () => {
    const testHabit = habit({ target: 1, startDate: '2026-07-01' });
    const state = tracker(testHabit, {
      '2026-07-01': { [testHabit.id]: entry(1) },
      '2026-07-02': { [testHabit.id]: entry(1) },
    });
    expect(getHabitStats(testHabit, state, fromDateKey('2026-07-03')).currentStreak).toBe(0);
  });

  it('lets a mid-week create collect activity without later counting as a miss', () => {
    // Week of Jun 29–Jul 5 is shortened; next full week is complete.
    const testHabit = habit({
      metric: 'check',
      target: 2,
      unit: 'sessions',
      period: 'week',
      increment: 1,
      startDate: '2026-07-01',
    });
    const state = tracker(testHabit, {
      '2026-07-01': { [testHabit.id]: entry(1) },
      '2026-07-03': { [testHabit.id]: entry(1) },
      '2026-07-06': { [testHabit.id]: entry(1) },
      '2026-07-09': { [testHabit.id]: entry(1) },
    });

    const ramp = getHabitPeriodProgress(testHabit, fromDateKey('2026-07-02'), state);
    expect(ramp.value).toBe(2);
    expect(ramp.complete).toBe(true);
    expect(ramp.eligible).toBe(false);

    const stats = getHabitStats(testHabit, state, fromDateKey('2026-07-13'));
    expect(stats.currentStreak).toBe(1);
    expect(stats.bestStreak).toBe(1);
    expect(stats.periods).toBe(1);
  });

  it('lets a mid-month pause keep logged activity without turning the month into a miss', () => {
    const testHabit = habit({
      metric: 'check',
      target: 3,
      unit: 'sessions',
      period: 'month',
      increment: 1,
      startDate: '2026-05-01',
      pauses: [{ start: '2026-06-10', end: '2026-06-20' }],
    });
    const state = tracker(testHabit, {
      '2026-05-04': { [testHabit.id]: entry(1) },
      '2026-05-12': { [testHabit.id]: entry(1) },
      '2026-05-20': { [testHabit.id]: entry(1) },
      '2026-06-02': { [testHabit.id]: entry(1) },
      '2026-06-22': { [testHabit.id]: entry(1) },
    });

    const pausedMonth = getHabitPeriodProgress(testHabit, fromDateKey('2026-06-15'), state);
    expect(pausedMonth.value).toBe(2);
    expect(pausedMonth.eligible).toBe(false);
    expect(pausedMonth.complete).toBe(false);

    const stats = getHabitStats(testHabit, state, fromDateKey('2026-07-05'));
    // May counted; June was shortened by the pause so it never became a miss;
    // the open July period is ignored until it closes.
    expect(stats.currentStreak).toBe(1);
    expect(stats.bestStreak).toBe(1);
    expect(stats.periods).toBe(1);
  });
});

describe('pause history and imports', () => {
  it('excludes a pause but resumes on its exclusive end date', () => {
    const testHabit = habit({ pauses: [{ start: '2026-07-05', end: '2026-07-08' }] });
    expect(isHabitActiveOn(testHabit, fromDateKey('2026-07-04'))).toBe(true);
    expect(isHabitActiveOn(testHabit, fromDateKey('2026-07-05'))).toBe(false);
    expect(isHabitActiveOn(testHabit, fromDateKey('2026-07-07'))).toBe(false);
    expect(isHabitActiveOn(testHabit, fromDateKey('2026-07-08'))).toBe(true);
  });

  it('rejects malformed habit schedules before replacing local data', () => {
    const testHabit = habit();
    const malformed: unknown = {
      ...tracker(testHabit),
      habits: [{ ...testHabit, schedule: { type: 'selectedDays', days: [] } }],
    };
    expect(() => parseTrackerState(malformed)).toThrow(/selected days/i);
  });
});
