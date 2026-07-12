import { describe, expect, it } from 'vitest';
import { ORDER_GAP, needsRebalance, orderBetween, rebalanced, sortByOrder } from './order';

describe('fractional ordering', () => {
  it('places items at the start, middle, and end', () => {
    expect(orderBetween(undefined, undefined)).toBe(ORDER_GAP);
    expect(orderBetween(2000, undefined)).toBe(3000);
    expect(orderBetween(undefined, 1000)).toBe(0);
    expect(orderBetween(1000, 2000)).toBe(1500);
  });

  it('flags collapsed midpoints for rebalancing', () => {
    expect(needsRebalance(1000, 2000)).toBe(false);
    expect(needsRebalance(1000, 1000 + 1e-9)).toBe(true);
    expect(needsRebalance(undefined, 1000)).toBe(false);
  });

  it('sorts by order with a stable id tie-break', () => {
    const items = [
      { id: 'b', order: 10 },
      { id: 'a', order: 10 },
      { id: 'c', order: 5 },
    ];
    expect(sortByOrder(items).map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('re-spaces the whole list evenly, preserving the array sequence', () => {
    // Array order is intent — the moved item still carries its stale order
    // value, so rebalancing must NOT re-sort by it.
    const items = [
      { id: 'first', order: 1 },
      { id: 'moved-here', order: 999 },
      { id: 'third', order: 1.0000000002 },
    ];
    const assignments = rebalanced(items);
    expect(assignments.get('first')).toBe(ORDER_GAP);
    expect(assignments.get('moved-here')).toBe(2 * ORDER_GAP);
    expect(assignments.get('third')).toBe(3 * ORDER_GAP);
  });
});
