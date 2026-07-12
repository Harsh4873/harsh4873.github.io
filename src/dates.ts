const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Noon anchoring dodges DST boundaries when adding whole days.
export function fromDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false;
  const parsed = fromDateKey(value);
  return toDateKey(parsed) === value;
}

export function addDays(date: Date, amount: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  next.setDate(next.getDate() + amount);
  return next;
}

export function isToday(date: Date) {
  return toDateKey(date) === toDateKey(new Date());
}

export function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

const fullDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

const compactDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

export function formatFullDate(date: Date) {
  return fullDateFormatter.format(date);
}

export function formatCompactDate(date: Date) {
  return compactDateFormatter.format(date);
}

export function formatDueKey(key: string) {
  const todayKey = toDateKey(new Date());
  if (key === todayKey) return 'Today';
  if (key === toDateKey(addDays(new Date(), 1))) return 'Tomorrow';
  if (key === toDateKey(addDays(new Date(), -1))) return 'Yesterday';
  return compactDateFormatter.format(fromDateKey(key));
}

export function isOverdueKey(key: string) {
  return key < toDateKey(new Date());
}
