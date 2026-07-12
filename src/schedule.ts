import type { Block } from './model';

// The planning day runs 7:30 AM to 11:30 PM in 30-minute slots.
export const SLOT_MIN = 30;
export const DAY_START_MIN = 7 * 60 + 30;
export const DAY_END_MIN = 23 * 60 + 30;
export const SLOT_COUNT = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;

export function slotStart(index: number) {
  return DAY_START_MIN + index * SLOT_MIN;
}

export function slotIndexFor(startMin: number) {
  return Math.round((startMin - DAY_START_MIN) / SLOT_MIN);
}

export function clampSlotIndex(index: number) {
  return Math.min(Math.max(index, 0), SLOT_COUNT - 1);
}

export function formatMinutes(totalMin: number) {
  const hours24 = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${`${minutes}`.padStart(2, '0')} ${meridiem}`;
}

export function formatBlockRange(block: Pick<Block, 'startMin' | 'durationMin'>) {
  return `${formatMinutes(block.startMin)} – ${formatMinutes(block.startMin + block.durationMin)}`;
}

export function isValidBlockTiming(startMin: number, durationMin: number) {
  return Number.isInteger(startMin)
    && Number.isInteger(durationMin)
    && startMin >= DAY_START_MIN
    && durationMin >= SLOT_MIN
    && durationMin % SLOT_MIN === 0
    && (startMin - DAY_START_MIN) % SLOT_MIN === 0
    && startMin + durationMin <= DAY_END_MIN;
}

export function liveBlocksForDay(blocks: Block[], dateKey: string) {
  return blocks
    .filter((block) => !block.deleted && block.dateKey === dateKey)
    .sort((left, right) => left.startMin - right.startMin || left.id.localeCompare(right.id));
}

export function blocksOverlap(
  left: Pick<Block, 'startMin' | 'durationMin'>,
  right: Pick<Block, 'startMin' | 'durationMin'>,
) {
  return left.startMin < right.startMin + right.durationMin
    && right.startMin < left.startMin + left.durationMin;
}

/** Whether a candidate block fits the day without touching existing blocks. */
export function fitsDay(
  dayBlocks: Block[],
  startMin: number,
  durationMin: number,
  excludeId?: string,
) {
  if (!isValidBlockTiming(startMin, durationMin)) return false;
  const candidate = { startMin, durationMin };
  return dayBlocks.every((block) => block.id === excludeId || !blocksOverlap(candidate, block));
}

/** The longest duration a block at startMin can grow to before hitting the next block or day end. */
export function maxDurationAt(dayBlocks: Block[], startMin: number, excludeId?: string) {
  let limit = DAY_END_MIN;
  for (const block of dayBlocks) {
    if (block.id === excludeId) continue;
    if (block.startMin >= startMin) limit = Math.min(limit, block.startMin);
    else if (block.startMin + block.durationMin > startMin) return 0;
  }
  return Math.max(0, limit - startMin);
}

/** Start times (slot-aligned) where a block of durationMin fits, for the editor's start picker. */
export function availableStarts(dayBlocks: Block[], durationMin: number, excludeId?: string) {
  const starts: number[] = [];
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const startMin = slotStart(index);
    if (startMin + durationMin > DAY_END_MIN) break;
    if (fitsDay(dayBlocks, startMin, durationMin, excludeId)) starts.push(startMin);
  }
  return starts;
}

export function plannedMinutes(dayBlocks: Block[]) {
  return dayBlocks.reduce((total, block) => total + block.durationMin, 0);
}

export function formatHours(totalMin: number) {
  const hours = totalMin / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

/** Minutes-into-grid for the current wall-clock time, or null when outside the grid. */
export function nowOffsetMinutes(now: Date) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < DAY_START_MIN || minutes > DAY_END_MIN) return null;
  return minutes - DAY_START_MIN;
}
