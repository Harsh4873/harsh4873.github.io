import { ArrowDownRight, ArrowUpRight, CalendarDays, Flame, MousePointer2 } from 'lucide-react';
import { addDays, formatDateRange, getWeekDays, isAfterDate, isSameDate, startOfWeek, toDateKey } from '../dates';
import {
  formatValue,
  getDayContributionRatio,
  getDaySnapshot,
  getEntry,
  getHabitPeriodProgress,
  getIntensityLevel,
  isHabitActiveOn,
  isHabitScheduledOn,
} from '../metrics';
import type { Habit, TrackerState } from '../model';
import { DateSwitcher, HabitBadge, MetricCard, ProgressBar, SectionHeading, habitStyle } from '../ui';

interface WeekViewProps {
  state: TrackerState;
  habits: Habit[];
  date: Date;
  setDate: (date: Date) => void;
  openDay: (date: Date) => void;
}

function weekResult(habit: Habit, days: Date[], state: TrackerState) {
  const today = new Date();
  if (habit.period === 'day') {
    const due = days.filter((day) => isHabitScheduledOn(habit, day) && !isAfterDate(day, today));
    const progress = due.map((day) => getHabitPeriodProgress(habit, day, state)).filter((item) => !item.skipped);
    const completed = progress.filter((item) => item.complete).length;
    const ratio = progress.length ? progress.reduce((sum, item) => sum + item.ratio, 0) / progress.length : 0;
    return { ratio, label: `${completed}/${progress.length} days`, completed, due: progress.length };
  }

  const periodMap = new Map<string, ReturnType<typeof getHabitPeriodProgress>>();
  days.forEach((day) => {
    if (isAfterDate(day, today) || !isHabitScheduledOn(habit, day)) return;
    const progress = getHabitPeriodProgress(habit, day, state);
    periodMap.set(toDateKey(progress.start), progress);
  });
  const periods = [...periodMap.values()].filter((progress) => progress.eligible);
  if (periods.length > 1) {
    const ratio = periods.reduce((sum, progress) => sum + progress.ratio, 0) / periods.length;
    const completed = periods.filter((progress) => progress.complete).length;
    return {
      ratio,
      label: `${completed}/${periods.length} ${habit.period}s met`,
      completed,
      due: periods.length,
    };
  }
  if (!periods.length) {
    const progress = getHabitPeriodProgress(habit, days.find((day) => isHabitScheduledOn(habit, day)) ?? days[0], state);
    return { ratio: progress.ratio, label: 'Ramp-up period', completed: 0, due: 0 };
  }
  const progress = periods[0];
  return {
    ratio: progress.ratio,
    label: `${formatValue(progress.value, habit)} of ${formatValue(progress.target, habit)}`,
    completed: progress.complete ? 1 : 0,
    due: 1,
  };
}

function averageWeekScore(state: TrackerState, habits: Habit[], days: Date[]) {
  const today = new Date();
  const elapsed = days
    .filter((day) => !isAfterDate(day, today))
    .map((day) => getDaySnapshot(state, day, habits))
    .filter((snapshot) => snapshot.scheduled > 0);
  if (!elapsed.length) return 0;
  return elapsed.reduce((sum, snapshot) => sum + snapshot.score, 0) / elapsed.length;
}

