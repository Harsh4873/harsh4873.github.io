export type Weekday =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

export type TabId = 'today' | 'week' | 'calendar' | 'milestones' | 'logbook' | 'settings';

export type ThemeMode = 'dark' | 'light';

export type DayStatus = 'completed' | 'partial' | 'skipped' | 'future';

export type WeightMode = 'bodyweight' | 'pounds';

export interface Exercise {
  id: string;
  day: Weekday;
  name: string;
}

export interface SupersetPair {
  id: string;
  exerciseIds: [string, string];
}

export interface ExerciseSet {
  id: string;
  weightMode: WeightMode;
  pounds: string;
  reps: string;
}

export interface ExerciseDetail {
  sets: ExerciseSet[];
  legacyNote?: string;
}

export interface WorkoutLog {
  date: string;
  completed: string[];
  skipped: string[];
  details: Record<string, ExerciseDetail>;
  notes: string;
  prNote: string;
  supersets: SupersetPair[];
  daySkipped: boolean;
  updatedAt: string;
}

export type LogsByDate = Record<string, WorkoutLog>;

export type ExerciseOrderByDay = Record<Weekday, string[]>;
