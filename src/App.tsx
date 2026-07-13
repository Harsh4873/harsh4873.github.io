import {
  CalendarClock,
  CircleAlert,
  Cloud,
  CloudOff,
  HardDrive,
  ListTodo,
  LoaderCircle,
  LogIn,
  Moon,
  Settings2,
  ShieldCheck,
  SquareCheckBig,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSlateStore } from './store';
import { useSlateSync, type SyncStatus } from './useSlateSync';
import { ProfileView } from './views/ProfileView';
import { ScheduleView } from './views/ScheduleView';
import { TodoView } from './views/TodoView';

type ViewId = 'schedule' | 'todo' | 'profile';

const NAVIGATION: Array<{ id: ViewId; label: string; shortLabel: string; icon: LucideIcon }> = [
  { id: 'schedule', label: 'Schedule', shortLabel: 'Schedule', icon: CalendarClock },
  { id: 'todo', label: 'To-Do List', shortLabel: 'To-Do', icon: ListTodo },
  { id: 'profile', label: 'Profile', shortLabel: 'Profile', icon: UserRound },
];

const SYNC_PRESENTATION: Record<SyncStatus, { label: string; icon: LucideIcon }> = {
  synced: { label: 'Synced', icon: Cloud },
  syncing: { label: 'Syncing', icon: LoaderCircle },
  offline: { label: 'Offline', icon: CloudOff },
  'signed-out': { label: 'Sign in', icon: LogIn },
  'action-needed': { label: 'Action needed', icon: CircleAlert },
};

function currentView(): ViewId {
  const hash = window.location.hash.replace('#', '') as ViewId;
  return NAVIGATION.some((item) => item.id === hash) ? hash : 'schedule';
}

function SlateLogo() {
  return (
    <span className="slate-logo" aria-hidden="true">
      <i className="slate-logo-bar" />
      <i className="slate-logo-check"><SquareCheckBig /></i>
    </span>
  );
}

export default function App() {
  const store = useSlateStore();
  const sync = useSlateSync(store);
  const [view, setView] = useState<ViewId>(currentView);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  const firstViewRender = useRef(true);
  const themePreference = store.state?.settings.theme;
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

  if (!store.state) {
    return (
      <div className="loading-screen" role="status">
        <SlateLogo />
        <span>Opening your local-first planner…</span>
      </div>
    );
  }

  const state = store.state;
  const syncPresentation = SYNC_PRESENTATION[sync.status];
  const SyncIcon = syncPresentation.icon;

  function toggleTheme() {
    store.updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' });
  }

  return (
    <div className="app-shell">
      {sync.signingOut && (
        <div className="signout-scrim" role="alert" aria-busy="true">
          <LoaderCircle className="spin" aria-hidden="true" />
          <span>Finishing sync, then clearing this device…</span>
        </div>
      )}
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to planner
      </a>

      <header className="app-header">
        <a className="brand-link" href="#schedule" aria-label="Slate schedule view">
          <SlateLogo />
          <span><strong>Slate</strong><small>harsh.bet / slate</small></span>
        </a>

        <nav className="desktop-nav" aria-label="Planner views">
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <a href={`#${id}`} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} key={id}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="header-tools">
          <button
            type="button"
            className={`sync-status sync-status-${sync.status}`}
            title={sync.message ?? `${syncPresentation.label}. Open sync settings.`}
            aria-label={`${syncPresentation.label}. Open sync settings.`}
            onClick={() => navigate('profile')}
          >
            <SyncIcon aria-hidden="true" className={sync.status === 'syncing' ? 'spin' : undefined} />
            <span>{syncPresentation.label}</span>
          </button>
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
        {view === 'schedule' && (
          <ScheduleView
            state={state}
            saveBlock={store.saveBlock}
            deleteBlock={store.deleteBlock}
            copyDayBlocks={store.copyDayBlocks}
            clearDayBlocks={store.clearDayBlocks}
            toggleTask={store.toggleTask}
          />
        )}
        {view === 'todo' && (
          <TodoView
            state={state}
            addSection={store.addSection}
            renameSection={store.renameSection}
            setSectionColor={store.setSectionColor}
            toggleSectionCollapsed={store.toggleSectionCollapsed}
            moveSection={store.moveSection}
            deleteSection={store.deleteSection}
            clearCompleted={store.clearCompleted}
            addTask={store.addTask}
            updateTask={store.updateTask}
            toggleTask={store.toggleTask}
            moveTask={store.moveTask}
            deleteTask={store.deleteTask}
            updateSettings={store.updateSettings}
          />
        )}
        {view === 'profile' && (
          <ProfileView
            state={state}
            storageMode={store.storageMode}
            updateSettings={store.updateSettings}
            replaceState={store.replaceState}
            resetState={store.resetState}
            sync={sync}
          />
        )}
      </main>

      <footer className="app-footer">
        <div><SlateLogo /><span><strong>Plan the blocks. Clear the list.</strong><small>One quiet slate for the whole day.</small></span></div>
        <div className="footer-facts">
          <span>{sync.user ? <Cloud aria-hidden="true" /> : <HardDrive aria-hidden="true" />} Local-first {sync.user ? '+ private sync' : 'storage'}</span>
          <button type="button" onClick={() => navigate('profile')}><Settings2 aria-hidden="true" /> Data + settings</button>
        </div>
      </footer>

      <nav className="mobile-nav" aria-label="Planner views">
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
