import { useId } from 'react';

export function BrandMark({ size = 44, decorative = false }: { size?: number; decorative?: boolean }) {
  const gradientId = useId().replace(/:/g, '');
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : 'Sift'}
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="7" x2="55" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#162E2B" />
          <stop offset="1" stopColor="#0B1716" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${gradientId})`} />
      <path d="M18 17.5h28v24.2c0 2.65-2.15 4.8-4.8 4.8H22.8a4.8 4.8 0 0 1-4.8-4.8V17.5Z" fill="#F5F0E5" />
      <path d="M18 17.5h28l-4.3 7.25H22.3L18 17.5Z" fill="#B7D8CF" />
      <path d="M24 29.3h16M24 34.8h12M24 40.3h7.4" stroke="#17312D" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="40" cy="40.3" r="3.15" fill="#F2A65A" />
      <path d="M15.5 21h-2.2a3.8 3.8 0 0 0-3.8 3.8v22.4a6.3 6.3 0 0 0 6.3 6.3h22.4a3.8 3.8 0 0 0 3.8-3.8v-.7" fill="none" stroke="#6EA99C" strokeWidth="2.4" strokeLinecap="round" opacity=".88" />
    </svg>
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-lockup${compact ? ' brand-lockup--compact' : ''}`}>
      <BrandMark size={compact ? 38 : 44} decorative />
      <span className="brand-lockup__copy">
        <strong>Sift</strong>
        {!compact && <small>Research, with receipts.</small>}
      </span>
    </span>
  );
}
