import { describe, expect, it } from 'vitest';
import { createInitialState } from './model';
import { parseSlateState } from './store';

describe('createInitialState', () => {
  it('stamps starter content at epoch 0 so tombstones and real edits always win the merge', () => {
    const initial = createInitialState();
    const epoch = new Date(0).toISOString();
    expect(initial.settings.updatedAt).toBe(epoch);
    for (const entity of [...initial.sections, ...initial.tasks]) {
      expect(entity.updatedAt).toBe(epoch);
    }
  });
});

describe('parseSlateState', () => {
  it('round-trips the initial state', () => {
    const initial = createInitialState('2026-07-12T10:00:00.000Z');
    const parsed = parseSlateState(JSON.parse(JSON.stringify(initial)));
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.tasks).toHaveLength(3);
    expect(parsed.settings.theme).toBe('dark');
  });

  it('rejects unsupported versions and missing collections', () => {
    expect(() => parseSlateState({ version: 2, sections: [], tasks: [], blocks: [] })).toThrow(/version/i);
    expect(() => parseSlateState({ version: 1, sections: [], tasks: [] })).toThrow(/missing/i);
    expect(() => parseSlateState(null)).toThrow();
  });

  it('backfills defaults for settings and invalid colors', () => {
    const state = createInitialState('2026-07-12T10:00:00.000Z');
    const raw = JSON.parse(JSON.stringify(state));
    delete raw.settings;
    raw.sections[0].color = 'rebeccapurple';
    const parsed = parseSlateState(raw);
    expect(parsed.settings.theme).toBe('dark');
    expect(parsed.settings.hideCompleted).toBe(false);
    expect(parsed.sections[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('keeps tombstones and orphaned tasks so sync snapshots can interleave', () => {
    const state = createInitialState('2026-07-12T10:00:00.000Z');
    const raw = JSON.parse(JSON.stringify(state));
    raw.tasks[0].deleted = true;
    raw.tasks[1].sectionId = 'section-not-seen-yet';
    const parsed = parseSlateState(raw);
    expect(parsed.tasks.find((task) => task.id === raw.tasks[0].id)?.deleted).toBe(true);
    expect(parsed.tasks.find((task) => task.id === raw.tasks[1].id)?.sectionId).toBe('section-not-seen-yet');
  });

  it('rejects duplicate ids and malformed schedule blocks', () => {
    const state = createInitialState('2026-07-12T10:00:00.000Z');
    const duplicated = JSON.parse(JSON.stringify(state));
    duplicated.tasks.push(duplicated.tasks[0]);
    expect(() => parseSlateState(duplicated)).toThrow(/duplicate/i);

    const badBlock = JSON.parse(JSON.stringify(state));
    badBlock.blocks.push({
      id: 'block-bad',
      dateKey: '2026-07-12',
      startMin: 400,
      durationMin: 30,
      title: 'Too early',
      color: '#8d7cff',
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:00:00.000Z',
    });
    expect(() => parseSlateState(badBlock)).toThrow(/invalid schedule block/i);
  });

  it('rejects ids that cannot be Firestore document ids', () => {
    const state = createInitialState('2026-07-12T10:00:00.000Z');
    const bad = JSON.parse(JSON.stringify(state));
    bad.tasks[0].id = 'a/b';
    expect(() => parseSlateState(bad)).toThrow(/invalid task/i);

    const reserved = JSON.parse(JSON.stringify(state));
    reserved.sections[0].id = '__name__';
    expect(() => parseSlateState(reserved)).toThrow(/invalid/i);
  });
});
