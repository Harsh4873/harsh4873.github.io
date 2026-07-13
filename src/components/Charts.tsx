import type { ExpressionPoint, EssentialityRow, Gene } from '../lib/types';
import { category } from '../lib/categories';
import { fmtSigned } from '../lib/format';

// Expression cells recede to the panel background at log2fc≈0 and gain a red
// (up) or blue (down) overlay with magnitude — so the same scale reads on both
// light and dark surfaces without hard-coding a theme.
const UP = '#e5484d';
const DOWN = '#3b76ef';

export function exprOverlay(v: number, maxAbs = 4): { color: string; opacity: number } {
  const m = Math.min(Math.abs(v) / maxAbs, 1);
  return { color: v >= 0 ? UP : DOWN, opacity: Number((m * 0.92).toFixed(3)) };
}

export function HeatCell({ v, size = 22, title }: { v: number; size?: number; title?: string }) {
  const o = exprOverlay(v);
  return (
    <svg width={size} height={size} style={{ display: 'block' }} role="img" aria-label={title}>
      {title ? <title>{title}</title> : null}
      <rect x={0.5} y={0.5} width={size - 1} height={size - 1} rx={4} style={{ fill: 'var(--panel-2)', stroke: 'var(--border)' }} strokeWidth={1} />
      <rect x={0.5} y={0.5} width={size - 1} height={size - 1} rx={4} style={{ fill: o.color }} fillOpacity={o.opacity} />
    </svg>
  );
}

export function ExpressionStrip({ points, cell = 22, gap = 3 }: { points: ExpressionPoint[]; cell?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', gap, flexWrap: 'wrap' }}>
      {points.map((p) => (
        <div key={p.conditionId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: cell }}>
          <HeatCell v={p.log2fc} size={cell} title={`${p.label}: ${fmtSigned(p.log2fc)} log₂FC`} />
        </div>
      ))}
    </div>
  );
}

