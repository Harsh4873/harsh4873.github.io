import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  ExternalLink,
  FileSearch,
  LoaderCircle,
  X,
} from 'lucide-react';
import { forwardRef, type ReactNode, useEffect, useId, useRef } from 'react';
import type { EvidenceRef } from '../lib/ui-types';

export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }>(function IconButton({
  label,
  children,
  className = '',
  ...props
}, ref) {
  return (
    <button ref={ref} type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
});

export function EvidenceLink({ evidence, onOpen, compact = false }: {
  evidence: EvidenceRef;
  onOpen: (evidence: EvidenceRef) => void;
  compact?: boolean;
}) {
  return (
    <button type="button" className={`evidence-link${compact ? ' evidence-link--compact' : ''}`} onClick={() => onOpen(evidence)}>
      <FileSearch aria-hidden="true" />
      <span>{evidence.label ? `${evidence.label} · ` : ''}p. {evidence.page}</span>
    </button>
  );
}

export function ConfidenceBadge({ value }: { value: 'high' | 'medium' | 'low' }) {
  return <span className={`confidence confidence--${value}`}><span aria-hidden="true" />{value} confidence</span>;
}

export type SyncTone = 'synced' | 'syncing' | 'offline' | 'signed-out' | 'action-needed';

export function SyncBadge({ status, onClick, message }: { status: SyncTone; onClick?: () => void; message?: string }) {
  const labels: Record<SyncTone, string> = {
    synced: 'Synced',
    syncing: 'Syncing',
    offline: 'Offline',
    'signed-out': 'Sign in',
    'action-needed': 'Check sync',
  };
  const Icon = status === 'offline' ? CloudOff : status === 'action-needed' ? AlertTriangle : status === 'syncing' ? LoaderCircle : Cloud;
  return (
    <button type="button" className={`sync-badge sync-badge--${status}`} onClick={onClick} title={message ?? labels[status]}>
      <Icon className={status === 'syncing' ? 'spin' : ''} aria-hidden="true" />
      <span>{labels[status]}</span>
    </button>
  );
}

export function EmptyState({ icon, eyebrow, title, description, action, compact = false }: {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? ' empty-state--compact' : ''}`}>
      {icon && <span className="empty-state__icon">{icon}</span>}
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Opening your research workspace…' }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" /><span>{label}</span></div>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const safe = Math.min(100, Math.max(0, value));
  return (
    <div className="progress" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safe)} role="progressbar">
      <span style={{ width: `${safe}%` }} />
    </div>
  );
}

export function Toast({ message, tone = 'default', onDismiss }: { message: string; tone?: 'default' | 'success' | 'warning'; onDismiss: () => void }) {
  return (
    <div className={`toast toast--${tone}`} role="status">
      <span className="toast__icon">{tone === 'success' ? <Check /> : tone === 'warning' ? <AlertTriangle /> : <Cloud />}</span>
      <span className="toast__message">{message}</span>
      <IconButton label="Dismiss" onClick={onDismiss}><X /></IconButton>
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, width = 'medium' }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'small' | 'medium' | 'large';
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const current = document.activeElement;
      if (!dialog.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected && previous !== document.body) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className={`modal modal--${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <header className="modal__header">
          <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
          <IconButton label="Close" onClick={onClose} ref={closeRef}><X /></IconButton>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return <a className="external-link" href={href} target="_blank" rel="noreferrer">{children}<ExternalLink aria-hidden="true" /></a>;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 bytes';
  const units = ['bytes', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toLocaleString(undefined, { maximumFractionDigits: exponent === 0 ? 0 : 1 })} ${units[exponent]}`;
}

export function formatRelativeDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Just now';
  const difference = Date.now() - Date.parse(value);
  if (difference < 60_000) return 'Just now';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h ago`;
  if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}
