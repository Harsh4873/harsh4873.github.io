import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { Habit } from './model';
import { formatNumber, goalLabel } from './metrics';
import { HabitGlyph } from './icons';

type HabitStyle = CSSProperties & { '--habit-color': string };
type ProgressStyle = CSSProperties & { '--progress': string };

export function habitStyle(habit: Habit): HabitStyle {
  return { '--habit-color': habit.color };
}

export function ProgressRing({ value, size = 'large', children }: { value: number; size?: 'small' | 'large'; children: ReactNode }) {
  const progress = Math.max(0, Math.min(1, value));
  return (
    <div
      className={`progress-ring progress-ring-${size}`}
      style={{ '--progress': `${progress * 360}deg` } as ProgressStyle}
      role="img"
      aria-label={`${Math.round(progress * 100)} percent complete`}
    >
      <div>{children}</div>
    </div>
  );
}

export function HabitBadge({ habit }: { habit: Habit }) {
  return (
    <span className="habit-badge" style={habitStyle(habit)}>
      <HabitGlyph icon={habit.icon} />
    </span>
  );
}

export function GoalLabel({ habit }: { habit: Habit }) {
  return <span className="goal-label">{goalLabel(habit)}</span>;
}

export function DateSwitcher({
  eyebrow,
  label,
  onPrevious,
  onNext,
  nextDisabled,
  onToday,
}: {
  eyebrow: string;
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  onToday?: () => void;
}) {
  return (
    <div className="date-switcher">
      <div>
        <span>{eyebrow}</span>
        <strong>{label}</strong>
      </div>
      <div className="date-switcher-actions">
        {onToday && (
          <button type="button" className="icon-button today-button" onClick={onToday} aria-label="Return to current period">
            <RotateCcw aria-hidden="true" />
            <span>Now</span>
          </button>
        )}
        <button type="button" className="icon-button" onClick={onPrevious} aria-label="Previous period">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onNext} disabled={nextDisabled} aria-label="Next period">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function MetricCard({ label, value, detail, accent = false }: { label: string; value: string | number; detail: string; accent?: boolean }) {
  return (
    <article className={accent ? 'metric-card metric-card-accent' : 'metric-card'}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export function SectionHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <span>{eyebrow}</span>
        <h1 tabIndex={-1}>{title}</h1>
        {copy && <p>{copy}</p>}
      </div>
      {action}
    </div>
  );
}

export function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function ProgressBar({ value, color, label }: { value: number; color?: string; label?: string }) {
  const safe = Math.max(0, Math.min(1, value));
  return (
    <div
      className="linear-progress"
      role="progressbar"
      aria-label={label ?? 'Progress'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safe * 100)}
    >
      <span style={{ width: `${safe * 100}%`, background: color }} />
    </div>
  );
}

export function EmptyState({ icon, title, copy, action }: { icon: ReactNode; title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

export function ValuePair({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="value-pair">
      <strong>{formatNumber(value)}</strong>
      <small>{unit}</small>
    </span>
  );
}
