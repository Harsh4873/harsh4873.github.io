import { describe, expect, it } from 'vitest';
import type { Block } from './model';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  SLOT_COUNT,
  SLOT_MIN,
  availableStarts,
  blocksOverlap,
  fitsDay,
  formatBlockRange,
  formatHours,
  formatMinutes,
  isValidBlockTiming,
  liveBlocksForDay,
  maxDurationAt,
  nowOffsetMinutes,
  plannedMinutes,
  slotIndexFor,
  slotStart,
} from './schedule';

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'block-1',
    dateKey: '2026-07-12',
    startMin: 9 * 60,
    durationMin: 60,
    title: 'Focus',
    color: '#8d7cff',
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T08:00:00.000Z',
    ...overrides,
  };
}

describe('slot geometry', () => {
  it('covers 7:30 AM through 11:30 PM in 30-minute slots', () => {
    expect(DAY_START_MIN).toBe(450);
    expect(DAY_END_MIN).toBe(1410);
    expect(SLOT_COUNT).toBe(32);
    expect(slotStart(0)).toBe(450);
    expect(slotStart(SLOT_COUNT - 1) + SLOT_MIN).toBe(DAY_END_MIN);
  });

  it('round-trips slot indices', () => {
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      expect(slotIndexFor(slotStart(index))).toBe(index);
    }
  });
});

describe('time formatting', () => {
  it('formats 12-hour labels', () => {
    expect(formatMinutes(450)).toBe('7:30 AM');
    expect(formatMinutes(720)).toBe('12:00 PM');
    expect(formatMinutes(1410)).toBe('11:30 PM');
    expect(formatMinutes(0)).toBe('12:00 AM');
  });

  it('formats block ranges and durations', () => {
    expect(formatBlockRange({ startMin: 600, durationMin: 90 })).toBe('10:00 AM – 11:30 AM');
    expect(formatHours(90)).toBe('1.5h');
    expect(formatHours(120)).toBe('2h');
  });
});

describe('block timing validation', () => {
  it('accepts slot-aligned blocks inside the day window', () => {
    expect(isValidBlockTiming(450, 30)).toBe(true);
    expect(isValidBlockTiming(1380, 30)).toBe(true);
    expect(isValidBlockTiming(600, 240)).toBe(true);
  });

  it('rejects misaligned, out-of-window, or overlong blocks', () => {
    expect(isValidBlockTiming(445, 30)).toBe(false);
    expect(isValidBlockTiming(450, 45)).toBe(false);
    expect(isValidBlockTiming(420, 30)).toBe(false);
    expect(isValidBlockTiming(1410, 30)).toBe(false);
    expect(isValidBlockTiming(1380, 60)).toBe(false);
  });
});

describe('day occupancy', () => {
  const day = [
    makeBlock({ id: 'block-a', startMin: 540, durationMin: 60 }),
    makeBlock({ id: 'block-b', startMin: 720, durationMin: 90 }),
  ];

  it('detects overlap in both directions', () => {
    expect(blocksOverlap({ startMin: 540, durationMin: 60 }, { startMin: 570, durationMin: 60 })).toBe(true);
    expect(blocksOverlap({ startMin: 540, durationMin: 60 }, { startMin: 600, durationMin: 30 })).toBe(false);
  });

  it('rejects placements that collide and accepts free space', () => {
    expect(fitsDay(day, 570, 30)).toBe(false);
    expect(fitsDay(day, 600, 120)).toBe(true);
    expect(fitsDay(day, 600, 150)).toBe(false);
  });

  it('ignores the block being edited when checking fit', () => {
    expect(fitsDay(day, 540, 90, 'block-a')).toBe(true);
  });

  it('caps duration at the next block or the end of day', () => {
    expect(maxDurationAt(day, 600)).toBe(120);
    expect(maxDurationAt(day, 810)).toBe(DAY_END_MIN - 810);
    expect(maxDurationAt(day, 750)).toBe(0);
    expect(maxDurationAt(day, 720, 'block-b')).toBe(DAY_END_MIN - 720);
  });

  it('lists only free slot-aligned starts', () => {
    const starts = availableStarts(day, 60);
    expect(starts).toContain(450);
    expect(starts).toContain(600);
    expect(starts).not.toContain(540);
    expect(starts).not.toContain(510);
    expect(starts).not.toContain(1380);
  });

  it('filters, sorts, and totals a day of blocks', () => {
    const blocks = [
      makeBlock({ id: 'later', startMin: 900 }),
      makeBlock({ id: 'earlier', startMin: 480 }),
      makeBlock({ id: 'deleted', startMin: 600, deleted: true }),
      makeBlock({ id: 'other-day', dateKey: '2026-07-13' }),
    ];
    const day = liveBlocksForDay(blocks, '2026-07-12');
    expect(day.map((block) => block.id)).toEqual(['earlier', 'later']);
    expect(plannedMinutes(day)).toBe(120);
  });
});

describe('now indicator', () => {
  it('maps wall-clock time inside the window and hides outside it', () => {
    expect(nowOffsetMinutes(new Date(2026, 6, 12, 7, 29))).toBeNull();
    expect(nowOffsetMinutes(new Date(2026, 6, 12, 7, 30))).toBe(0);
    expect(nowOffsetMinutes(new Date(2026, 6, 12, 12, 0))).toBe(270);
    expect(nowOffsetMinutes(new Date(2026, 6, 12, 23, 30))).toBe(960);
    expect(nowOffsetMinutes(new Date(2026, 6, 12, 23, 31))).toBeNull();
  });
});
