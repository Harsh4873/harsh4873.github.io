export function fmtCoord(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtFixed(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function fmtSigned(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Highlight matched ranges from a query inside a label, as {text, hit} spans. */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (idx > i) out.push({ text: text.slice(i, idx), hit: false });
    out.push({ text: text.slice(idx, idx + q.length), hit: true });
    i = idx + q.length;
  }
  return out;
}
