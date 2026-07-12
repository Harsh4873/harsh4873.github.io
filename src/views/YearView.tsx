import { Award, CalendarRange, ChevronLeft, ChevronRight, Flame, Info, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  addYears,
  formatCompactDate,
  formatDateRange,
  fromDateKey,
  getRollingHeatmapDays,
  isAfterDate,
  isSameDate,
  toDateKey,
} from '../dates';
import {
  getDayContributionRatio,
  getDaySnapshot,
  getEntry,
  getHabitStats,
  getIntensityLevel,
  isHabitActiveOn,
} from '../metrics';
import type { Habit, TrackerState } from '../model';
import { EmptyState, HabitBadge, MetricCard, SectionHeading, habitStyle } from '../ui';

type HeatStyle = CSSProperties & { '--heat-color': string };

interface YearViewProps {
  state: TrackerState;
  habits: Habit[];
  date: Date;
  setDate: (date: Date) => void;
  openDay: (date: Date) => void;
}

export function YearView({ state, habits, date, setDate, openDay }: YearViewProps) {
  const [filter, setFilter] = useState('all');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const heatmapScroll = useRef<HTMLDivElement>(null);
  const days = useMemo(
    () => getRollingHeatmapDays(date, state.profile.weekStartsOn),
    [date, state.profile.weekStartsOn],
  );
  const weeks = Array.from({ length: 53 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const historicalHabits = habits.filter((habit) => days.some((day) => isHabitActiveOn(habit, day)));
  const categories = [...new Set(historicalHabits.map((habit) => habit.category))];
  const filteredHabits = filter === 'all'
    ? historicalHabits
    : filter.startsWith('category:')
      ? historicalHabits.filter((habit) => habit.category === filter.slice('category:'.length))
      : historicalHabits.filter((habit) => habit.id === filter.slice('habit:'.length));
  const heatColor = filteredHabits[0]?.color ?? '#b8f35b';
  const todayKey = toDateKey(new Date());
  const today = fromDateKey(todayKey);
  const currentWindow = date.getFullYear() === today.getFullYear();

  useEffect(() => {
    const element = heatmapScroll.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [days]);

  useEffect(() => {
    const insideWindow = toDateKey(selectedDate) >= toDateKey(days[0]) && toDateKey(selectedDate) <= toDateKey(days[days.length - 1]);
    if (!insideWindow) setSelectedDate(isAfterDate(date, today) ? today : date);
  }, [date, days, selectedDate, todayKey]);

  function ratioForDay(day: Date) {
    if (!filteredHabits.length) return 0;
    if (filteredHabits.length === 1 && filter.startsWith('habit:')) {
      return getDayContributionRatio(filteredHabits[0], day, state) ?? 0;
    }
    return getDaySnapshot(state, day, filteredHabits).score;
  }

  const elapsed = days.filter((day) => !isAfterDate(day, today));
  const dayData = elapsed.map((day) => ({ day, snapshot: getDaySnapshot(state, day, filteredHabits), ratio: ratioForDay(day) }));
  const activeDays = dayData.filter((item) => item.snapshot.logged > 0).length;
  const perfectDays = dayData.filter((item) => item.snapshot.scheduled > 0 && item.ratio >= 0.999).length;
  const scoredDays = dayData.filter((item) => item.snapshot.scheduled > 0);
  const average = scoredDays.length ? scoredDays.reduce((sum, item) => sum + item.ratio, 0) / scoredDays.length : 0;
  const habitStats = filteredHabits.map((habit) => ({ habit, stats: getHabitStats(habit, state, date) }));
  const strongest = [...habitStats].sort((left, right) => right.stats.consistency - left.stats.consistency)[0];
  const longestStreak = habitStats.reduce((best, item) => Math.max(best, item.stats.bestStreak), 0);
  const selectedHabits = filteredHabits.filter((habit) => getEntry(state, habit.id, selectedDate));
  const selectedSnapshot = getDaySnapshot(state, selectedDate, filteredHabits);
  const weekLabels = state.profile.weekStartsOn === 1
    ? ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
    : ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];

  const monthLabels = weeks.map((week, index) => {
    const marker = week[3];
    const previous = index > 0 ? weeks[index - 1][3] : null;
    if (!previous || marker.getMonth() !== previous.getMonth()) {
      return marker.toLocaleDateString('en-US', { month: 'short' });
    }
    return '';
  });

  function handleCellKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Enter') {
      event.preventDefault();
      openDay(days[index]);
      return;
    }
    const offsets: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const row = index % 7;
    if ((event.key === 'ArrowUp' && row === 0) || (event.key === 'ArrowDown' && row === 6)) return;
    const target = index + offset;
    if (target < 0 || target >= days.length || isAfterDate(days[target], today)) return;
    setSelectedDate(days[target]);
    heatmapScroll.current?.querySelector<HTMLButtonElement>(`[data-heat-index="${target}"]`)?.focus();
  }

  return (
    <div className="view-shell review-view year-view">
      <SectionHeading
        eyebrow="Twelve-month review"
        title="Your life, rendered as evidence."
        copy="Each square normalizes the habits scheduled that day, so steps, minutes, reps, and checkmarks remain comparable."
      />

      <div className="year-toolbar">
        <div className="year-range">
          <span>Rolling 53 weeks</span>
          <strong>{formatDateRange(days[0], days[days.length - 1])}</strong>
        </div>
        <label className="filter-select">
          <span>Heatmap lens</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All habits</option>
            <optgroup label="Categories">
              {categories.map((category) => <option value={`category:${category}`} key={category}>{category}</option>)}
            </optgroup>
            <optgroup label="Individual habits">
              {historicalHabits.map((habit) => <option value={`habit:${habit.id}`} key={habit.id}>{habit.name}</option>)}
            </optgroup>
          </select>
        </label>
        <div className="year-nav">
          <button type="button" onClick={() => setDate(addYears(date, -1))} aria-label="Previous twelve-month window"><ChevronLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => setDate(new Date())} disabled={currentWindow}>Current</button>
          <button type="button" onClick={() => setDate(addYears(date, 1))} disabled={currentWindow} aria-label="Next twelve-month window"><ChevronRight aria-hidden="true" /></button>
        </div>
      </div>

      <section className="metric-grid metric-grid-four" aria-label="Year summary">
        <MetricCard label="Consistency" value={`${Math.round(average * 100)}%`} detail="normalized rolling average" accent />
        <MetricCard label="Active days" value={activeDays} detail={`${perfectDays} perfect days`} />
        <MetricCard label="Best streak" value={longestStreak} detail="in its habit’s real goal period" />
        <MetricCard label="Steadiest habit" value={strongest?.habit.name ?? '—'} detail={strongest ? `${Math.round(strongest.stats.consistency * 100)}% consistency` : 'start logging to reveal it'} />
      </section>

      <section className="panel heatmap-panel" style={{ '--heat-color': heatColor } as HeatStyle}>
        <div className="panel-heading heatmap-heading">
          <div>
            <span>Contribution field</span>
            <h2>{filter === 'all' ? 'All daily signals' : filter.startsWith('category:') ? filter.slice(9) : filteredHabits[0]?.name ?? 'No selection'}</h2>
          </div>
          <div className="heatmap-legend" aria-label="Heatmap intensity legend">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}
            <span>Goal</span>
          </div>
        </div>

        {!filteredHabits.length ? (
          <EmptyState icon={<CalendarRange aria-hidden="true" />} title="No habits in this lens" copy="Choose another category or add a habit to this one." />
        ) : (
          <div className="heatmap-shell">
            <div className="heatmap-weekdays" aria-hidden="true">
              {weekLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
            </div>
            <div className="heatmap-scroll" ref={heatmapScroll}>
              <div className="heatmap-months" aria-hidden="true">
                {monthLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
              </div>
              <div className="heatmap-grid" role="grid" aria-label="Habit consistency heatmap" aria-rowcount={7} aria-colcount={53}>
                {Array.from({ length: 7 }, (_, rowIndex) => (
                  <div className="heatmap-row" role="row" aria-rowindex={rowIndex + 1} key={rowIndex}>
                    {weeks.map((week, weekIndex) => {
                      const day = week[rowIndex];
                      const index = weekIndex * 7 + rowIndex;
                      const future = isAfterDate(day, today);
                      const ratio = future ? 0 : ratioForDay(day);
                      const snapshot = getDaySnapshot(state, day, filteredHabits);
                      const level = getIntensityLevel(ratio);
                      const selected = isSameDate(day, selectedDate);
                      const label = future
                        ? `${formatCompactDate(day)}, future day`
                        : `${formatCompactDate(day)}: ${snapshot.logged} entries, ${Math.round(ratio * 100)} percent`;
                      return (
                        <button
                          type="button"
                          role="gridcell"
                          className={`heat-cell level-${level}${future ? ' is-future' : ''}${selected ? ' is-selected' : ''}${snapshot.skipped ? ' has-skip' : ''}`}
                          data-heat-index={index}
                          key={toDateKey(day)}
                          onClick={() => setSelectedDate(day)}
                          onDoubleClick={() => openDay(day)}
                          onKeyDown={(event) => handleCellKey(event, index)}
                          disabled={future}
                          tabIndex={selected ? 0 : -1}
                          aria-label={label}
                          aria-selected={selected}
                          aria-colindex={weekIndex + 1}
                          title={label}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="heatmap-caption">
          <Info aria-hidden="true" />
          <p>Click a square for its day record. Use arrow keys to move, Enter to open the day, or double-click with a pointer. Skips never count as failures.</p>
        </div>
      </section>

      <div className="year-detail-layout">
        <section className="panel day-detail-panel">
          <div className="panel-heading compact">
            <div>
              <span>Selected day</span>
              <h2>{selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
            </div>
            <button type="button" className="button button-secondary" onClick={() => openDay(selectedDate)} disabled={isAfterDate(selectedDate, today)}>Open day</button>
          </div>
          <div className="selected-day-score">
            <strong>{Math.round(selectedSnapshot.score * 100)}%</strong>
            <span>{selectedSnapshot.logged} entries · {selectedSnapshot.completed} goals met</span>
          </div>
          {selectedHabits.length ? (
            <div className="selected-day-list">
              {selectedHabits.map((habit) => {
                const entry = getEntry(state, habit.id, selectedDate)!;
                const ratio = getDayContributionRatio(habit, selectedDate, state) ?? 0;
                return (
                  <article key={habit.id} style={habitStyle(habit)}>
                    <HabitBadge habit={habit} />
                    <div><strong>{habit.name}</strong><small>{entry.skipped ? 'Skipped' : entry.hasValue === false ? 'Note only' : `${entry.value} ${habit.unit}`}</small></div>
                    <span>{entry.skipped || entry.hasValue === false ? '—' : `${Math.round(ratio * 100)}%`}</span>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="no-day-entries">No entries for this lens. Blank remains different from missed.</p>
          )}
        </section>

        <section className="panel streak-board">
          <div className="panel-heading compact">
            <div><span>Long game</span><h2>Streaks + consistency</h2></div>
            <Flame aria-hidden="true" />
          </div>
          <div className="streak-list">
            {[...habitStats]
              .sort((left, right) => right.stats.consistency - left.stats.consistency)
              .slice(0, 5)
              .map(({ habit, stats }, index) => (
                <article key={habit.id} style={habitStyle(habit)}>
                  <span className="streak-rank">{String(index + 1).padStart(2, '0')}</span>
                  <HabitBadge habit={habit} />
                  <div><strong>{habit.name}</strong><small>{Math.round(stats.consistency * 100)}% consistency</small></div>
                  <span className="streak-value"><strong>{stats.currentStreak}</strong><small>current</small></span>
                </article>
              ))}
          </div>
          <div className="streak-note"><Award aria-hidden="true" /><span>A missed day can end a streak, but it cannot erase the consistency already built.</span></div>
        </section>
      </div>

      <section className="year-closer">
        <Sparkles aria-hidden="true" />
        <p><strong>{activeDays ? `${activeDays} active days leave a real trail.` : 'The first square starts the trail.'}</strong> The goal is not a flawless wall of green; it is a record honest enough to learn from.</p>
      </section>
    </div>
  );
}
