import type { DateKey, WeekStartsOn } from './model';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isDateKey(value: string): value is DateKey {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function assertDateKey(value: string): asserts value is DateKey {
  if (!isDateKey(value)) {
    throw new RangeError(`Invalid local date key: ${value}`);
  }
}

export function toDateKey(date: Date): DateKey {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid Date');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local noon avoids DST gaps and overlaps when doing calendar operations. */
export function fromDateKey(dateKey: DateKey): Date {
  assertDateKey(dateKey);
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toUtcDayNumber(dateKey: DateKey): number {
  assertDateKey(dateKey);
  const [year, month, day] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function fromUtcDayNumber(dayNumber: number): DateKey {
  const date = new Date(dayNumber * DAY_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: DateKey, amount: number): DateKey {
  if (!Number.isInteger(amount)) throw new RangeError('Day amount must be an integer');
  return fromUtcDayNumber(toUtcDayNumber(dateKey) + amount);
}

/** Signed whole calendar days: positive when `to` is after `from`. */
export function daysBetween(from: DateKey, to: DateKey): number {
  return toUtcDayNumber(to) - toUtcDayNumber(from);
}

export function weekdayOf(dateKey: DateKey): number {
  const dayNumber = toUtcDayNumber(dateKey);
  return new Date(dayNumber * DAY_MS).getUTCDay();
}

export function startOfWeek(
  dateKey: DateKey,
  weekStartsOn: WeekStartsOn = 1,
): DateKey {
  const weekday = weekdayOf(dateKey);
  const offset = (weekday - weekStartsOn + 7) % 7;
  return addDays(dateKey, -offset);
}

export function endOfWeek(
  dateKey: DateKey,
  weekStartsOn: WeekStartsOn = 1,
): DateKey {
  return addDays(startOfWeek(dateKey, weekStartsOn), 6);
}

export function dateRange(start: DateKey, end: DateKey): DateKey[] {
  const length = daysBetween(start, end);
  if (length < 0) return [];
  return Array.from({ length: length + 1 }, (_, index) => addDays(start, index));
}

export function minuteOfDay(date: Date): number {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid Date');
  return date.getHours() * 60 + date.getMinutes();
}

export function minuteOfDayFromIso(value: string): number | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : minuteOfDay(date);
}
