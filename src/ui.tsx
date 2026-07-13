import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
} from 'react';

export type MacroTone = 'calories' | 'protein' | 'carbs' | 'fat';
export type FeedbackTone = 'neutral' | 'positive' | 'warning' | 'danger';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

interface BrandMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  size?: number;
  decorative?: boolean;
}

export function BrandMark({
  size = 38,
  decorative = false,
  className,
  style,
  ...props
}: BrandMarkProps) {
  return (
    <span
      className={cx('brand-mark', className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <svg
        viewBox="0 0 64 64"
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative || undefined}
        aria-label={decorative ? undefined : 'Fare'}
      >
        <circle cx="32" cy="32" r="30" className="brand-mark__rim" />
        <circle cx="32" cy="32" r="25.5" className="brand-mark__plate" />
        <path d="M32 32 19.3 10A25.4 25.4 0 0 1 57.4 32Z" className="brand-mark__calories" />
        <path d="M32 32h25.4a25.4 25.4 0 0 1-12.7 22Z" className="brand-mark__protein" />
        <path d="M32 32 44.7 54a25.4 25.4 0 0 1-25.4 0Z" className="brand-mark__carbs" />
        <path d="M32 32 19.3 54a25.4 25.4 0 0 1 0-44Z" className="brand-mark__fat" />
        <g className="brand-mark__dividers">
          <path d="M32 32 19.3 10" />
          <path d="M32 32h25.4" />
          <path d="M32 32 44.7 54" />
          <path d="M32 32 19.3 54" />
        </g>
        <circle cx="32" cy="32" r="4" className="brand-mark__hub" />
      </svg>
    </span>
  );
}

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'raised' | 'soft' | 'outline';
  padding?: 'none' | 'compact' | 'default' | 'roomy';
}

export function Panel({
  variant = 'default',
  padding = 'default',
  className,
  ...props
}: PanelProps) {
  return (
    <div
      className={cx('panel', `panel--${variant}`, `panel--padding-${padding}`, className)}
      {...props}
    />
  );
}

export interface SectionHeadingProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  size?: 'small' | 'default' | 'large';
}

