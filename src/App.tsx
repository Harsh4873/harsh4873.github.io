import {
  CalendarDays,
  CalendarRange,
  CheckSquare2,
  Grid3X3,
  HardDrive,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clampToToday } from './dates';
import { isHabitActiveOn } from './metrics';
import { useTrackerStore } from './store';
import { MonthView } from './views/MonthView';
import { ProfileView } from './views/ProfileView';
import { TodayView } from './views/TodayView';
import { WeekView } from './views/WeekView';
import { YearView } from './views/YearView';

type ViewId = 'daily' | 'weekly' | 'monthly' | 'year' | 'profile';

const NAVIGATION: Array<{ id: ViewId; label: string; shortLabel: string; icon: LucideIcon }> = [
  { id: 'daily', label: 'Daily', shortLabel: 'Day', icon: CheckSquare2 },
  { id: 'weekly', label: 'Weekly', shortLabel: 'Week', icon: CalendarDays },
  { id: 'monthly', label: 'Monthly', shortLabel: 'Month', icon: CalendarRange },
  { id: 'year', label: 'Year', shortLabel: 'Year', icon: Grid3X3 },
  { id: 'profile', label: 'Profile', shortLabel: 'Profile', icon: UserRound },
];

function currentView(): ViewId {
  const hash = window.location.hash.replace('#', '') as ViewId;
  return NAVIGATION.some((item) => item.id === hash) ? hash : 'daily';
}

function DaymarkLogo() {
  return (
    <span className="daymark-logo" aria-hidden="true">
      <i />
      <i />
      <i />
      <i><CheckSquare2 /></i>
    </span>
  );
}

export default function App() {
  const store = useTrackerStore();
  const [view, setView] = useState<ViewId>(currentView);
  const [dailyDate, setDailyDate] = useState(new Date());
  const [weekDate, setWeekDate] = useState(new Date());
  const [monthDate, setMonthDate] = useState(new Date());
  const [yearDate, setYearDate] = useState(new Date());
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const firstViewRender = useRef(true);
  const themePreference = store.state?.profile.theme;
  const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference ?? 'dark';
  const ready = Boolean(store.state);

  useEffect(() => {
    const onHashChange = () => setView(currentView());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'light' : 'dark');
    media.addEventListener('change', updateSystemTheme);
    return () => media.removeEventListener('change', updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'light' ? '#f2f3ed' : '#101311');
  }, [resolvedTheme]);

  useEffect(() => {
    if (!ready) return;
    if (firstViewRender.current) {
      firstViewRender.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#main-content h1')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, ready]);

  function navigate(nextView: ViewId) {
    if (window.location.hash === `#${nextView}`) setView(nextView);
    else window.location.hash = nextView;
  }

  function openDay(date: Date) {
    setDailyDate(clampToToday(date));
    navigate('daily');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  if (!store.state) {
    return (
      <div className="loading-screen" role="status">
        <DaymarkLogo />
        <span>Opening your local record…</span>
      </div>
    );
  }

  const state = store.state;
  const dailyHabits = state.habits.filter((habit) => isHabitActiveOn(habit, dailyDate));
  function toggleTheme() {
    store.updateProfile({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' });
  }

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to tracker
      </a>

      <header className="app-header">
        <a className="brand-link" href="#daily" aria-label="Daymark daily view">
          <DaymarkLogo />
          <span><strong>Daymark</strong><small>harsh.bet / tracker</small></span>
        </a>

        <nav className="desktop-nav" aria-label="Tracker views">
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <a href={`#${id}`} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} key={id}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="header-tools">
          <span className="local-status" title="Habit data stays in this browser">
            <ShieldCheck aria-hidden="true" />
            <span>Local only</span>
          </span>
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}>
            {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
        </div>
      </header>

      {store.storageWarning && (
        <div className="storage-warning" role="alert">
          <ShieldCheck aria-hidden="true" />
          <span>{store.storageWarning}</span>
          <button type="button" onClick={() => navigate('profile')}>Open data tools</button>
        </div>
      )}

      <main id="main-content" tabIndex={-1}>
        {view === 'daily' && (
          <TodayView
            state={state}
            habits={dailyHabits}
            date={dailyDate}
            setDate={(date) => setDailyDate(clampToToday(date))}
            onManageHabits={() => navigate('profile')}
            setEntryValue={store.setEntryValue}
            incrementEntry={store.incrementEntry}
            toggleCheck={store.toggleCheck}
            toggleSkip={store.toggleSkip}
            setEntryNote={store.setEntryNote}
          />
        )}
        {view === 'weekly' && <WeekView state={state} habits={state.habits} date={weekDate} setDate={setWeekDate} openDay={openDay} />}
        {view === 'monthly' && <MonthView state={state} habits={state.habits} date={monthDate} setDate={setMonthDate} openDay={openDay} />}
        {view === 'year' && <YearView state={state} habits={state.habits} date={yearDate} setDate={setYearDate} openDay={openDay} />}
        {view === 'profile' && (
          <ProfileView
            state={state}
            storageMode={store.storageMode}
            saveHabit={store.saveHabit}
            archiveHabit={store.archiveHabit}
            moveHabit={store.moveHabit}
            updateProfile={store.updateProfile}
            replaceState={store.replaceState}
            resetState={store.resetState}
            markBackedUp={store.markBackedUp}
          />
        )}
      </main>

      <footer className="app-footer">
        <div><DaymarkLogo /><span><strong>A quiet record of showing up.</strong><small>Built for the long game, not a perfect week.</small></span></div>
        <div className="footer-facts">
          <span><HardDrive aria-hidden="true" /> On-device storage</span>
          <button type="button" onClick={() => navigate('profile')}><Settings2 aria-hidden="true" /> Data + settings</button>
        </div>
      </footer>

      <nav className="mobile-nav" aria-label="Tracker views">
        {NAVIGATION.map(({ id, shortLabel, icon: Icon }) => (
          <a href={`#${id}`} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} key={id}>
            <Icon aria-hidden="true" />
            <span>{shortLabel}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
