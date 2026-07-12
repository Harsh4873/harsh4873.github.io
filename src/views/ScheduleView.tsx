import { CalendarClock, CopyPlus, Eraser, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, formatCompactDate, formatDueKey, formatFullDate, isToday, toDateKey } from '../dates';
import { DEFAULT_COLOR, type Block, type SlateState, type Task } from '../model';
import {
  DAY_END_MIN,
  SLOT_COUNT,
  SLOT_MIN,
  availableStarts,
  clampSlotIndex,
  formatBlockRange,
  formatHours,
  formatMinutes,
  liveBlocksForDay,
  maxDurationAt,
  nowOffsetMinutes,
  plannedMinutes,
  slotIndexFor,
  slotStart,
} from '../schedule';
import type { SlateStore } from '../store';
import { ColorPicker, DateSwitcher, EmptyState, Modal, SectionHeading, accentStyle } from '../ui';

const SLOT_HEIGHT = 44;

type EditorState =
  | { mode: 'create'; startMin: number; durationMin: number }
  | { mode: 'edit'; block: Block };

interface ScheduleViewProps {
  state: SlateState;
  saveBlock: SlateStore['saveBlock'];
  deleteBlock: SlateStore['deleteBlock'];
  copyDayBlocks: SlateStore['copyDayBlocks'];
  clearDayBlocks: SlateStore['clearDayBlocks'];
  toggleTask: SlateStore['toggleTask'];
}

function BlockEditor({ editor, dayBlocks, dateKey, onClose, saveBlock, deleteBlock }: {
  editor: EditorState;
  dayBlocks: Block[];
  dateKey: string;
  onClose: () => void;
  saveBlock: SlateStore['saveBlock'];
  deleteBlock: SlateStore['deleteBlock'];
}) {
  const editingId = editor.mode === 'edit' ? editor.block.id : undefined;
  const [title, setTitle] = useState(editor.mode === 'edit' ? editor.block.title : '');
  const [startMin, setStartMin] = useState(editor.mode === 'edit' ? editor.block.startMin : editor.startMin);
  const [durationMin, setDurationMin] = useState(editor.mode === 'edit' ? editor.block.durationMin : editor.durationMin);
  const [color, setColor] = useState(editor.mode === 'edit' ? editor.block.color : DEFAULT_COLOR);

  const startOptions = useMemo(() => {
    const options = new Set(availableStarts(dayBlocks, SLOT_MIN, editingId));
    options.add(startMin);
    return [...options].sort((left, right) => left - right);
  }, [dayBlocks, editingId, startMin]);

  const maxDuration = Math.max(SLOT_MIN, maxDurationAt(dayBlocks, startMin, editingId));
  const clampedDuration = Math.min(durationMin, maxDuration);

  function moveStart(nextStart: number) {
    // Keep the DESIRED duration; clampedDuration bounds what is shown and
    // saved, so passing through a tight gap does not shrink the block.
    setStartMin(nextStart);
  }

  function submit() {
    saveBlock({
      id: editingId,
      dateKey,
      startMin,
      durationMin: clampedDuration,
      title: title.trim() || 'Untitled block',
      color,
    });
    onClose();
  }

  return (
    <Modal
      title={editor.mode === 'edit' ? 'Edit block' : 'New block'}
      onClose={onClose}
      footer={(
        <div className="modal-actions">
          {editor.mode === 'edit' && (
            <button
              type="button"
              className="button button-danger"
              onClick={() => {
                deleteBlock(editor.block.id);
                onClose();
              }}
            >
              <Trash2 aria-hidden="true" /> Delete
            </button>
          )}
          <span className="modal-actions-spacer" />
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="button button-primary" onClick={submit}>
            {editor.mode === 'edit' ? 'Save block' : 'Add block'}
          </button>
        </div>
      )}
    >
      <form
        className="block-editor"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span className="field-label">Title</span>
          <input
            type="text"
            value={title}
            placeholder="Deep work, gym, dinner…"
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Starts</span>
            <select value={startMin} onChange={(event) => moveStart(Number(event.target.value))}>
              {startOptions.map((option) => (
                <option key={option} value={option}>{formatMinutes(option)}</option>
              ))}
            </select>
          </label>

          <div className="field">
            <span className="field-label" id="block-duration-label">Duration</span>
            <div className="stepper" role="group" aria-labelledby="block-duration-label">
              <button
                type="button"
                onClick={() => setDurationMin((current) => Math.max(SLOT_MIN, current - SLOT_MIN))}
                disabled={clampedDuration <= SLOT_MIN}
                aria-label="Shorten by 30 minutes"
              >
                −
              </button>
              <strong>{formatHours(clampedDuration)}</strong>
              <button
                type="button"
                onClick={() => setDurationMin((current) => Math.min(maxDuration, current + SLOT_MIN))}
                disabled={clampedDuration >= maxDuration}
                aria-label="Extend by 30 minutes"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Color</span>
          <ColorPicker value={color} onChange={setColor} idPrefix="block-color" />
        </div>

        <p className="field-hint">
          {formatMinutes(startMin)} – {formatMinutes(startMin + clampedDuration)}
        </p>
      </form>
    </Modal>
  );
}