export function WeekView({ state, habits, date, setDate, openDay }: WeekViewProps) {
  const weekDays = getWeekDays(date, state.profile.weekStartsOn);
  const visibleHabits = habits.filter((habit) => weekDays.some((day) => isHabitActiveOn(habit, day)));
  const previousDays = weekDays.map((day) => addDays(day, -7));
  const score = averageWeekScore(state, visibleHabits, weekDays);
  const previousScore = averageWeekScore(state, visibleHabits, previousDays);
  const change = score - previousScore;
  const daySnapshots = weekDays.map((day) => ({ day, snapshot: getDaySnapshot(state, day, visibleHabits) }));
  const elapsedSnapshots = daySnapshots.filter(({ day }) => !isAfterDate(day, new Date()));
  const strongest = [...elapsedSnapshots].sort((left, right) => right.snapshot.score - left.snapshot.score)[0];
  const activeDays = elapsedSnapshots.filter(({ snapshot }) => snapshot.logged > 0).length;
  const periodStart = startOfWeek(new Date(), state.profile.weekStartsOn);
  const currentWeek = isSameDate(weekDays[0], periodStart);

  return (
    <div className="view-shell review-view week-view">
      <SectionHeading
        eyebrow="Weekly review"
        title="See the rhythm, not just the streak."
        copy="Daily goals show adherence across the week. Flexible goals keep their real weekly or monthly target."
      />

      <DateSwitcher
        eyebrow="Seven-day window"
        label={formatDateRange(weekDays[0], weekDays[6])}
        onPrevious={() => setDate(addDays(date, -7))}
        onNext={() => setDate(addDays(date, 7))}
        nextDisabled={currentWeek}
        onToday={currentWeek ? undefined : () => setDate(new Date())}
      />

      <section className="metric-grid metric-grid-four" aria-label="Weekly summary">
        <MetricCard label="Week score" value={`${Math.round(score * 100)}%`} detail="normalized across unlike units" accent />
        <MetricCard label="Active days" value={`${activeDays}/7`} detail="days with at least one log" />
        <MetricCard
          label="Change"
          value={`${change >= 0 ? '+' : ''}${Math.round(change * 100)} pts`}
          detail="versus the previous week"
        />
        <MetricCard
          label="Strongest day"
          value={strongest ? strongest.day.toLocaleDateString('en-US', { weekday: 'long' }) : '—'}
          detail={strongest ? `${Math.round(strongest.snapshot.score * 100)}% day score` : 'start logging to reveal it'}
        />
      </section>

      <section className="panel week-matrix-panel">
        <div className="panel-heading">
          <div>
            <span>Habit × day</span>
            <h2>Your week at a glance</h2>
          </div>
          <p><MousePointer2 aria-hidden="true" /> Select any cell to edit that day.</p>
        </div>

        <div className="week-matrix-scroll">
          <div className="week-matrix" style={{ '--day-count': weekDays.length } as React.CSSProperties}>
            <div className="week-matrix-corner">Habit</div>
            {weekDays.map((day) => (
              <div className={isTodayInMatrix(day) ? 'matrix-day is-today' : 'matrix-day'} key={day.toISOString()}>
                <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <strong>{day.getDate()}</strong>
              </div>
            ))}
            <div className="matrix-progress-heading">Week</div>

            {visibleHabits.map((habit) => {
              const result = weekResult(habit, weekDays, state);
              return (
                <div className="matrix-row-contents" key={habit.id} style={habitStyle(habit)}>
                  <div className="matrix-habit">
                    <HabitBadge habit={habit} />
                    <span><strong>{habit.name}</strong><small>{habit.category}</small></span>
                  </div>
                  {weekDays.map((day) => {
                    const ratio = getDayContributionRatio(habit, day, state);
                    const entry = getEntry(state, habit.id, day);
                    const future = isAfterDate(day, new Date());
                    const off = ratio === null && !entry?.skipped;
                    const level = getIntensityLevel(ratio ?? 0);
                    const label = off
                      ? `${habit.name} is off schedule on ${day.toLocaleDateString()}`
                      : entry?.skipped
                        ? `${habit.name} was skipped on ${day.toLocaleDateString()}`
                        : `${habit.name}, ${Math.round((ratio ?? 0) * 100)} percent on ${day.toLocaleDateString()}`;
                    return (
                      <button
                        type="button"
                        className={`matrix-cell level-${level}${off ? ' is-off' : ''}${entry?.skipped ? ' is-skipped' : ''}`}
                        key={day.toISOString()}
                        onClick={() => openDay(day)}
                        disabled={future}
                        aria-label={label}
                        title={label}
                      >
                        <span aria-hidden="true">{entry?.skipped ? '–' : ratio && ratio >= 1 ? '✓' : ''}</span>
                      </button>
                    );
                  })}
                  <div className="matrix-progress">
                    <span><strong>{result.label}</strong><small>{Math.round(result.ratio * 100)}%</small></span>
                    <ProgressBar value={result.ratio} color={habit.color} label={`${habit.name} weekly progress`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="weekly-readout-grid">
        <article className="panel signal-card">
          <span className="signal-icon"><Flame aria-hidden="true" /></span>
          <div>
            <span>Momentum signal</span>
            <h3>{score >= 0.8 ? 'The routine is carrying itself.' : score >= 0.5 ? 'The week has a pulse.' : 'Build one repeatable anchor.'}</h3>
            <p>{score >= 0.8 ? 'Protect what is already working.' : 'A modest repeatable action is more useful than a heroic catch-up day.'}</p>
          </div>
        </article>
        <article className="panel signal-card">
          <span className="signal-icon signal-icon-alt">{change >= 0 ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}</span>
          <div>
            <span>Week over week</span>
            <h3>{change >= 0 ? 'Consistency is moving up.' : 'The signal softened a little.'}</h3>
            <p>{previousScore === 0 ? 'The prior week has no signal yet.' : `${Math.abs(Math.round(change * 100))} percentage points ${change >= 0 ? 'ahead of' : 'behind'} the prior week.`}</p>
          </div>
        </article>
      </section>
    </div>
  );
}

function isTodayInMatrix(date: Date) {
  return isSameDate(date, new Date());
}
