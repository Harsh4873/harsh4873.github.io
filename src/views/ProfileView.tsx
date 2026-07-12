import {
  Cloud,
  Download,
  HardDrive,
  LoaderCircle,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sun,
  Upload,
  UserRound,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toDateKey } from '../dates';
import type { SlateState, ThemePreference } from '../model';
import { parseSlateState, type SlateStore, type StorageMode } from '../store';
import { SectionHeading } from '../ui';
import type { SlateSync, SyncStatus } from '../useSlateSync';

const SYNC_LABELS: Record<SyncStatus, string> = {
  synced: 'Synced',
  syncing: 'Syncing',
  offline: 'Offline',
  'action-needed': 'Action needed',
};

const THEME_OPTIONS: Array<{ id: ThemePreference; label: string; icon: typeof Sun }> = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'system', label: 'System', icon: Monitor },
];

function formatSyncTime(timestamp?: string) {
  if (!timestamp) return 'Waiting for first sync';
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 'Waiting for first sync';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(parsed);
}

interface ProfileViewProps {
  state: SlateState;
  storageMode: StorageMode;
  updateSettings: SlateStore['updateSettings'];
  replaceState: SlateStore['replaceState'];
  resetState: SlateStore['resetState'];
  sync: SlateSync;
}

export function ProfileView({ state, storageMode, updateSettings, replaceState, resetState, sync }: ProfileViewProps) {
  const [authAction, setAuthAction] = useState<'sign-in' | 'sign-out' | null>(null);
  const [importError, setImportError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const liveSections = state.sections.filter((section) => !section.deleted).length;
  const liveTasks = state.tasks.filter((task) => !task.deleted).length;
  const liveBlocks = state.blocks.filter((block) => !block.deleted).length;
  const signedInName = sync.user?.displayName?.trim() || 'Harsh';

  async function startSignIn() {
    if (authAction) return;
    setAuthAction('sign-in');
    try {
      await sync.signIn();
    } finally {
      setAuthAction(null);
    }
  }

  async function startSignOut() {
    if (authAction) return;
    const confirmed = window.confirm('Sign out of Slate on this device? Slate will first confirm that pending changes reached the cloud, then remove its local copy here. Your other signed-in devices keep the synced record.');
    if (!confirmed) return;
    setAuthAction('sign-out');
    try {
      await sync.signOut();
    } finally {
      setAuthAction(null);
    }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `slate-backup-${toDateKey(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file: File) {
    setImportError(undefined);
    try {
      const parsed = parseSlateState(JSON.parse(await file.text()));
      const scope = sync.user ? 'all of your signed-in devices' : 'this device';
      const sectionCount = parsed.sections.filter((section) => !section.deleted).length;
      const taskCount = parsed.tasks.filter((task) => !task.deleted).length;
      const blockCount = parsed.blocks.filter((block) => !block.deleted).length;
      const confirmed = window.confirm(
        `Replace Slate on ${scope} with ${sectionCount} sections, ${taskCount} tasks, and ${blockCount} schedule blocks from “${file.name}”? This becomes the new synced record. Export a backup first if needed.`,
      );
      if (confirmed) replaceState(parsed);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'That file could not be read as a Slate backup.');
    }
  }

  function startReset() {
    const scope = sync.user ? 'across every signed-in device' : 'on this device';
    if (window.confirm(`Reset Slate ${scope}? All sections, tasks, and schedule blocks are replaced with a fresh start. Export a backup first if needed.`)) {
      resetState();
    }
  }

  const busy = authAction !== null || sync.status === 'syncing';

  return (
    <section className="view profile-view">
      <SectionHeading
        eyebrow="Account + data"
        title="Profile"
        copy={`${liveSections} sections · ${liveTasks} tasks · ${liveBlocks} schedule blocks on record`}
      />

      <div className="profile-grid">
        <div className={`panel sync-panel sync-panel-${sync.status}`} aria-busy={busy}>
          <div className="panel-heading">
            <h2>Automatic sync</h2>
            <span className={`sync-state-pill sync-state-${sync.status}`} aria-live="polite">
              {sync.status === 'syncing' && <LoaderCircle className="spin" aria-hidden="true" />}
              {SYNC_LABELS[sync.status]}
            </span>
          </div>

          {sync.user ? (
            <div className="sync-panel-body">
              <h3>{signedInName}’s devices stay aligned</h3>
              <div className="account-row">
                {sync.user.photoURL
                  ? <img src={sync.user.photoURL} alt="" referrerPolicy="no-referrer" />
                  : <span className="account-avatar-fallback" aria-hidden="true"><UserRound /></span>}
                <span>
                  <small>Google account</small>
                  <strong>{signedInName}</strong>
                  <small>{sync.user.email}</small>
                </span>
              </div>
              <dl className="sync-facts">
                <div><dt>Last successful sync</dt><dd>{formatSyncTime(sync.lastSyncedAt)}</dd></div>
                <div><dt>On-device copy</dt><dd>{storageMode === 'indexeddb' ? 'IndexedDB + fallback' : 'localStorage fallback'}</dd></div>
              </dl>
              <p role="status">{sync.message ?? 'Every section, task, and schedule block is mirrored locally and synced privately across your signed-in devices.'}</p>
              <button type="button" className="button button-secondary" onClick={startSignOut} disabled={authAction !== null}>
                {authAction === 'sign-out'
                  ? <><LoaderCircle className="spin" aria-hidden="true" /> Finishing sync…</>
                  : <><LogOut aria-hidden="true" /> Sign out + clear this device</>}
              </button>
              <small className="sync-caption">Pending writes finish before local data is removed.</small>
            </div>
          ) : (
            <div className="sync-panel-body">
              <h3>Turn on automatic sync</h3>
              <p>Sign in once on each device. Slate keeps an instant on-device mirror, queues changes while offline, and reconciles them automatically after reconnecting.</p>
              {sync.message && <p role="status" className="sync-message">{sync.message}</p>}
              <button
                type="button"
                className="button button-primary"
                onClick={startSignIn}
                disabled={authAction !== null || sync.status === 'offline'}
              >
                {authAction === 'sign-in'
                  ? <><LoaderCircle className="spin" aria-hidden="true" /> Opening Google…</>
                  : <><LogIn aria-hidden="true" /> Sign in with Google</>}
              </button>
              <small className="sync-caption">Restricted to hdav4873@gmail.com</small>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Appearance</h2>
          </div>
          <div className="theme-options" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={state.settings.theme === id}
                className={`theme-option${state.settings.theme === id ? ' selected' : ''}`}
                onClick={() => updateSettings({ theme: id })}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <p className="panel-note">Theme preference syncs with the rest of your record.</p>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Data tools</h2>
            <span className="panel-heading-note">{storageMode === 'indexeddb' ? <><HardDrive aria-hidden="true" /> IndexedDB + fallback</> : <><HardDrive aria-hidden="true" /> localStorage fallback</>}</span>
          </div>
          <div className="data-tools">
            <button type="button" className="button button-secondary" onClick={exportBackup}>
              <Download aria-hidden="true" /> Export backup (.json)
            </button>
            <button type="button" className="button button-secondary" onClick={() => fileInputRef.current?.click()}>
              <Upload aria-hidden="true" /> Import backup
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importBackup(file);
              }}
            />
            <button type="button" className="button button-danger" onClick={startReset}>
              <RotateCcw aria-hidden="true" /> Reset Slate
            </button>
          </div>
          {importError && <p className="data-error" role="alert">{importError}</p>}
          <p className="panel-note">Importing replaces the current record everywhere; exports are plain JSON you can keep anywhere.</p>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Private by design</h2>
          </div>
          <ul className="privacy-list">
            <li><ShieldCheck aria-hidden="true" /> <span><strong>Account-locked sync.</strong> Only your verified Google account can access Slate. There is no analytics tracking.</span></li>
            <li><Cloud aria-hidden="true" /> <span><strong>Local-first.</strong> Everything works offline; the cloud copy exists only to keep your devices aligned.</span></li>
            <li><HardDrive aria-hidden="true" /> <span><strong>Yours to take.</strong> The whole record exports to a single JSON file at any time.</span></li>
          </ul>
        </div>
      </div>
    </section>
  );
}
