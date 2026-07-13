interface PdfTextItemLike {
  str: string;
  transform?: unknown;
  height?: unknown;
  hasEOL?: unknown;
}

function textItem(value: unknown): PdfTextItemLike | undefined {
  if (!value || typeof value !== 'object' || !('str' in value) || typeof value.str !== 'string') return undefined;
  return value as PdfTextItemLike;
}

function baseline(item: PdfTextItemLike) {
  if (!Array.isArray(item.transform) || typeof item.transform[5] !== 'number' || !Number.isFinite(item.transform[5])) {
    return undefined;
  }
  return item.transform[5];
}

function itemHeight(item: PdfTextItemLike) {
  return typeof item.height === 'number' && Number.isFinite(item.height) && item.height > 0 ? item.height : 10;
}

function appendTextPiece(current: string, next: string) {
  const piece = next.replace(/[\t\v\f ]+/g, ' ').trim();
  if (!piece) return current;
  if (!current) return piece;
  if (/\s$/.test(current) || /^[,.;:!?%)\]}]/.test(piece) || /[(\[{]$/.test(current)) return `${current}${piece}`;
  if (/-$/.test(current) && /^[a-z]/.test(piece)) return `${current}${piece}`;
  return `${current} ${piece}`;
}

/**
 * Reconstruct readable lines from PDF.js text items. Explicit EOL markers win;
 * otherwise a meaningful baseline change starts a new line. Marked-content
 * records and empty text runs are ignored.
 */
export function extractPdfTextLines(items: readonly unknown[]): string[] {
  const lines: string[] = [];
  let current = '';
  let currentBaseline: number | undefined;
  let currentHeight = 10;

  const flush = () => {
    const line = current.replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
    current = '';
    currentBaseline = undefined;
    currentHeight = 10;
  };

  for (const value of items) {
    const item = textItem(value);
    if (!item) continue;
    const nextBaseline = baseline(item);
    const nextHeight = itemHeight(item);
    const tolerance = Math.max(2, Math.min(8, Math.max(currentHeight, nextHeight) * 0.45));
    if (
      current
      && currentBaseline !== undefined
      && nextBaseline !== undefined
      && Math.abs(nextBaseline - currentBaseline) > tolerance
    ) {
      flush();
    }
    current = appendTextPiece(current, item.str);
    if (nextBaseline !== undefined) currentBaseline = nextBaseline;
    currentHeight = Math.max(currentHeight, nextHeight);
    if (item.hasEOL === true) flush();
  }
  flush();
  return lines;
}
