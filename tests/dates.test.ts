import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateRange,
  daysBetween,
  endOfWeek,
  fromDateKey,
  isDateKey,
  startOfWeek,
  toDateKey,
  weekdayOf,
} from '../src/dates';

describe('date helpers', () => {
  it('validates real Gregorian local dates', () => {
    expect(isDateKey('2024-02-29')).toBe(true);
    expect(isDateKey('2025-02-29')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('7/12/2026')).toBe(false);
  });

  it('round-trips a local date key at safe local noon', () => {
    const date = fromDateKey('2026-07-12');
    expect(date.getHours()).toBe(12);
    expect(toDateKey(date)).toBe('2026-07-12');
  });

  it('uses calendar arithmetic across leap days', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(dateRange('2024-02-28', '2024-03-01')).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
  });

  it('finds Sunday- and Monday-based week boundaries', () => {
    expect(weekdayOf('2026-07-12')).toBe(0);
    expect(startOfWeek('2026-07-12', 1)).toBe('2026-07-06');
    expect(endOfWeek('2026-07-12', 1)).toBe('2026-07-12');
    expect(startOfWeek('2026-07-12', 0)).toBe('2026-07-12');
    expect(endOfWeek('2026-07-12', 0)).toBe('2026-07-18');
  });
});
