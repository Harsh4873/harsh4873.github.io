import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Database,
  Download,
  Edit3,
  FileJson,
  HardDrive,
  LockKeyhole,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { toDateKey } from '../dates';
import { habitIconMap, HabitGlyph } from '../icons';
import { getHabitStats, goalLabel, scheduleLabel } from '../metrics';
import {
  CATEGORY_SUGGESTIONS,
  HABIT_COLORS,
  HABIT_ICONS,
  makeHabitId,
  type Habit,
  type HabitSchedule,
  type MetricType,
  type TrackerState,
} from '../model';
import { parseTrackerState, type TrackerStore } from '../store';
import { HabitBadge, ProgressBar, SectionHeading, habitStyle } from '../ui';

interface ProfileViewProps {
  state: TrackerState;
  storageMode: 'indexeddb' | 'localstorage';
  saveHabit: TrackerStore['saveHabit'];
  archiveHabit: TrackerStore['archiveHabit'];
  moveHabit: TrackerStore['moveHabit'];
  updateProfile: TrackerStore['updateProfile'];
  replaceState: TrackerStore['replaceState'];
  resetState: TrackerStore['resetState'];
  markBackedUp: TrackerStore['markBackedUp'];
}

const DAY_OPTIONS = [
  { value: 1, label: 'M', name: 'Monday' },
  { value: 2, label: 'T', name: 'Tuesday' },
  { value: 3, label: 'W', name: 'Wednesday' },
  { value: 4, label: 'T', name: 'Thursday' },
  { value: 5, label: 'F', name: 'Friday' },
  { value: 6, label: 'S', name: 'Saturday' },
  { value: 0, label: 'S', name: 'Sunday' },
];

const METRIC_DEFAULTS: Record<MetricType, { target: number; unit: string; increment: number }> = {
  check: { target: 1, unit: 'times', increment: 1 },
  count: { target: 20, unit: 'reps', increment: 1 },
  duration: { target: 20, unit: 'min', increment: 5 },
  quantity: { target: 8, unit: 'glasses', increment: 1 },
  distance: { target: 5, unit: 'km', increment: 1 },
};

function createHabit(overrides: Partial<Habit> = {}): Habit {
  const now = new Date().toISOString();
  return {
    id: makeHabitId(),
    name: '',
    category: 'Health',
    icon: 'activity',
    color: HABIT_COLORS[0],
    metric: 'check',
    target: 1,
    unit: 'times',
    period: 'day',
    direction: 'atLeast',
    schedule: { type: 'everyday' },
    timeSlot: 'anytime',
    increment: 1,
    startDate: toDateKey(new Date()),
    createdAt: now,
    ...overrides,
  };
}

const QUICK_STARTS: Array<{ label: string; copy: string; habit: Partial<Habit> }> = [
  {
    label: 'Meditate',
    copy: '10 min daily',
    habit: { name: 'Meditate', category: 'Mind', icon: 'leaf', color: '#69d69c', metric: 'duration', target: 10, unit: 'min', increment: 5, timeSlot: 'morning' },
  },
  {
    label: 'Hydrate',
    copy: '8 glasses daily',
    habit: { name: 'Hydrate', category: 'Health', icon: 'droplet', color: '#58c9d6', metric: 'quantity', target: 8, unit: 'glasses', increment: 1 },
  },
  {
    label: 'Push-ups',
    copy: '30 reps daily',
    habit: { name: 'Push-ups', category: 'Movement', icon: 'activity', color: '#ff8e64', metric: 'count', target: 30, unit: 'reps', increment: 5 },
  },
  {
    label: 'Sleep',
    copy: '8 hr daily',
    habit: { name: 'Sleep', category: 'Recovery', icon: 'moon', color: '#8d7cff', metric: 'duration', target: 8, unit: 'hr', increment: 0.5, timeSlot: 'morning' },
  },
  {
    label: 'Call family',
    copy: 'Once a week',
    habit: { name: 'Call family', category: 'Relationships', icon: 'users', color: '#f47ea8', metric: 'check', target: 1, unit: 'call', period: 'week' },
  },
  {
    label: 'Social media',
    copy: 'Stay under 60 min',
    habit: { name: 'Social media', category: 'Mind', icon: 'brain', color: '#f4c95d', metric: 'duration', target: 60, unit: 'min', increment: 5, direction: 'atMost', timeSlot: 'evening' },
  },
];

