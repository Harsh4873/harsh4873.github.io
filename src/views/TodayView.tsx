import {
  Check,
  CheckCircle2,
  CircleDashed,
  Minus,
  NotebookPen,
  Plus,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, formatFullDate, isSameDate, isToday, toDateKey } from '../dates';
import {
  formatValue,
  getDaySnapshot,
  getEntry,
  getHabitPeriodProgress,
  getHabitStats,
  hasLoggedValue,
  isHabitScheduledOn,
  scheduleLabel,
} from '../metrics';
import type { Habit, TimeSlot, TrackerState } from '../model';
import type { TrackerStore } from '../store';
import {
  DateSwitcher,
  EmptyState,
  GoalLabel,
  HabitBadge,
  ProgressBar,
  ProgressRing,
  habitStyle,
} from '../ui';

type EntryActions = Pick<
  TrackerStore,
  'setEntryValue' | 'incrementEntry' | 'toggleCheck' | 'toggleSkip' | 'setEntryNote'
>;

interface TodayViewProps extends EntryActions {
  state: TrackerState;
  habits: Habit[];
  date: Date;
  setDate: (date: Date) => void;
  onManageHabits: () => void;
}

const SLOT_LABELS: Record<TimeSlot, { label: string; note: string }> = {
  morning: { label: 'Morning', note: 'Start with intention' },
  anytime: { label: 'Anytime', note: 'Fit these into the day' },
  evening: { label: 'Evening', note: 'Close the loop' },
};

