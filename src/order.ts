export const ORDER_GAP = 1000;

interface Ordered {
  order: number;
}

/**
 * A sort position between two neighbours. Callers renormalize the whole list
 * when the midpoint collapses (gap too small to split further).
 */
export function orderBetween(previous: number | undefined, next: number | undefined) {
  if (previous === undefined && next === undefined) return ORDER_GAP;
  if (previous === undefined) return (next as number) - ORDER_GAP;
  if (next === undefined) return previous + ORDER_GAP;
  return (previous + next) / 2;
}

export function needsRebalance(previous: number | undefined, next: number | undefined) {
  if (previous === undefined || next === undefined) return false;
  return Math.abs(next - previous) < 1e-6;
}

export function sortByOrder<T extends Ordered & { id: string }>(items: T[]) {
  return [...items].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

/**
 * Evenly re-spaced orders (ORDER_GAP apart) preserving the ARRAY sequence.
 * Callers pass items already arranged in the intended order — re-sorting here
 * would discard the very position a collapsed midpoint was trying to express.
 */
export function rebalanced<T extends { id: string }>(items: T[]): Map<string, number> {
  const assignments = new Map<string, number>();
  items.forEach((item, index) => {
    assignments.set(item.id, (index + 1) * ORDER_GAP);
  });
  return assignments;
}
