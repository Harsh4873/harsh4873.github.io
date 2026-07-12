import { CalendarCheck2, CircleDot, Layers3 } from 'lucide-react';
import {
  addMonths,
  daysBetween,
  endOfMonth,
  formatMonthYear,
  getMonthGrid,
  isAfterDate,
  isSameDate,
  startOfMonth,
  toDateKey,
} from '../dates';
import {
  getDaySnapshot,
  getEntry,
  getHabitPeriodProgress,
  getIntensityLevel,
  isHabitActiveOn,
  isHabitScheduledOn,
} from '../metrics';
import type { Habit, TrackerState } from '../model';
import { DateSwitcher, HabitBadge, MetricCard, ProgressBar, SectionHeading, habitStyle } from '../ui';

interface MonthViewProps {
  state: TrackerState;
  habits: Habit[];
  date: Date;
  setDate: (date: Date) => void;
  openDay: (date: Date) => void;
}

function getMonthHabitResult(habit: Habit, days: Date[], state: TrackerState) {
  const periodMap = new Map<string, ReturnType<typeof getHabitPeriodProgress>>();
  days.forEach((day) => {
    if (isAfterDate(day, new Date()) || !isHabitScheduledOn(habit, day)) return;
    const progress = getHabitPeriodProgress(habit, day, state);
    periodMap.set(toDateKey(progress.start), progress);
  });
  const periods = [...periodMap.values()].filter((period) => !period.skipped && period.eligible);
  const ratio = periods.length ? periods.reduce((sum, item) => sum + item.ratio, 0) / periods.length : 0;
  const complete = periods.filter((item) => item.complete).length;
  return { ratio, complete, periods: periods.length };
}

