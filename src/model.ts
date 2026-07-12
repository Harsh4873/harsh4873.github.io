export type GoalPeriod = 'day' | 'week' | 'month';
export type MetricType = 'check' | 'count' | 'duration' | 'quantity' | 'distance';
export type GoalDirection = 'atLeast' | 'atMost';
export type TimeSlot = 'morning' | 'anytime' | 'evening';
export type ThemePreference = 'dark' | 'light' | 'system';

export type HabitIcon =
  | 'activity'
  | 'book'
  | 'brain'
  | 'briefcase'
  | 'code'
  | 'droplet'
  | 'dumbbell'
  | 'footprints'
  | 'heart'
  | 'leaf'
  | 'moon'
  | 'pencil'
  | 'sun'
  | 'users';

export type HabitSchedule =
  | { type: 'everyday' }
  | { type: 'selectedDays'; days: number[] }
  | { type: 'interval'; every: number; unit: 'day' | 'week' };

export interface Habit {
  id: string;
  name: string;
  category: string;
  icon: HabitIcon;
  color: string;
  metric: MetricType;
  target: number;
  unit: string;
  period: GoalPeriod;
  direction: GoalDirection;
  schedule: HabitSchedule;
  timeSlot: TimeSlot;
  increment: number;
  startDate: string;
  createdAt: string;
  updatedAt: string;
  order: number;
  archivedAt?: string;
  pauses?: Array<{ start: string; end?: string }>;
}

export interface HabitEntry {
  value: number;
  hasValue?: boolean;
  skipped?: boolean;
  note?: string;
  updatedAt: string;
}

export interface TrackerProfile {
  displayName: string;
  weekStartsOn: 0 | 1;
  theme: ThemePreference;
  updatedAt: string;
  lastBackupAt?: string;
}

export interface TrackerState {
  version: 2;
  generationId: string;
  generationUpdatedAt: string;
  generationPending: boolean;
  profile: TrackerProfile;
  habits: Habit[];
  entries: Record<string, Record<string, HabitEntry>>;
}

export const CATEGORY_SUGGESTIONS = [
  'Movement',
  'Mind',
  'Health',
  'Craft',
  'Relationships',
  'Recovery',
];

export const HABIT_COLORS = [
  '#b8f35b',
  '#8d7cff',
  '#ff8e64',
  '#58c9d6',
  '#f4c95d',
  '#f47ea8',
  '#69d69c',
  '#73a7ff',
];

export const HABIT_ICONS: HabitIcon[] = [
  'activity',
  'dumbbell',
  'footprints',
  'book',
  'brain',
  'code',
  'briefcase',
  'droplet',
  'heart',
  'leaf',
  'moon',
  'pencil',
  'sun',
  'users',
];

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function makeHabitId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `habit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function makeGenerationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `generation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface InitialStateOptions {
  generationId?: string;
  generationUpdatedAt?: string;
  generationPending?: boolean;
  now?: string;
  startDate?: string;
}

export function createInitialState(options: InitialStateOptions = {}): TrackerState {
  const now = options.now ?? new Date().toISOString();
  const today = options.startDate ?? localDateKey(new Date(now));
  const generationId = options.generationId ?? 'local-v1';
  const generationUpdatedAt = options.generationUpdatedAt
    ?? (generationId === 'local-v1' ? '1970-01-01T00:00:00.000Z' : now);
  const entityUpdatedAt = generationId === 'local-v1' ? generationUpdatedAt : now;

  const habits: Habit[] = [
    {
      id: 'starter-steps',
      name: '10K steps',
      category: 'Movement',
      icon: 'footprints',
      color: '#b8f35b',
      metric: 'quantity',
      target: 10000,
      unit: 'steps',
      period: 'day',
      direction: 'atLeast',
      schedule: { type: 'everyday' },
      timeSlot: 'anytime',
      increment: 1000,
      startDate: today,
      createdAt: now,
      updatedAt: entityUpdatedAt,
      order: 0,
    },
    {
      id: 'starter-read',
      name: 'Read',
      category: 'Mind',
      icon: 'book',
      color: '#8d7cff',
      metric: 'duration',
      target: 20,
      unit: 'min',
      period: 'day',
      direction: 'atLeast',
      schedule: { type: 'everyday' },
      timeSlot: 'evening',
      increment: 5,
      startDate: today,
      createdAt: now,
      updatedAt: entityUpdatedAt,
      order: 1,
    },
    {
      id: 'starter-train',
      name: 'Train',
      category: 'Movement',
      icon: 'dumbbell',
      color: '#ff8e64',
      metric: 'check',
      target: 4,
      unit: 'sessions',
      period: 'week',
      direction: 'atLeast',
      schedule: { type: 'everyday' },
      timeSlot: 'anytime',
      increment: 1,
      startDate: today,
      createdAt: now,
      updatedAt: entityUpdatedAt,
      order: 2,
    },
    {
      id: 'starter-focus',
      name: 'Deep work',
      category: 'Craft',
      icon: 'brain',
      color: '#58c9d6',
      metric: 'duration',
      target: 90,
      unit: 'min',
      period: 'day',
      direction: 'atLeast',
      schedule: { type: 'selectedDays', days: [1, 2, 3, 4, 5] },
      timeSlot: 'morning',
      increment: 15,
      startDate: today,
      createdAt: now,
      updatedAt: entityUpdatedAt,
      order: 3,
    },
  ];

  return {
    version: 2,
    generationId,
    generationUpdatedAt,
    generationPending: options.generationPending ?? false,
    profile: {
      displayName: 'Harsh',
      weekStartsOn: 1,
      theme: 'dark',
      updatedAt: entityUpdatedAt,
    },
    habits,
    entries: {},
  };
}