function scheduleMode(schedule: HabitSchedule) {
  if (schedule.type === 'everyday') return 'everyday';
  if (schedule.type === 'interval') return 'interval';
  return schedule.days.join(',') === '1,2,3,4,5' ? 'weekdays' : 'custom';
}

function HabitEditor({ initial, measurementLocked, onClose, onSave }: {
  initial: Habit;
  measurementLocked: boolean;
  onClose: () => void;
  onSave: (habit: Habit) => void;
}) {
  const [habit, setHabit] = useState(initial);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const mode = scheduleMode(habit.schedule);

  useEffect(() => {
    const previousFocus = openerRef.current;
    const background = document.querySelector<HTMLElement>('.app-shell');
    const previousAriaHidden = background ? background.getAttribute('aria-hidden') : null;
    const previousOverflow = document.body.style.overflow;
    if (background) {
      background.inert = true;
      background.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = 'hidden';

    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (background) {
        background.inert = false;
        if (previousAriaHidden === null) background.removeAttribute('aria-hidden');
        else background.setAttribute('aria-hidden', previousAriaHidden);
      }
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function update(patch: Partial<Habit>) {
    setHabit((current) => ({ ...current, ...patch }));
  }

  function changeMetric(metric: MetricType) {
    const defaults = METRIC_DEFAULTS[metric];
    update({ metric, ...defaults, direction: metric === 'check' ? 'atLeast' : habit.direction });
  }

  function changeSchedule(nextMode: string) {
    if (nextMode === 'everyday') update({ schedule: { type: 'everyday' } });
    if (nextMode === 'weekdays') update({ schedule: { type: 'selectedDays', days: [1, 2, 3, 4, 5] } });
    if (nextMode === 'custom') update({ schedule: { type: 'selectedDays', days: [1, 3, 5] } });
    if (nextMode === 'interval') update({ schedule: { type: 'interval', every: 2, unit: 'day' } });
  }

  function toggleDay(day: number) {
    if (habit.schedule.type !== 'selectedDays') return;
    const days = habit.schedule.days.includes(day)
      ? habit.schedule.days.filter((candidate) => candidate !== day)
      : [...habit.schedule.days, day].sort((left, right) => left - right);
    update({ schedule: { type: 'selectedDays', days } });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!habit.name.trim()) {
      setError('Give the habit a short name.');
      return;
    }
    if (!Number.isFinite(habit.target) || habit.target <= 0) {
      setError('The goal must be greater than zero.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(habit.startDate) || habit.startDate > toDateKey(new Date())) {
      setError('Choose a valid start date that is not in the future.');
      return;
    }
    if (!Number.isFinite(habit.increment) || habit.increment <= 0) {
      setError('The quick-add amount must be greater than zero.');
      return;
    }
    if (habit.metric === 'check') {
      const maximum = habit.period === 'day' ? 1 : habit.period === 'week' ? 7 : 31;
      if (!Number.isInteger(habit.target) || habit.target > maximum) {
        setError(`A check habit can log once per day, so this ${habit.period} target must be a whole number no greater than ${maximum}.`);
        return;
      }
    }
    if (habit.schedule.type === 'selectedDays' && habit.schedule.days.length === 0) {
      setError('Choose at least one scheduled day.');
      return;
    }
    onSave({ ...habit, name: habit.name.trim(), category: habit.category.trim() || 'Uncategorized', unit: habit.unit.trim() || 'units' });
  }

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section ref={dialogRef} className="habit-dialog" role="dialog" aria-modal="true" aria-labelledby="habit-dialog-title">
        <header>
          <div><span>Habit profile</span><h2 id="habit-dialog-title">{initial.name ? `Edit ${initial.name}` : 'Create a habit'}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close habit editor"><X aria-hidden="true" /></button>
        </header>

        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field field-wide">
              <span>Habit name</span>
              <input ref={nameInputRef} value={habit.name} onChange={(event) => update({ name: event.target.value })} placeholder="e.g. Read, Train, 10K steps" required />
            </label>
            <label className="field">
              <span>Category</span>
              <input list="category-options" value={habit.category} onChange={(event) => update({ category: event.target.value })} />
              <datalist id="category-options">
                {CATEGORY_SUGGESTIONS.map((category) => <option value={category} key={category} />)}
              </datalist>
            </label>
            <label className="field">
              <span>Start date</span>
              <input type="date" value={habit.startDate} max={toDateKey(new Date())} onChange={(event) => update({ startDate: event.target.value })} disabled={measurementLocked} required />
            </label>
          </div>

          <fieldset className="visual-picker">
            <legend>Marker</legend>
            <div className="icon-picker" role="group" aria-label="Habit icon">
              {HABIT_ICONS.map((icon) => {
                const Icon = habitIconMap[icon];
                return (
                  <button type="button" className={habit.icon === icon ? 'selected' : ''} onClick={() => update({ icon })} key={icon} aria-label={`Use ${icon} icon`} aria-pressed={habit.icon === icon}>
                    <Icon aria-hidden="true" />
                  </button>
                );
              })}
            </div>
            <div className="color-picker" role="group" aria-label="Habit color">
              {HABIT_COLORS.map((color) => (
                <button type="button" className={habit.color === color ? 'selected' : ''} style={{ background: color }} onClick={() => update({ color })} key={color} aria-label={`Use color ${color}`} aria-pressed={habit.color === color} />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Measurement</legend>
            {measurementLocked && <p className="locked-note"><LockKeyhole aria-hidden="true" /> Goal structure, start date, and cadence are locked because this habit has history. Archive it and create a new scale to preserve the meaning of past entries.</p>}
            <div className="form-grid three-columns">
              <label className="field">
                <span>Track as</span>
                <select value={habit.metric} onChange={(event) => changeMetric(event.target.value as MetricType)} disabled={measurementLocked}>
                  <option value="check">Done / not done</option>
                  <option value="count">Count / reps</option>
                  <option value="duration">Time / duration</option>
                  <option value="quantity">Quantity</option>
                  <option value="distance">Distance</option>
                </select>
              </label>
              <label className="field">
                <span>Goal direction</span>
                <select value={habit.direction} onChange={(event) => update({ direction: event.target.value as Habit['direction'] })} disabled={habit.metric === 'check' || measurementLocked}>
                  <option value="atLeast">Reach at least</option>
                  <option value="atMost">Stay at or below</option>
                </select>
              </label>
              <label className="field">
                <span>Goal period</span>
                <select value={habit.period} onChange={(event) => update({ period: event.target.value as Habit['period'] })} disabled={measurementLocked}>
                  <option value="day">Per day</option>
                  <option value="week">Per week</option>
                  <option value="month">Per month</option>
                </select>
              </label>
              <label className="field">
                <span>Target</span>
                <input type="number" min="0.01" step="any" value={habit.target} onChange={(event) => update({ target: Number(event.target.value) })} disabled={measurementLocked} required />
              </label>
              <label className="field">
                <span>Unit</span>
                <input value={habit.unit} onChange={(event) => update({ unit: event.target.value })} disabled={measurementLocked} placeholder="steps, pages, min…" required />
              </label>
              <label className="field">
                <span>Quick + button</span>
                <input type="number" min="0.01" step="any" value={habit.increment} onChange={(event) => update({ increment: Math.max(0.01, Number(event.target.value)) })} disabled={habit.metric === 'check' || measurementLocked} />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Rhythm</legend>
            <div className="form-grid">
              <label className="field">
                <span>Best time</span>
                <select value={habit.timeSlot} onChange={(event) => update({ timeSlot: event.target.value as Habit['timeSlot'] })}>
                  <option value="morning">Morning</option>
                  <option value="anytime">Anytime</option>
                  <option value="evening">Evening</option>
                </select>
              </label>
              {habit.period === 'day' && (
                <label className="field">
                  <span>Repeat</span>
                  <select value={mode} onChange={(event) => changeSchedule(event.target.value)} disabled={measurementLocked}>
                    <option value="everyday">Every day</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="custom">Selected days</option>
                    <option value="interval">Every N days / weeks</option>
                  </select>
                </label>
              )}
            </div>

            {habit.period === 'day' && habit.schedule.type === 'selectedDays' && (
              <div className="day-picker" role="group" aria-label="Scheduled days">
                {DAY_OPTIONS.map((day) => (
                  <button type="button" className={habit.schedule.type === 'selectedDays' && habit.schedule.days.includes(day.value) ? 'selected' : ''} onClick={() => toggleDay(day.value)} key={day.value} aria-label={day.name} aria-pressed={habit.schedule.type === 'selectedDays' && habit.schedule.days.includes(day.value)} disabled={measurementLocked}>
                    {day.label}
                  </button>
                ))}
              </div>
            )}

            {habit.period === 'day' && habit.schedule.type === 'interval' && (
              <div className="interval-fields">
                <span>Repeat every</span>
                <input type="number" min="1" max="365" value={habit.schedule.every} onChange={(event) => update({ schedule: { type: 'interval', every: Math.max(1, Number(event.target.value)), unit: habit.schedule.type === 'interval' ? habit.schedule.unit : 'day' } })} disabled={measurementLocked} />
                <select value={habit.schedule.unit} onChange={(event) => update({ schedule: { type: 'interval', every: habit.schedule.type === 'interval' ? habit.schedule.every : 1, unit: event.target.value as 'day' | 'week' } })} disabled={measurementLocked}>
                  <option value="day">day(s)</option>
                  <option value="week">week(s)</option>
                </select>
              </div>
            )}
          </fieldset>

          <div className="habit-preview" style={habitStyle(habit)}>
            <span className="preview-icon"><HabitGlyph icon={habit.icon} /></span>
            <div><span>Goal preview</span><strong>{habit.name || 'Untitled habit'}</strong><small>{goalLabel(habit)} · {scheduleLabel(habit)}</small></div>
            <ChevronRight aria-hidden="true" />
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <footer>
            <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button-primary"><Check aria-hidden="true" /> Save habit</button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number | undefined) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function stateToCsv(state: TrackerState) {
  const habits = new Map(state.habits.map((habit) => [habit.id, habit]));
  const rows = [['date', 'habit', 'category', 'value', 'unit', 'status', 'note']];
  Object.entries(state.entries).sort(([left], [right]) => left.localeCompare(right)).forEach(([date, entries]) => {
    Object.entries(entries).forEach(([habitId, entry]) => {
      const habit = habits.get(habitId);
      rows.push([
        date,
        habit?.name ?? habitId,
        habit?.category ?? '',
        String(entry.value),
        habit?.unit ?? '',
        entry.skipped ? 'skipped' : entry.hasValue === false ? 'note only' : 'logged',
        entry.note ?? '',
      ]);
    });
  });
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function ProfileView({
  state,
  storageMode,
  saveHabit,
  archiveHabit,
  moveHabit,
  updateProfile,
  replaceState,
  resetState,
  markBackedUp,
}: ProfileViewProps) {
  const [editor, setEditor] = useState<{ habit: Habit; locked: boolean } | null>(null);
  const [dataMessage, setDataMessage] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const active = state.habits.filter((habit) => !habit.archivedAt);
  const archived = state.habits.filter((habit) => habit.archivedAt);
  const entryCount = Object.values(state.entries).reduce((sum, day) => sum + Object.keys(day).length, 0);

  function editHabit(habit: Habit) {
    const locked = Object.values(state.entries).some((entries) => Boolean(entries[habit.id]));
    setEditor({ habit, locked });
  }

  function exportBackup() {
    const date = toDateKey(new Date());
    downloadText(`daymark-backup-${date}.json`, JSON.stringify(state, null, 2), 'application/json');
    markBackedUp();
    setDataMessage('Lossless JSON backup created.');
  }

  function exportCsv() {
    const date = toDateKey(new Date());
    downloadText(`daymark-entries-${date}.csv`, stateToCsv(state), 'text/csv;charset=utf-8');
    setDataMessage('Spreadsheet-friendly CSV created.');
  }

  async function importBackup(file: File) {
    try {
      const imported = parseTrackerState(JSON.parse(await file.text()));
      const importedEntries = Object.values(imported.entries).reduce((sum, day) => sum + Object.keys(day).length, 0);
      const confirmed = window.confirm(`Replace this device's Daymark data with ${imported.habits.length} habits and ${importedEntries} entries from “${file.name}”? Export a backup first if needed.`);
      if (confirmed) {
        replaceState(imported);
        setDataMessage(`Imported ${imported.habits.length} habits and ${importedEntries} entries.`);
      }
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : 'That backup could not be imported.');
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  }

  function resetAll() {
    if (window.confirm('Reset Daymark on this device? This removes all current entries and restores the starter habits. Export a backup first if you may want this history later.')) {
      resetState();
      setDataMessage('Daymark was reset to the starter habits.');
    }
  }

  return (
    <div className="view-shell profile-view">
      <SectionHeading
        eyebrow="Profile + system"
        title="Build a tracker that fits the life."
        copy="Change the goal, unit, rhythm, visual marker, and ordering. Your history stays private on this device until you export it."
        action={<button type="button" className="button button-primary" onClick={() => setEditor({ habit: createHabit(), locked: false })}><Plus aria-hidden="true" /> New habit</button>}
      />

      <section className="profile-hero-grid">
        <article className="panel identity-panel">
          <div className="profile-monogram">{(state.profile.displayName || 'H').slice(0, 1).toUpperCase()}</div>
          <div><span>Tracker profile</span><h2>{state.profile.displayName || 'Your'}’s Daymark</h2><p>{active.length} active habits · {entryCount} lifetime entries</p></div>
          <Sparkles aria-hidden="true" />
        </article>
        <article className="panel privacy-panel">
          <ShieldCheck aria-hidden="true" />
          <div><span>Private by default</span><h2>Stored only in this browser</h2><p>No account, analytics, or cloud database. Backups are yours to keep.</p></div>
        </article>
      </section>

      <section className="panel settings-panel">
        <div className="panel-heading"><div><span>Preferences</span><h2>Make it yours</h2></div></div>
        <div className="settings-grid">
          <label className="field"><span>Name</span><input value={state.profile.displayName} onChange={(event) => updateProfile({ displayName: event.target.value })} /></label>
          <label className="field"><span>Week starts</span><select value={state.profile.weekStartsOn} onChange={(event) => updateProfile({ weekStartsOn: Number(event.target.value) as 0 | 1 })}><option value={1}>Monday</option><option value={0}>Sunday</option></select></label>
          <label className="field"><span>Appearance</span><select value={state.profile.theme} onChange={(event) => updateProfile({ theme: event.target.value as TrackerState['profile']['theme'] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Follow device</option></select></label>
        </div>
      </section>

      <section className="quick-start-section">
        <div className="profile-section-heading"><div><span>Quick starts</span><h2>Useful patterns, one edit away</h2></div><p>Each opens as a draft. Nothing is added until you save.</p></div>
        <div className="quick-start-grid">
          {QUICK_STARTS.map((template) => (
            <button type="button" key={template.label} onClick={() => setEditor({ habit: createHabit(template.habit), locked: false })}>
              <span className="quick-start-icon"><HabitGlyph icon={template.habit.icon ?? 'activity'} /></span>
              <span><strong>{template.label}</strong><small>{template.copy}</small></span>
              <Plus aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section className="habit-library-section">
        <div className="profile-section-heading"><div><span>Habit library</span><h2>{active.length} active signals</h2></div><button type="button" className="button button-secondary" onClick={() => setEditor({ habit: createHabit(), locked: false })}><Plus aria-hidden="true" /> Add custom</button></div>
        <div className="habit-library-list">
          {active.map((habit, index) => {
            const stats = getHabitStats(habit, state);
            return (
              <article key={habit.id} style={habitStyle(habit)}>
                <span className="habit-order">{String(index + 1).padStart(2, '0')}</span>
                <HabitBadge habit={habit} />
                <div className="library-habit-copy">
                  <span><strong>{habit.name}</strong><small>{habit.category} · {scheduleLabel(habit)}</small></span>
                  <div><ProgressBar value={stats.consistency} color={habit.color} label={`${habit.name} consistency`} /><small>{Math.round(stats.consistency * 100)}% consistency</small></div>
                </div>
                <div className="library-goal"><span>Goal</span><strong>{goalLabel(habit)}</strong></div>
                <div className="library-streak"><span>Current</span><strong>{stats.currentStreak} <small>{habit.period}{stats.currentStreak === 1 ? '' : 's'}</small></strong></div>
                <div className="library-actions">
                  <button type="button" onClick={() => moveHabit(habit.id, -1)} disabled={index === 0} aria-label={`Move ${habit.name} up`}><ArrowUp aria-hidden="true" /></button>
                  <button type="button" onClick={() => moveHabit(habit.id, 1)} disabled={index === active.length - 1} aria-label={`Move ${habit.name} down`}><ArrowDown aria-hidden="true" /></button>
                  <button type="button" onClick={() => editHabit(habit)} aria-label={`Edit ${habit.name}`}><Edit3 aria-hidden="true" /></button>
                  <button type="button" onClick={() => archiveHabit(habit.id, true)} aria-label={`Archive ${habit.name}`}><Archive aria-hidden="true" /></button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {archived.length > 0 && (
        <section className="archived-section">
          <div className="profile-section-heading"><div><span>Archive</span><h2>Paused, with history intact</h2></div></div>
          <div className="archived-list">
            {archived.map((habit) => (
              <article key={habit.id} style={habitStyle(habit)}>
                <HabitBadge habit={habit} />
                <div><strong>{habit.name}</strong><small>Archived {habit.archivedAt ? new Date(`${habit.archivedAt}T12:00:00`).toLocaleDateString() : ''}</small></div>
                <button type="button" className="button button-secondary" onClick={() => archiveHabit(habit.id, false)}><RotateCcw aria-hidden="true" /> Restore</button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="data-section">
        <div className="profile-section-heading"><div><span>Data ownership</span><h2>Back up the record</h2></div><p>JSON is lossless. CSV is easier to analyze.</p></div>
        <div className="data-grid">
          <article className="panel data-status-card">
            <span className="data-icon"><Database aria-hidden="true" /></span>
            <div><span>Local database</span><h3>{storageMode === 'indexeddb' ? 'IndexedDB + fallback' : 'localStorage fallback'}</h3><p>{entryCount} entries across {state.habits.length} habits.</p></div>
            <small><HardDrive aria-hidden="true" /> This device only</small>
          </article>
          <article className="panel backup-card">
            <FileJson aria-hidden="true" />
            <div><span>Last backup</span><h3>{state.profile.lastBackupAt ? new Date(state.profile.lastBackupAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not yet backed up'}</h3><p>Keep a copy somewhere you control.</p></div>
            <div className="backup-actions">
              <button type="button" className="button button-primary" onClick={exportBackup}><Download aria-hidden="true" /> JSON</button>
              <button type="button" className="button button-secondary" onClick={exportCsv}><Download aria-hidden="true" /> CSV</button>
            </div>
          </article>
          <article className="panel import-card">
            <Upload aria-hidden="true" />
            <div><span>Restore</span><h3>Import a Daymark backup</h3><p>You will see the habit and entry counts before anything is replaced.</p></div>
            <button type="button" className="button button-secondary" onClick={() => importInput.current?.click()}><Upload aria-hidden="true" /> Choose JSON</button>
            <input ref={importInput} className="sr-only" type="file" accept="application/json,.json" aria-label="Choose a Daymark JSON backup" onChange={(event) => event.target.files?.[0] && void importBackup(event.target.files[0])} />
          </article>
        </div>
        {dataMessage && <p className="data-message" role="status">{dataMessage}</p>}
        <div className="danger-zone">
          <div><span>Start over</span><p>Restore the four starter habits and remove every local entry.</p></div>
          <button type="button" className="button button-danger" onClick={resetAll}><RotateCcw aria-hidden="true" /> Reset this device</button>
        </div>
      </section>

      {editor && (
        <HabitEditor
          initial={editor.habit}
          measurementLocked={editor.locked}
          onClose={() => setEditor(null)}
          onSave={(habit) => { saveHabit(habit); setEditor(null); }}
        />
      )}
    </div>
  );
}