export function MonthView({ state, habits, date, setDate, openDay }: MonthViewProps) {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const calendarDays = getMonthGrid(date, state.profile.weekStartsOn);
  const actualDays = daysBetween(monthStart, monthEnd).filter((day) => !isAfterDate(day, new Date()));
  const visibleHabits = habits.filter((habit) => actualDays.some((day) => isHabitActiveOn(habit, day)));
  const snapshots = actualDays.map((day) => ({ day, snapshot: getDaySnapshot(state, day, visibleHabits) }));
  const scoredSnapshots = snapshots.filter((item) => item.snapshot.scheduled > 0);
  const monthScore = scoredSnapshots.length
    ? scoredSnapshots.reduce((sum, item) => sum + item.snapshot.score, 0) / scoredSnapshots.length
    : 0;
  const activeDays = snapshots.filter((item) => item.snapshot.logged > 0).length;
  const perfectDays = snapshots.filter((item) => item.snapshot.scheduled > 0 && item.snapshot.score >= 0.999).length;
  const totalLogs = snapshots.reduce((sum, item) => sum + item.snapshot.logged, 0);
  const categories = [...new Set(visibleHabits.map((habit) => habit.category))];
  const currentMonth = date.getFullYear() === new Date().getFullYear() && date.getMonth() === new Date().getMonth();
  const weekLabels = state.profile.weekStartsOn === 1
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const categoryRows = categories.map((category) => {
    const categoryHabits = visibleHabits.filter((habit) => habit.category === category);
    const values = actualDays
      .map((day) => getDaySnapshot(state, day, categoryHabits))
      .filter((snapshot) => snapshot.scheduled > 0)
      .map((snapshot) => snapshot.score);
    return {
      category,
      value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
      color: categoryHabits[0]?.color ?? '#b8f35b',
      count: categoryHabits.length,
    };
  }).sort((left, right) => right.value - left.value);

  return (
    <div className="view-shell review-view month-view">
      <SectionHeading
        eyebrow="Monthly review"
        title="Patterns become visible at this distance."
        copy="The calendar blends unlike habits into a normalized day score, while the side panels keep each goal honest."
      />

      <DateSwitcher
        eyebrow="Calendar month"
        label={formatMonthYear(date)}
        onPrevious={() => setDate(addMonths(date, -1))}
        onNext={() => setDate(addMonths(date, 1))}
        nextDisabled={currentMonth}
        onToday={currentMonth ? undefined : () => setDate(new Date())}
      />

      <section className="metric-grid metric-grid-four" aria-label="Monthly summary">
        <MetricCard label="Month score" value={`${Math.round(monthScore * 100)}%`} detail="average normalized day" accent />
        <MetricCard label="Active days" value={activeDays} detail={`of ${actualDays.length} elapsed days`} />
        <MetricCard label="Perfect days" value={perfectDays} detail="every scheduled goal met" />
        <MetricCard label="Check-ins" value={totalLogs} detail="individual habit entries" />
      </section>

      <div className="month-layout">
        <section className="panel month-calendar-panel">
          <div className="panel-heading">
            <div><span>Day score calendar</span><h2>{formatMonthYear(date)}</h2></div>
            <p><CalendarCheck2 aria-hidden="true" /> Select a day to review or backfill.</p>
          </div>

          <div className="month-week-labels" aria-hidden="true">
            {weekLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="month-calendar">
            {calendarDays.map((day) => {
              const outside = day.getMonth() !== date.getMonth();
              const future = isAfterDate(day, new Date());
              const snapshot = getDaySnapshot(state, day, visibleHabits);
              const level = getIntensityLevel(snapshot.score);
              const loggedHabits = visibleHabits.filter((habit) => Boolean(getEntry(state, habit.id, day))).slice(0, 4);
              const label = `${day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}: ${snapshot.logged} logs, ${Math.round(snapshot.score * 100)} percent day score`;
              return (
                <button
                  type="button"
                  className={`month-day level-${level}${outside ? ' is-outside' : ''}${future ? ' is-future' : ''}${isSameDate(day, new Date()) ? ' is-today' : ''}`}
                  key={toDateKey(day)}
                  onClick={() => openDay(day)}
                  disabled={future}
                  aria-label={label}
                >
                  <span className="month-day-number">{day.getDate()}</span>
                  <span className="month-day-score">{snapshot.scheduled ? `${Math.round(snapshot.score * 100)}%` : 'rest'}</span>
                  <span className="month-day-dots" aria-hidden="true">
                    {loggedHabits.map((habit) => <i key={habit.id} style={{ background: habit.color }} />)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="month-side-stack">
          <section className="panel category-panel">
            <div className="panel-heading compact">
              <div><span>Category balance</span><h2>Where the energy went</h2></div>
              <Layers3 aria-hidden="true" />
            </div>
            <div className="category-list">
              {categoryRows.map((row) => (
                <div className="category-row" key={row.category}>
                  <div><span><i style={{ background: row.color }} />{row.category}</span><strong>{Math.round(row.value * 100)}%</strong></div>
                  <ProgressBar value={row.value} color={row.color} label={`${row.category} monthly balance`} />
                  <small>{row.count} {row.count === 1 ? 'habit' : 'habits'}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="panel month-note-card">
            <CircleDot aria-hidden="true" />
            <span>Read the quiet days, too</span>
            <h3>Blank is not the same as failed.</h3>
            <p>Future days, rest days, skipped goals, and days with no entry remain distinct in the record.</p>
          </section>
        </aside>
      </div>

      <section className="panel habit-month-panel">
        <div className="panel-heading">
          <div><span>Goal review</span><h2>Habit by habit</h2></div>
          <p>Completion is judged in each habit’s real goal period.</p>
        </div>
        <div className="habit-month-list">
          {visibleHabits.map((habit) => {
            const result = getMonthHabitResult(habit, actualDays, state);
            return (
              <article key={habit.id} style={habitStyle(habit)}>
                <HabitBadge habit={habit} />
                <div className="habit-month-copy">
                  <span><strong>{habit.name}</strong><small>{habit.category} · {habit.period} goal</small></span>
                  <ProgressBar value={result.ratio} color={habit.color} label={`${habit.name} monthly goal completion`} />
                </div>
                <div className="habit-month-value">
                  <strong>{Math.round(result.ratio * 100)}%</strong>
                  <small>{result.complete}/{result.periods} periods met</small>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
