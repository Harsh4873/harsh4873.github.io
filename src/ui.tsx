import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { SLATE_COLORS, SLATE_COLOR_NAMES } from './model';

export function accentStyle(color: string) {
  return { '--accent-color': color } as CSSProperties;
}

export function SectionHeading({ eyebrow, title, copy, action }: {
  eyebrow: string;
  title: string;
  copy?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1 tabIndex={-1}>{title}</h1>
        {copy && <p>{copy}</p>}
      </div>
      {action && <div className="section-heading-action">{action}</div>}
    </div>
  );
}

export function DateSwitcher({ eyebrow, label, onPrevious, onNext, onToday, todayDisabled }: {
  eyebrow: string;
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday?: () => void;
  todayDisabled?: boolean;
}) {
  return (
    <div className="date-switcher">
      <div className="date-switcher-label">
        <span className="eyebrow">{eyebrow}</span>
        <strong>{label}</strong>
      </div>
      <div className="date-switcher-tools">
        {onToday && (
          <button type="button" className="icon-button" onClick={onToday} disabled={todayDisabled} aria-label="Jump to today" title="Jump to today">
            <RotateCcw aria-hidden="true" />
          </button>
        )}
        <button type="button" className="icon-button" onClick={onPrevious} aria-label="Previous day">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onNext} aria-label="Next day">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, copy, action }: {
  icon: ReactNode;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

export function ColorPicker({ value, onChange, idPrefix }: {
  value: string;
  onChange: (color: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Color">
      {SLATE_COLORS.map((color) => (
        <button
          key={`${idPrefix}-${color}`}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={SLATE_COLOR_NAMES[color] ?? `Color ${color}`}
          className={`color-swatch${value === color ? ' selected' : ''}`}
          style={accentStyle(color)}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape/backdrop handlers must see the latest onClose (it captures live
  // state like unsaved notes), not the first render's closure.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Land on the first field of the body, not the header's Close button.
    const focusable = panel?.querySelector<HTMLElement>(
      '.modal-body input, .modal-body textarea, .modal-body select, .modal-body button',
    ) ?? panel?.querySelector<HTMLElement>('input, textarea, select, button');
    (focusable ?? panel)?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(
        'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((item) => !item.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} tabIndex={-1}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
