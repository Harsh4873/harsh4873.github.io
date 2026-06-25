import type { Exercise, Weekday } from './types';

export const WEEK_DAYS: Weekday[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export const DEFAULT_PROGRAM: Record<Weekday, string[]> = {
  Monday: [
    'Flat Bench',
    'Wall Calf Stretch',
    'Standing Hamstring Stretch with Heel Elevated',
    'Shoulder Press',
    'Standing Quad Stretch',
    'Standing Hip Flexor Stretch',
    'Tricep Nippard',
    'Standing Figure 4 Glute Stretch',
    'Lateral Raises',
    'Forward fold',
    'Incline Dumbbell Machine',
    'Lunges',
    'Dips',
    'Tibialis stretch',
    'Basketball 60 minutes',
  ],
  Tuesday: [
    'T bar row or landmine row or dumbell row',
    'Incline sit ups',
    'Face away cable curls',
    'Ab machine',
    'D-Bar attached Lat pull down',
    'Rope curl',
    'Low row cables',
    'Ez bar + conc. curl',
    'Back extensions',
    'Leg/Knee raises',
    'Basketball 30 minutes',
  ],
  Wednesday: [
    'Sissy Squats',
    'Chest stretch',
    'Triceps stretch',
    'Sitting Calf Raises',
    'Shoulder stretch',
    'Hip Thrust',
    'Bicep stretch',
    'Leg extensions',
    'Lat stretch',
    'Trap stretch',
    'Lying Leg raises',
    'Neck stretch',
    'In n outs',
    'Out n ins',
    'Basketball 60 minutes',
  ],
  Thursday: [
    'Flat Bench',
    'Single arm lat pulldown',
    'Ab machine',
    'Incline dumbell press',
    'incline sit ups',
    'Single arm lat pull-down',
    'Tricep pressdown + Tricep pull',
    'Dips',
    'Back extension',
    'Leg/Knee raises',
    'Basketball 30 minutes',
  ],
  Friday: [
    'Shoulder press dumbbells',
    'Preacher curls',
    'Face pulls',
    'Ez bar/concentration',
    'Front raises',
    'Lateral raises',
    'Basketball 60 minutes',
  ],
  Saturday: ['Full Body Stretch'],
  Sunday: ['Back extension', 'Abs circuit', 'incline sit ups', 'Ab machine', 'Leg/Knee raises', 'Ab rolls'],
};

export const PROGRAM: Record<Weekday, Exercise[]> = WEEK_DAYS.reduce((program, day) => {
  program[day] = DEFAULT_PROGRAM[day].map((name, index) => ({
    id: `${day.toLowerCase()}-${index + 1}`,
    day,
    name,
  }));

  return program;
}, {} as Record<Weekday, Exercise[]>);

export function getBasketballMinutes(name: string): number {
  const match = name.match(/^Basketball\s+(\d+)\s+minutes$/);
  return match ? Number(match[1]) : 0;
}

export function isStretchExercise(name: string): boolean {
  return /stretch|fold/i.test(name);
}
