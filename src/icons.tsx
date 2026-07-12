import {
  Activity,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Code2,
  Droplets,
  Dumbbell,
  Footprints,
  HeartPulse,
  Leaf,
  MoonStar,
  PencilLine,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { HabitIcon } from './model';

export const habitIconMap: Record<HabitIcon, LucideIcon> = {
  activity: Activity,
  book: BookOpen,
  brain: Brain,
  briefcase: BriefcaseBusiness,
  code: Code2,
  droplet: Droplets,
  dumbbell: Dumbbell,
  footprints: Footprints,
  heart: HeartPulse,
  leaf: Leaf,
  moon: MoonStar,
  pencil: PencilLine,
  sun: Sun,
  users: Users,
};

export function HabitGlyph({ icon, label }: { icon: HabitIcon; label?: string }) {
  const Icon = habitIconMap[icon];
  return <Icon aria-hidden={label ? undefined : true} aria-label={label} />;
}