export function ExpressionBars({ points, maxAbs = 6 }: { points: ExpressionPoint[]; maxAbs?: number }) {
  const rowH = 26;
  const width = 460;
  const mid = width * 0.5;
  const half = width * 0.46;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${points.length * rowH + 8}`} role="img" aria-label="Expression fold-change by condition">
      <line x1={mid} y1={4} x2={mid} y2={points.length * rowH + 2} style={{ stroke: 'var(--border-strong)' }} strokeWidth={1} />
      {points.map((p, i) => {
        const y = i * rowH + 6;
        const w = Math.min(Math.abs(p.log2fc) / maxAbs, 1) * half;
        const up = p.log2fc >= 0;
        return (
          <g key={p.conditionId}>
            <title>{`${p.label}: ${fmtSigned(p.log2fc)} log₂FC`}</title>
            <rect x={up ? mid : mid - w} y={y} width={Math.max(w, 1)} height={rowH - 12} rx={3} style={{ fill: up ? UP : DOWN }} fillOpacity={0.85} />
            <text x={8} y={y + (rowH - 12) / 2 + 4} style={{ fill: 'var(--text-dim)', fontSize: 11 }}>{p.label}</text>
            <text x={width - 6} y={y + (rowH - 12) / 2 + 4} textAnchor="end" style={{ fill: 'var(--text-faint)', fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(p.log2fc)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ values, width = 120, height = 30 }: { values: number[]; width?: number; height?: number }) {
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
  const step = width / Math.max(1, values.length - 1);
  const y = (v: number) => height / 2 - (v / maxAbs) * (height / 2 - 2);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label="Expression sparkline">
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} style={{ stroke: 'var(--border)' }} strokeWidth={1} />
      <path d={d} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Donut({ data, size = 200, thickness = 26, onSlice }: { data: { label: string; value: number; color: string }[]; size?: number; thickness?: number; onSlice?: (label: string) => void }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - thickness / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Functional class distribution">
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {data.map((d) => {
          const frac = d.value / total;
          const dash = frac * circ;
          const el = (
            <circle
              key={d.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              style={{ cursor: onSlice ? 'pointer' : 'default', transition: 'stroke-width 0.15s' }}
              onClick={onSlice ? () => onSlice(d.label) : undefined}
            >
              <title>{`${d.label}: ${d.value} (${(frac * 100).toFixed(1)}%)`}</title>
            </circle>
          );
          offset += dash;
          return el;
        })}
      </g>
      <text x={cx} y={cy - 4} textAnchor="middle" style={{ fill: 'var(--text)', fontSize: 22, fontWeight: 750 }}>{total.toLocaleString()}</text>
      <text x={cx} y={cy + 15} textAnchor="middle" style={{ fill: 'var(--text-dim)', fontSize: 11 }}>genes</text>
    </svg>
  );
}

const ESS_COLOR: Record<string, string> = {
  essential: 'var(--ess-essential)',
  'growth-defect': 'var(--ess-defect)',
  'non-essential': 'var(--ess-nonessential)',
  uncertain: 'var(--ess-uncertain)',
  'no-data': 'var(--ess-uncertain)',
};

export function EssentialityDots({ rows }: { rows: EssentialityRow[] }) {
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {rows.map((r) => (
        <span key={r.datasetId} title={`${r.ref} — ${r.condition}: ${r.call}`}
          className="dot dot-round" style={{ background: ESS_COLOR[r.call], width: 11, height: 11, opacity: r.call === 'no-data' ? 0.3 : 1 }} />
      ))}
    </div>
  );
}

export function Meter({ value, max = 1, color = 'var(--accent)', height = 8 }: { value: number; max?: number; color?: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div style={{ background: 'var(--panel-3)', borderRadius: 999, height, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.3s' }} />
    </div>
  );
}

// Neighbouring genes drawn to genomic scale, focus gene highlighted.
export function GenomeContext({ neighbors, focusOrf, onPick }: { neighbors: Gene[]; focusOrf: string; onPick?: (orf: string) => void }) {
  if (!neighbors.length) return null;
  const min = Math.min(...neighbors.map((g) => Math.min(g.start, g.end)));
  const max = Math.max(...neighbors.map((g) => Math.max(g.start, g.end)));
  const span = Math.max(1, max - min);
  const W = 900;
  const H = 76;
  const pad = 10;
  const x = (bp: number) => pad + ((bp - min) / span) * (W - 2 * pad);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Genomic neighbourhood" style={{ minWidth: 520 }}>
      <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} style={{ stroke: 'var(--border-strong)' }} strokeWidth={1.5} />
      {neighbors.map((g) => {
        const x1 = x(Math.min(g.start, g.end));
        const x2 = x(Math.max(g.start, g.end));
        const w = Math.max(6, x2 - x1);
        const focus = g.orf === focusOrf;
        const up = g.strand === '+';
        const arrow = 6;
        const y = up ? H / 2 - 20 : H / 2 + 2;
        const col = category(g.category).color;
        const path = up
          ? `M${x1},${y} H${x1 + w - arrow} L${x1 + w},${y + 9} L${x1 + w - arrow},${y + 18} H${x1} Z`
          : `M${x1 + w},${y} H${x1 + arrow} L${x1},${y + 9} L${x1 + arrow},${y + 18} H${x1 + w} Z`;
        return (
          <g key={g.orf} style={{ cursor: 'pointer' }} onClick={onPick ? () => onPick(g.orf) : undefined}>
            <title>{`${g.orf}${g.gene ? ` (${g.gene})` : ''} · ${g.strand} · ${g.annotation}`}</title>
            <path d={path} fill={col} fillOpacity={focus ? 1 : 0.5} stroke={focus ? 'var(--text)' : 'none'} strokeWidth={focus ? 1.5 : 0} />
            {w > 34 ? (
              <text x={x1 + w / 2} y={y + 12.5} textAnchor="middle" style={{ fill: focus ? 'var(--accent-contrast)' : 'var(--text)', fontSize: 9.5, fontWeight: focus ? 700 : 500, pointerEvents: 'none' }}>
                {g.gene ?? g.orf.replace('Rv', '')}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
