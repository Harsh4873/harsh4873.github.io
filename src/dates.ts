export const DAY_MS = 86_400_000;

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

export function addDays(date: Date, amount: number) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12, 0, 0, 0);
}

export function addYears(date: Date, amount: number) {
  return new Date(date.getFullYear() + amount, date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

export function differenceInCalendarDays(later: Date, earlier: Date) {
  const laterUtc = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierUtc = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterUtc - earlierUtc) / DAY_MS);
}

export function startOfWeek(date: Date, weekStartsOn: 0 | 1) {
  const current = startOfDay(date);
  const distance = (current.getDay() - weekStartsOn + 7) % 7;
  return addDays(current, -distance);
}

export function endOfWeek(date: Date, weekStartsOn: 0 | 1) {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

export function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
}

export function daysBetween(start: Date, end: Date) {
  const length = Math.max(0, differenceInCalendarDays(end, start) + 1);
  return Array.from({ length }, (_, index) => addDays(start, index));
}

export function getWeekDays(date: Date, weekStartsOn: 0 | 1) {
  const start = startOfWeek(date, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function getMonthGrid(date: Date, weekStartsOn: 0 | 1) {
  const start = startOfWeek(startOfMonth(date), weekStartsOn);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function getRollingHeatmapDays(anchor: Date, weekStartsOn: 0 | 1) {
  const end = endOfWeek(anchor, weekStartsOn);
  const start = addDays(end, -(53 * 7 - 1));
  return daysBetween(start, end);
}

export function isSameDate(left: Date, right: Date) {
  return toDateKey(left) === toDateKey(right);
}

export function isAfterDate(left: Date, right: Date) {
  return toDateKey(left) > toDateKey(right);
}

export function isBeforeDate(left: Date, right: Date) {
  return toDateKey(left) < toDateKey(right);
}

export function clampToToday(date: Date) {
  const today = startOfDay(new Date());
  return isAfterDate(date, today) ? today : date;
}

export function formatFullDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatMonthYear(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
}

export function formatCompactDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

export function formatDateRange(start: Date, end: Date) {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }

  if (sameYear) {
    return `${formatCompactDate(start)} – ${formatCompactDate(end)}, ${end.getFullYear()}`;
  }

  return `${formatCompactDate(start)}, ${start.getFullYear()} – ${formatCompactDate(end)}, ${end.getFullYear()}`;
}

export function isToday(date: Date) {
  return isSameDate(date, new Date());
}

export function minDate(left: Date, right: Date) {
  return isBeforeDate(left, right) ? left : right;
}
