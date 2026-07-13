import {
  Check,
  Cloud,
  Database,
  Download,
  HardDrive,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import { Modal, type SyncTone } from './Primitives';

export interface DisplaySettings {
  theme: 'system' | 'light' | 'dark';
  readerWidth: 'comfortable' | 'wide' | 'full';
  defaultZoom: number;
  rememberChat: boolean;
}

export function AccountDialog({
  open,
  email,
  displayName,
  photoURL,
  syncStatus,
  storageMode,
  settings,
  signingOut,
  onClose,
  onSettings,
  onSignIn,
  onSignOut,
  onExport,
  onClear,
}: {
  open: boolean;
  email?: string;
  displayName?: string;
  photoURL?: string;
  syncStatus: SyncTone;
  storageMode: string;
  settings: DisplaySettings;
  signingOut: boolean;
  onClose: () => void;
  onSettings: (patch: Partial<DisplaySettings>) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  return <Modal open={open} onClose={onClose} title="Sift settings" description="Reader preferences, private sync, and this device." width="large">
    <div className="settings-layout">
      <section className="settings-account">
        <div className="account-card">
          {photoURL ? <img src={photoURL} alt="" referrerPolicy="no-referrer" /> : <span>{(displayName || email || 'H').slice(0, 1).toLocaleUpperCase()}</span>}
          <div><strong>{displayName || 'Private research account'}</strong><small>{email || 'Not signed in'}</small></div>
          {email && <span className="account-verified"><ShieldCheck /> Owner</span>}
        </div>
        <div className="settings-status-list">
          <div><span><Cloud /></span><div><strong>Google sync</strong><small>{syncStatus === 'synced' ? 'Analysis, notes, and paper details are current.' : syncStatus === 'offline' ? 'Offline changes will sync later.' : syncStatus === 'signed-out' ? 'Sign in to enable private sync.' : 'Sync is checking this workspace.'}</small></div><em className={`status-dot status-dot--${syncStatus}`} /></div>
          <div><span><HardDrive /></span><div><strong>PDF storage</strong><small>Original library PDFs stay in this browser unless you explicitly run AI Analysis.</small></div><em>{storageMode}</em></div>
          <div><span><Database /></span><div><strong>AI processing</strong><small>AI Analysis and chat use the protected server; the API key is never in this app.</small></div><em><Check /> Protected</em></div>
        </div>
        {email ? <button type="button" className="button button--secondary button--full" onClick={onSignOut} disabled={signingOut}>{signingOut ? <span className="button-spinner" /> : <LogOut />} {signingOut ? 'Finishing sync…' : 'Sign out + clear this device'}</button> : <button type="button" className="button button--primary button--full" onClick={onSignIn}><LogIn /> Sign in with Google</button>}
      </section>

      <section className="settings-preferences">
        <div className="settings-group"><span className="eyebrow">Appearance</span><h3>Theme</h3><div className="choice-grid choice-grid--three">{([
          ['system', 'System', Monitor], ['light', 'Light', Sun], ['dark', 'Dark', Moon],
        ] as const).map(([value, label, Icon]) => <button type="button" key={value} className={settings.theme === value ? 'is-active' : ''} onClick={() => onSettings({ theme: value })}><Icon /><span>{label}</span>{settings.theme === value && <Check />}</button>)}</div></div>
        <div className="settings-group"><span className="eyebrow">Reader</span><h3>Workspace width</h3><div className="choice-grid">{([
          ['comfortable', 'Comfortable'], ['wide', 'Wide'], ['full', 'Full page'],
        ] as const).map(([value, label]) => <button type="button" key={value} className={settings.readerWidth === value ? 'is-active' : ''} onClick={() => onSettings({ readerWidth: value })}><span>{label}</span>{settings.readerWidth === value && <Check />}</button>)}</div></div>
        <label className="settings-toggle"><span><strong>Remember chat</strong><small>Sync questions, answers, and their grounding status across your devices.</small></span><input type="checkbox" checked={settings.rememberChat} onChange={(event) => onSettings({ rememberChat: event.target.checked })} /><i /></label>
        <div className="settings-actions"><button type="button" className="button button--secondary" onClick={onExport}><Download /> Export workspace</button><button type="button" className="button button--danger" onClick={onClear}><Trash2 /> Clear local data</button></div>
      </section>
    </div>
  </Modal>;
}