export function ScheduleView({ state, saveBlock, deleteBlock, copyDayBlocks, clearDayBlocks, toggleTask }: ScheduleViewProps) {
  const [date, setDate] = useState(() => new Date());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [dragRange, setDragRange] = useState<{ anchor: number; end: number } | null>(null);
  const [nowTick, setNowTick] = useState(() => new Date());
  const gridRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ anchor: number; end: number; pointerId: number } | null>(null);

  const dateKey = toDateKey(date);
  const viewingToday = isToday(date);
  const dayBlocks = useMemo(() => liveBlocksForDay(state.blocks, dateKey), [state.blocks, dateKey]);
  const yesterdayKey = toDateKey(addDays(date, -1));
  const yesterdayBlocks = useMemo(() => liveBlocksForDay(state.blocks, yesterdayKey), [state.blocks, yesterdayKey]);

  useEffect(() => {
    if (!viewingToday) return;
    setNowTick(new Date());
    const timer = window.setInterval(() => setNowTick(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [viewingToday]);

  const occupiedSlots = useMemo(() => {
    const occupied = new Set<number>();
    for (const block of dayBlocks) {
      const first = slotIndexFor(block.startMin);
      const span = block.durationMin / SLOT_MIN;
      for (let offset = 0; offset < span; offset += 1) occupied.add(first + offset);
    }
    return occupied;
  }, [dayBlocks]);

  const todayKey = toDateKey(new Date());
  const focusTasks = useMemo(() => {
    const open = state.tasks.filter((task): task is Task => !task.deleted && !task.done && Boolean(task.due) && (task.due as string) <= todayKey);
    return open.sort((left, right) => (left.due as string).localeCompare(right.due as string) || left.order - right.order);
  }, [state.tasks, todayKey]);

  const planned = plannedMinutes(dayBlocks);
  const nowOffset = viewingToday ? nowOffsetMinutes(nowTick) : null;

  function slotIndexFromClientY(clientY: number) {
    const grid = gridRef.current;
    if (!grid) return 0;
    const rect = grid.getBoundingClientRect();
    return clampSlotIndex(Math.floor((clientY - rect.top) / SLOT_HEIGHT));
  }

  /** Grow the selection from the anchor, stopping at the first occupied slot. */
  function clampDragEnd(anchor: number, rawEnd: number) {
    const step = rawEnd >= anchor ? 1 : -1;
    let end = anchor;
    for (let index = anchor + step; step > 0 ? index <= rawEnd : index >= rawEnd; index += step) {
      if (index < 0 || index >= SLOT_COUNT || occupiedSlots.has(index)) break;
      end = index;
    }
    return end;
  }

  function openCreateEditor(fromIndex: number, toIndex: number) {
    const first = Math.min(fromIndex, toIndex);
    const last = Math.max(fromIndex, toIndex);
    setEditor({
      mode: 'create',
      startMin: slotStart(first),
      durationMin: (last - first + 1) * SLOT_MIN,
    });
  }

  function onSlotPointerDown(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (occupiedSlots.has(index)) return;
    if (event.pointerType !== 'mouse') return; // touch keeps native scrolling; tap-create handles it
    event.preventDefault();
    dragStateRef.current = { anchor: index, end: index, pointerId: event.pointerId };
    setDragRange({ anchor: index, end: index });

    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      const end = clampDragEnd(drag.anchor, slotIndexFromClientY(moveEvent.clientY));
      if (end !== drag.end) {
        drag.end = end;
        setDragRange({ anchor: drag.anchor, end });
      }
    };
    const onUp = (upEvent: PointerEvent) => {
      const drag = dragStateRef.current;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (!drag || upEvent.pointerId !== drag.pointerId) return;
      dragStateRef.current = null;
      setDragRange(null);
      openCreateEditor(drag.anchor, drag.end);
    };
    const onCancel = () => {
      dragStateRef.current = null;
      setDragRange(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  const selection = dragRange
    ? { first: Math.min(dragRange.anchor, dragRange.end), last: Math.max(dragRange.anchor, dragRange.end) }
    : null;

  return (
    <section className="view schedule-view">
      <SectionHeading
        eyebrow="Time-boxed day"
        title={formatFullDate(date)}
        copy={dayBlocks.length
          ? `${dayBlocks.length} block${dayBlocks.length === 1 ? '' : 's'} · ${formatHours(planned)} planned · ${formatHours(DAY_END_MIN - slotStart(0) - planned)} free`
          : 'Nothing planned yet. Click a slot — or drag across a few — to box out time.'}
        action={(
          <DateSwitcher
            eyebrow={viewingToday ? 'Today' : formatDueKey(dateKey)}
            label={formatCompactDate(date)}
            onPrevious={() => setDate((current) => addDays(current, -1))}
            onNext={() => setDate((current) => addDays(current, 1))}
            onToday={() => setDate(new Date())}
            todayDisabled={viewingToday}
          />
        )}
      />

      <div className="schedule-layout">
        <div className="schedule-panel panel">
          <div className="schedule-toolbar">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => copyDayBlocks(yesterdayKey, dateKey)}
              disabled={yesterdayBlocks.length === 0}
              title="Copy yesterday's blocks into any free space on this day"
            >
              <CopyPlus aria-hidden="true" /> Copy yesterday
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                if (window.confirm(`Clear all ${dayBlocks.length} blocks on ${formatFullDate(date)}?`)) {
                  clearDayBlocks(dateKey);
                }
              }}
              disabled={dayBlocks.length === 0}
            >
              <Eraser aria-hidden="true" /> Clear day
            </button>
          </div>

          <div className="schedule-body">
            <div className="schedule-gutter" aria-hidden="true" style={{ height: SLOT_COUNT * SLOT_HEIGHT }}>
              {Array.from({ length: SLOT_COUNT }, (_, index) => {
                const minutes = slotStart(index);
                if (index !== 0 && minutes % 60 !== 0) return null;
                return (
                  <span key={minutes} className="schedule-gutter-label" style={{ top: index * SLOT_HEIGHT }}>
                    {formatMinutes(minutes)}
                  </span>
                );
              })}
            </div>

            <div
              className="schedule-grid"
              ref={gridRef}
              style={{ height: SLOT_COUNT * SLOT_HEIGHT }}
              role="group"
              aria-label={`Schedule for ${formatFullDate(date)}, 7:30 AM to 11:30 PM in 30 minute slots`}
            >
              {Array.from({ length: SLOT_COUNT }, (_, index) => {
                const minutes = slotStart(index);
                const occupied = occupiedSlots.has(index);
                const inSelection = selection && index >= selection.first && index <= selection.last;
                return (
                  <div
                    key={minutes}
                    className={`schedule-slot${minutes % 60 === 0 ? ' schedule-slot-hour' : ''}${inSelection ? ' schedule-slot-selected' : ''}`}
                    style={{ top: index * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                    onPointerDown={(event) => onSlotPointerDown(event, index)}
                  >
                    {!occupied && (
                      <button
                        type="button"
                        className="schedule-slot-add"
                        onClick={() => openCreateEditor(index, index)}
                        aria-label={`Add block at ${formatMinutes(minutes)}`}
                      >
                        <Plus aria-hidden="true" />
                        <span>{formatMinutes(minutes)}</span>
                      </button>
                    )}
                  </div>
                );
              })}

              {dayBlocks.map((block) => (
                <button
                  key={block.id}
                  type="button"
                  className="schedule-block"
                  style={{
                    ...accentStyle(block.color),
                    top: slotIndexFor(block.startMin) * SLOT_HEIGHT + 2,
                    height: (block.durationMin / SLOT_MIN) * SLOT_HEIGHT - 4,
                  }}
                  onClick={() => setEditor({ mode: 'edit', block })}
                >
                  <strong>{block.title}</strong>
                  <span>{formatBlockRange(block)}</span>
                </button>
              ))}

              {selection && (
                <div
                  className="schedule-selection"
                  aria-hidden="true"
                  style={{
                    top: selection.first * SLOT_HEIGHT,
                    height: (selection.last - selection.first + 1) * SLOT_HEIGHT,
                  }}
                >
                  {formatMinutes(slotStart(selection.first))} – {formatMinutes(slotStart(selection.last) + SLOT_MIN)}
                </div>
              )}

              {nowOffset !== null && (
                <div
                  className="schedule-now"
                  style={{ top: (nowOffset / SLOT_MIN) * SLOT_HEIGHT }}
                  aria-label={`Current time ${formatMinutes(nowOffset + slotStart(0))}`}
                >
                  <i />
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="schedule-aside">
          <div className="panel aside-panel">
            <div className="panel-heading">
              <h2><ListChecks aria-hidden="true" /> Due today</h2>
              <span className="panel-heading-note">{focusTasks.length ? `${focusTasks.length} open` : 'All clear'}</span>
            </div>
            {focusTasks.length === 0 ? (
              <EmptyState
                icon={<CalendarClock />}
                title="Nothing due"
                copy="Tasks with a due date of today (or overdue) appear here so the day plan and the list stay honest together."
              />
            ) : (
              <ul className="focus-list">
                {focusTasks.map((task) => (
                  <li key={task.id} className="focus-task">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => toggleTask(task.id)}
                      aria-label={`Mark ${task.title || 'untitled task'} done`}
                    />
                    <span className="focus-task-title">{task.title || 'Untitled task'}</span>
                    <span className={`due-chip${task.due && task.due < todayKey ? ' due-chip-overdue' : ''}`}>
                      {task.due ? formatDueKey(task.due) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <a className="aside-link" href="#todo">Open the full list →</a>
          </div>
        </aside>
      </div>

      {editor && (
        <BlockEditor
          editor={editor}
          dayBlocks={dayBlocks}
          dateKey={dateKey}
          onClose={() => setEditor(null)}
          saveBlock={saveBlock}
          deleteBlock={deleteBlock}
        />
      )}
    </section>
  );
}