function HabitCheckIn({
  habit,
  date,
  state,
  setEntryValue,
  incrementEntry,
  toggleCheck,
  toggleSkip,
  setEntryNote,
}: {
  habit: Habit;
  date: Date;
  state: TrackerState;
} & EntryActions) {
  const [noteOpen, setNoteOpen] = useState(false);
  const dateKey = toDateKey(date);
  const entry = getEntry(state, habit.id, date);
  const progress = getHabitPeriodProgress(habit, date, state);
  const dayChecked = Boolean(entry && !entry.skipped && entry.value > 0);
  const displayValue = habit.period === 'day' ? entry?.value ?? 0 : progress.value;
  const status = entry?.skipped
    ? habit.period === 'day'
      ? 'Skipped — excluded from consistency'
      : `Skipped for this day — the ${habit.period} goal remains active`
    : !progress.eligible && habit.period !== 'day'
      ? `Ramp-up ${habit.period} — activity counts, consistency does not`
    : habit.direction === 'atMost' && progress.hasEntry && progress.value <= habit.target && habit.period !== 'day'
      ? `Within the ${habit.period} limit so far`
    : progress.complete
      ? habit.period === 'day'
        ? 'Goal met for this day'
        : `Goal met for this ${habit.period}`
      : hasLoggedValue(entry)
        ? `${Math.round(progress.ratio * 100)}% toward the ${habit.period} goal`
        : entry?.note
          ? 'Note saved — no value logged yet'
        : habit.direction === 'atMost'
          ? 'Log the actual amount to close the day'
          : 'No entry yet';

  return (
    <article
      className={`checkin-card${progress.complete ? ' is-complete' : ''}${entry?.skipped ? ' is-skipped' : ''}`}
      style={habitStyle(habit)}
    >
      <div className="checkin-main">
        <HabitBadge habit={habit} />
        <div className="checkin-copy">
          <div className="checkin-title-row">
            <div>
              <h3>{habit.name}</h3>
              <span>{habit.category} · {scheduleLabel(habit)}</span>
            </div>
            <GoalLabel habit={habit} />
          </div>
          <ProgressBar value={progress.ratio} color={habit.color} label={`${habit.name}: ${Math.round(progress.ratio * 100)} percent of goal`} />
          <div className="checkin-status">
            <span>{status}</span>
            <strong>{formatValue(displayValue, habit)}</strong>
          </div>
        </div>
      </div>

      <div className="checkin-actions">
        {habit.metric === 'check' ? (
          <button
            type="button"
            className={dayChecked ? 'check-button checked' : 'check-button'}
            onClick={() => toggleCheck(habit.id, dateKey)}
            aria-label={dayChecked ? `Undo ${habit.name} for this day` : `Mark ${habit.name} for this day`}
          >
            {dayChecked ? <Check aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
            <span>{dayChecked ? 'Logged' : 'Mark done'}</span>
          </button>
        ) : (
          <div className="value-stepper" aria-label={`Log ${habit.name}`}>
            <button
              type="button"
              onClick={() => incrementEntry(habit.id, dateKey, -habit.increment)}
              aria-label={`Subtract ${habit.increment} ${habit.unit}`}
            >
              <Minus aria-hidden="true" />
            </button>
            <label>
              <span className="sr-only">{habit.name} value in {habit.unit}</span>
              <input
                type="number"
                min="0"
                step="any"
                value={entry?.skipped ? 0 : entry?.value ?? 0}
                onChange={(event) => setEntryValue(habit.id, dateKey, Number(event.target.value))}
              />
              <small>{habit.unit}</small>
            </label>
            <button
              type="button"
              onClick={() => incrementEntry(habit.id, dateKey, habit.increment)}
              aria-label={`Add ${habit.increment} ${habit.unit}`}
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
        )}

        <button
          type="button"
          className={noteOpen || entry?.note ? 'quiet-action active' : 'quiet-action'}
          onClick={() => setNoteOpen((open) => !open)}
          aria-expanded={noteOpen}
        >
          <NotebookPen aria-hidden="true" />
          <span>Note</span>
        </button>
        <button
          type="button"
          className={entry?.skipped ? 'quiet-action active' : 'quiet-action'}
          onClick={() => toggleSkip(habit.id, dateKey)}
        >
          <SkipForward aria-hidden="true" />
          <span>{entry?.skipped ? 'Unskip' : 'Skip'}</span>
        </button>
      </div>

      {noteOpen && (
        <label className="entry-note">
          <span>Day note</span>
          <textarea
            value={entry?.note ?? ''}
            onChange={(event) => setEntryNote(habit.id, dateKey, event.target.value)}
            placeholder="A cue, win, obstacle, or detail worth remembering…"
            rows={2}
          />
        </label>
      )}
    </article>
  );
}

export function TodayView({
  state,
  habits,
  date,
  setDate,
  onManageHabits,
  ...actions
}: TodayViewProps) {
  const eligible = habits.filter((habit) => isHabitScheduledOn(habit, date));
  const snapshot = getDaySnapshot(state, date, habits);
  const dateIsToday = isToday(date);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const title = dateIsToday
    ? `${greeting}, ${state.profile.displayName || 'Harsh'}.`
    : `A look back at ${date.toLocaleDateString('en-US', { weekday: 'long' })}.`;
  const activeStats = useMemo(
    () => habits.map((habit) => ({ habit, stats: getHabitStats(habit, state, date) })),
    [habits, state, date],
  );
  const leading = [...activeStats].sort((left, right) => right.stats.currentStreak - left.stats.currentStreak)[0];

  return (
    <div className="view-shell today-view">
      <section className="today-hero">
        <div className="today-intro">
          <span className="view-kicker">Daily field note · {formatFullDate(date)}</span>
          <h1 tabIndex={-1}>{title}</h1>
          <p>
            {dateIsToday
              ? 'Log the real day—not the perfect one. Partial progress still leaves a useful signal.'
              : 'Past days stay editable, so the record can match what actually happened.'}
          </p>
          <DateSwitcher
            eyebrow="Selected day"
            label={dateIsToday ? 'Today' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            onPrevious={() => setDate(addDays(date, -1))}
            onNext={() => setDate(addDays(date, 1))}
            nextDisabled={dateIsToday}
            onToday={dateIsToday ? undefined : () => setDate(new Date())}
          />
        </div>

        <div className="today-score-card">
          <ProgressRing value={snapshot.score}>
            <strong>{Math.round(snapshot.score * 100)}%</strong>
            <span>day score</span>
          </ProgressRing>
          <div>
            <span>{dateIsToday ? 'Today’s signal' : 'Day signal'}</span>
            <strong>{snapshot.logged} of {eligible.length}</strong>
            <p>habits have an entry</p>
          </div>
          <div className="score-card-foot">
            <Sparkles aria-hidden="true" />
            <span>
              {leading && leading.stats.currentStreak > 0
                ? `${leading.habit.name} leads with a ${leading.stats.currentStreak}-${leading.habit.period} streak.`
                : 'The first honest check-in is enough to start the pattern.'}
            </span>
          </div>
        </div>
      </section>

      <section className="daily-status-strip" aria-label="Daily status">
        <div><CheckCircle2 aria-hidden="true" /><span><strong>{snapshot.completed}</strong> goals met</span></div>
        <div><NotebookPen aria-hidden="true" /><span><strong>{snapshot.logged}</strong> logged</span></div>
        <div><SkipForward aria-hidden="true" /><span><strong>{snapshot.skipped}</strong> intentionally skipped</span></div>
      </section>

      {eligible.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 aria-hidden="true" />}
          title="Nothing scheduled here"
          copy="This is a rest day—or your habit list is ready for a new rhythm."
          action={<button type="button" className="button button-primary" onClick={onManageHabits}>Manage habits</button>}
        />
      ) : (
        (['morning', 'anytime', 'evening'] as TimeSlot[]).map((slot) => {
          const slotHabits = eligible.filter((habit) => habit.timeSlot === slot);
          if (!slotHabits.length) return null;
          return (
            <section className="checkin-section" key={slot}>
              <div className="slot-heading">
                <h2>{SLOT_LABELS[slot].label}</h2>
                <p>{SLOT_LABELS[slot].note}</p>
                <small>{slotHabits.length} {slotHabits.length === 1 ? 'habit' : 'habits'}</small>
              </div>
              <div className="checkin-list">
                {slotHabits.map((habit) => (
                  <HabitCheckIn key={`${habit.id}-${toDateKey(date)}`} habit={habit} date={date} state={state} {...actions} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