export function SectionHeading({
  title,
  eyebrow,
  description,
  action,
  size = 'default',
  className,
  ...props
}: SectionHeadingProps) {
  return (
    <div className={cx('section-heading', `section-heading--${size}`, className)} {...props}>
      <div className="section-heading__copy">
        {eyebrow ? <div className="section-heading__eyebrow">{eyebrow}</div> : null}
        <h2 className="section-heading__title">{title}</h2>
        {description ? <div className="section-heading__description">{description}</div> : null}
      </div>
      {action ? <div className="section-heading__action">{action}</div> : null}
    </div>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'ghost' | 'soft' | 'solid' | 'danger';
  size?: 'small' | 'default' | 'large';
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'default',
  className,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx('icon-button', `icon-button--${variant}`, `icon-button--${size}`, className)}
      {...props}
    >
      {children}
    </button>
  );
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeLabel?: string;
  variant?: 'modal' | 'sheet';
  width?: 'small' | 'medium' | 'large';
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  closeLabel = 'Close',
  variant = 'modal',
  width = 'medium',
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className={cx('modal-backdrop', variant === 'sheet' && 'modal-backdrop--sheet')}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className={cx('modal-shell', `modal-shell--${variant}`, `modal-shell--${width}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        {variant === 'sheet' ? <div className="modal-shell__grabber" aria-hidden="true" /> : null}
        <header className="modal-shell__header">
          <div>
            <h2 id={titleId} className="modal-shell__title">{title}</h2>
            {description ? (
              <p id={descriptionId} className="modal-shell__description">{description}</p>
            ) : null}
          </div>
          <IconButton label={closeLabel} size="small" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </IconButton>
        </header>
        <div className="modal-shell__body">{children}</div>
        {footer ? <footer className="modal-shell__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export type BottomSheetProps = Omit<ModalProps, 'variant'>;

export function BottomSheet(props: BottomSheetProps) {
  return <Modal {...props} variant="sheet" />;
}

export interface MacroBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  label: ReactNode;
  value: number;
  target: number;
  tone: MacroTone;
  valueLabel?: ReactNode;
  compact?: boolean;
}

export function MacroBar({
  label,
  value,
  target,
  tone,
  valueLabel,
  compact = false,
  className,
  ...props
}: MacroBarProps) {
  const percentage = target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0;
  const progressStyle = { '--macro-progress': `${percentage}%` } as CSSProperties;

  return (
    <div className={cx('macro-bar', `macro-bar--${tone}`, compact && 'macro-bar--compact', className)} {...props}>
      <div className="macro-bar__meta">
        <span className="macro-bar__label">{label}</span>
        <span className="macro-bar__value">{valueLabel ?? `${Math.round(value)} / ${Math.round(target)}`}</span>
      </div>
      <div
        className="macro-bar__track"
        role="progressbar"
        aria-label={typeof label === 'string' ? label : undefined}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, target)}
        aria-valuenow={Math.max(0, value)}
      >
        <span className="macro-bar__fill" style={progressStyle} />
      </div>
    </div>
  );
}

export interface CircularProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value: number;
  max: number;
  label: ReactNode;
  detail?: ReactNode;
  tone?: MacroTone;
  size?: number;
  strokeWidth?: number;
}

export function CircularProgress({
  value,
  max,
  label,
  detail,
  tone = 'calories',
  size = 152,
  strokeWidth = 11,
  className,
  ...props
}: CircularProgressProps) {
  const safeMax = Math.max(0, max);
  const percentage = safeMax > 0 ? Math.min(100, Math.max(0, (value / safeMax) * 100)) : 0;
  const radius = 50 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percentage / 100);

  return (
    <div
      className={cx('circular-progress', `circular-progress--${tone}`, className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={typeof label === 'string' ? label : undefined}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.max(0, value)}
      {...props}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="circular-progress__track" cx="50" cy="50" r={radius} strokeWidth={strokeWidth} />
        <circle
          className="circular-progress__value"
          cx="50"
          cy="50"
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="circular-progress__copy">
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div className={cx('empty-state', compact && 'empty-state--compact', className)} {...props}>
      {icon ? <div className="empty-state__icon" aria-hidden="true">{icon}</div> : null}
      <h3 className="empty-state__title">{title}</h3>
      {description ? <p className="empty-state__description">{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  fullWidth?: boolean;
  size?: 'small' | 'default';
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  fullWidth = false,
  size = 'default',
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cx(
        'segmented-control',
        fullWidth && 'segmented-control--full',
        `segmented-control--${size}`,
        className,
      )}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx('segmented-control__option', option.value === value && 'is-selected')}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <span className="segmented-control__icon" aria-hidden="true">{option.icon}</span> : null}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export type SourceKind = 'verified' | 'database' | 'history' | 'custom' | 'estimated';

export interface SourceBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  source: SourceKind;
  label?: ReactNode;
}

const sourceLabels: Record<SourceKind, string> = {
  verified: 'High completeness',
  database: 'Food database',
  history: 'From history',
  custom: 'Custom',
  estimated: 'Estimated',
};

export function SourceBadge({ source, label, className, ...props }: SourceBadgeProps) {
  return (
    <span className={cx('source-badge', `source-badge--${source}`, className)} {...props}>
      <span className="source-badge__dot" aria-hidden="true" />
      {label ?? sourceLabels[source]}
    </span>
  );
}

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  message: ReactNode;
  tone?: FeedbackTone;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

export function Toast({
  title,
  message,
  tone = 'neutral',
  actionLabel,
  onAction,
  onDismiss,
  className,
  ...props
}: ToastProps) {
  return (
    <div className={cx('toast', `toast--${tone}`, className)} role="status" aria-live="polite" {...props}>
      <span className="toast__indicator" aria-hidden="true" />
      <div className="toast__copy">
        {title ? <strong className="toast__title">{title}</strong> : null}
        <div className="toast__message">{message}</div>
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="toast__action" onClick={onAction}>{actionLabel}</button>
      ) : null}
      {onDismiss ? (
        <IconButton label="Dismiss" size="small" onClick={onDismiss}>
          <span aria-hidden="true">×</span>
        </IconButton>
      ) : null}
    </div>
  );
}
