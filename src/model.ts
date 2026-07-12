export type ThemePreference = 'dark' | 'light' | 'system';

export interface SlateSettings {
  theme: ThemePreference;
  hideCompleted: boolean;
  updatedAt: string;
}

export interface Section {
  id: string;
  title: string;
  color: string;
  order: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface Task {
  id: string;
  sectionId: string;
  title: string;
  notes: string;
  done: boolean;
  completedAt?: string;
  due?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface Block {
  id: string;
  dateKey: string;
  startMin: number;
  durationMin: number;
  title: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface SlateState {
  version: 1;
  settings: SlateSettings;
  sections: Section[];
  tasks: Task[];
  blocks: Block[];
}

export const SLATE_COLORS = [
  '#b8f35b',
  '#8d7cff',
  '#ff8e64',
  '#58c9d6',
  '#f2c94c',
  '#e37ec1',
] as const;

export const SLATE_COLOR_NAMES: Record<string, string> = {
  '#b8f35b': 'Lime',
  '#8d7cff': 'Violet',
  '#ff8e64': 'Coral',
  '#58c9d6': 'Cyan',
  '#f2c94c': 'Gold',
  '#e37ec1': 'Pink',
};

export const DEFAULT_COLOR = SLATE_COLORS[0];

export function makeId(prefix = 'slate') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Starter content is stamped at epoch 0: the ids are fixed, so a fresh device
// must never beat a real edit — or a tombstone — of the same starter entity in
// the last-write-wins merge. Any genuine change immediately outranks this.
export function createInitialState(now = new Date(0).toISOString()): SlateState {
  const inboxId = 'starter-inbox';
  return {
    version: 1,
    settings: { theme: 'dark', hideCompleted: false, updatedAt: now },
    sections: [
      {
        id: inboxId,
        title: 'Inbox',
        color: '#b8f35b',
        order: 1000,
        collapsed: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [
      {
        id: 'starter-task-first',
        sectionId: inboxId,
        title: 'Check off your first task',
        notes: '',
        done: false,
        order: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'starter-task-sections',
        sectionId: inboxId,
        title: 'Add sections for school, work, or projects',
        notes: '',
        done: false,
        order: 2000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'starter-task-plan',
        sectionId: inboxId,
        title: 'Block out tomorrow on the Schedule tab',
        notes: '',
        done: false,
        order: 3000,
        createdAt: now,
        updatedAt: now,
      },
    ],
    blocks: [],
  };
}
