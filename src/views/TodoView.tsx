import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  GripVertical,
  ListTodo,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDueKey, isOverdueKey } from '../dates';
import type { Section, SlateState, Task } from '../model';
import { sortByOrder } from '../order';
import type { SlateStore } from '../store';
import { ColorPicker, Modal, SectionHeading, accentStyle } from '../ui';

interface TodoViewProps {
  state: SlateState;
  addSection: SlateStore['addSection'];
  renameSection: SlateStore['renameSection'];
  setSectionColor: SlateStore['setSectionColor'];
  toggleSectionCollapsed: SlateStore['toggleSectionCollapsed'];
  moveSection: SlateStore['moveSection'];
  deleteSection: SlateStore['deleteSection'];
  clearCompleted: SlateStore['clearCompleted'];
  addTask: SlateStore['addTask'];
  updateTask: SlateStore['updateTask'];
  toggleTask: SlateStore['toggleTask'];
  moveTask: SlateStore['moveTask'];
  deleteTask: SlateStore['deleteTask'];
  updateSettings: SlateStore['updateSettings'];
}

interface DropTarget {
  sectionId: string;
  beforeTaskId: string | null;
}

function InlineText({ value, onCommit, placeholder, ariaLabel, className }: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // blur() fires the commit synchronously, before an Escape's setDraft state
  // update flushes — a ref is the only reliable cancel signal.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(value);
  }, [value]);

  function commit() {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setDraft(value);
      return;
    }
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  }

  return (
    <input
      ref={inputRef}
      className={`inline-text${className ? ` ${className}` : ''}`}
      type="text"
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          inputRef.current?.blur();
        }
        if (event.key === 'Escape') {
          cancelledRef.current = true;
          setDraft(value);
          inputRef.current?.blur();
        }
      }}
      maxLength={200}
    />
  );
}

function AddTaskRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  function commit(keepFocus: boolean) {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setDraft('');
      return;
    }
    const trimmed = draft.trim();
    if (trimmed) onAdd(trimmed);
    setDraft('');
    if (keepFocus) inputRef.current?.focus();
  }

  return (
    <div className="add-task-row">
      <Plus aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder="New task"
        aria-label="New task"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(true);
          }
          if (event.key === 'Escape') {
            cancelledRef.current = true;
            setDraft('');
            inputRef.current?.blur();
          }
        }}
        maxLength={200}
      />
    </div>
  );
}

function SectionMenu({ section, isFirst, isLast, hasCompleted, moveSection, setSectionColor, clearCompleted, deleteSection }: {
  section: Section;
  isFirst: boolean;
  isLast: boolean;
  hasCompleted: boolean;
  moveSection: SlateStore['moveSection'];
  setSectionColor: SlateStore['setSectionColor'];
  clearCompleted: SlateStore['clearCompleted'];
  deleteSection: SlateStore['deleteSection'];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="section-menu" ref={rootRef}>
      <button
        type="button"
        className="icon-button icon-button-quiet"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Section options for ${section.title || 'untitled section'}`}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open && (
        <div className="section-menu-popover">
          <div className="section-menu-colors">
            <ColorPicker
              value={section.color}
              onChange={(color) => setSectionColor(section.id, color)}
              idPrefix={`section-color-${section.id}`}
            />
          </div>
          <button type="button" className="section-menu-item" disabled={isFirst} onClick={() => { moveSection(section.id, -1); setOpen(false); }}>
            <ArrowUp aria-hidden="true" /> Move up
          </button>
          <button type="button" className="section-menu-item" disabled={isLast} onClick={() => { moveSection(section.id, 1); setOpen(false); }}>
            <ArrowDown aria-hidden="true" /> Move down
          </button>
          <button type="button" className="section-menu-item" disabled={!hasCompleted} onClick={() => { clearCompleted(section.id); setOpen(false); }}>
            <Eraser aria-hidden="true" /> Clear completed
          </button>
          <button
            type="button"
            className="section-menu-item section-menu-danger"
            onClick={() => {
              if (window.confirm(`Delete “${section.title || 'Untitled section'}” and all of its tasks? This removes them on every synced device.`)) {
                deleteSection(section.id);
              }
              setOpen(false);
            }}
          >
            <Trash2 aria-hidden="true" /> Delete section
          </button>
        </div>
      )}
    </div>
  );
}

function TaskDetailsModal({ task, sections, onClose, updateTask, toggleTask, deleteTask, moveStep, canMoveUp, canMoveDown }: {
  task: Task;
  sections: Section[];
  onClose: () => void;
  updateTask: SlateStore['updateTask'];
  toggleTask: SlateStore['toggleTask'];
  deleteTask: SlateStore['deleteTask'];
  moveStep: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [notes, setNotes] = useState(task.notes);

  function commitNotes() {
    if (notes !== task.notes) updateTask(task.id, { notes });
  }

  return (
    <Modal
      title="Task details"
      onClose={() => {
        commitNotes();
        onClose();
      }}
      footer={(
        <div className="modal-actions">
          <button
            type="button"
            className="button button-danger"
            onClick={() => {
              if (!window.confirm(`Delete “${task.title || 'Untitled task'}”? This removes it on every synced device.`)) return;
              deleteTask(task.id);
              onClose();
            }}
          >
            <Trash2 aria-hidden="true" /> Delete task
          </button>
          <span className="modal-actions-spacer" />
          <button type="button" className="button button-primary" onClick={() => { commitNotes(); onClose(); }}>Done</button>
        </div>
      )}
    >
      <div className="task-details">
        <label className={`task-details-check${task.done ? ' is-done' : ''}`}>
          <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
          <span>{task.done ? 'Completed' : 'Mark complete'}</span>
        </label>

        <label className="field">
          <span className="field-label">Title</span>
          <input
            type="text"
            defaultValue={task.title}
            aria-label="Task title"
            maxLength={200}
            onBlur={(event) => {
              const trimmed = event.target.value.trim();
              if (trimmed && trimmed !== task.title) updateTask(task.id, { title: trimmed });
              else if (!trimmed) event.target.value = task.title;
            }}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Due date</span>
            <input
              type="date"
              value={task.due ?? ''}
              onChange={(event) => updateTask(task.id, { due: event.target.value || undefined })}
            />
          </label>
          <label className="field">
            <span className="field-label">Section</span>
            <select
              value={task.sectionId}
              onChange={(event) => updateTask(task.id, { sectionId: event.target.value })}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.title || 'Untitled section'}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span className="field-label" id="task-position-label">Position in section</span>
          <div className="task-move-row" role="group" aria-labelledby="task-position-label">
            <button type="button" className="button button-secondary" onClick={() => moveStep(-1)} disabled={!canMoveUp}>
              <ArrowUp aria-hidden="true" /> Move up
            </button>
            <button type="button" className="button button-secondary" onClick={() => moveStep(1)} disabled={!canMoveDown}>
              <ArrowDown aria-hidden="true" /> Move down
            </button>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Notes</span>
          <textarea
            rows={5}
            value={notes}
            placeholder="Links, subtasks, context…"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={commitNotes}
          />
        </label>
      </div>
    </Modal>
  );
}

export function TodoView({
  state,
  addSection,
  renameSection,
  setSectionColor,
  toggleSectionCollapsed,
  moveSection,
  deleteSection,
  clearCompleted,
  addTask,
  updateTask,
  toggleTask,
  moveTask,
  deleteTask,
  updateSettings,
}: TodoViewProps) {
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  // Rows are only draggable while the grip is pressed, so text selection and
  // caret placement inside the inline inputs keep working.
  const [armedTaskId, setArmedTaskId] = useState<string | null>(null);

  const sections = useMemo(() => sortByOrder(state.sections.filter((section) => !section.deleted)), [state.sections]);
  const tasksBySection = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const section of sections) grouped.set(section.id, []);
    for (const task of state.tasks) {
      if (task.deleted) continue;
      grouped.get(task.sectionId)?.push(task);
    }
    for (const [sectionId, tasks] of grouped) grouped.set(sectionId, sortByOrder(tasks));
    return grouped;
  }, [sections, state.tasks]);

  const hideCompleted = state.settings.hideCompleted;
  const openCount = state.tasks.filter((task) => !task.deleted && !task.done).length;
  const doneCount = state.tasks.filter((task) => !task.deleted && task.done).length;
  const detailsTask = detailsTaskId
    ? state.tasks.find((task) => task.id === detailsTaskId && !task.deleted) ?? null
    : null;
  // A concurrent delete-section on another device can strand live tasks whose
  // section is now a tombstone; surface them instead of hiding them forever.
  const orphanTasks = useMemo(() => {
    const liveSectionIds = new Set(sections.map((section) => section.id));
    return sortByOrder(state.tasks.filter((task) => !task.deleted && !liveSectionIds.has(task.sectionId)));
  }, [sections, state.tasks]);

  const detailsSiblings = detailsTask
    ? (tasksBySection.get(detailsTask.sectionId) ?? [])
    : [];
  const detailsIndex = detailsTask
    ? detailsSiblings.findIndex((task) => task.id === detailsTask.id)
    : -1;

  function moveTaskStep(task: Task, direction: -1 | 1) {
    const siblings = tasksBySection.get(task.sectionId) ?? [];
    const index = siblings.findIndex((item) => item.id === task.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
    const beforeTaskId = direction === -1
      ? siblings[targetIndex].id
      : siblings[targetIndex + 1]?.id ?? null;
    moveTask(task.id, task.sectionId, beforeTaskId);
  }

  function endDrag() {
    setDraggingTaskId(null);
    setDropTarget(null);
    setArmedTaskId(null);
  }

  function onDropAt(target: DropTarget) {
    if (draggingTaskId) moveTask(draggingTaskId, target.sectionId, target.beforeTaskId);
    endDrag();
  }

  function taskRow(task: Task, section: Section | null, visible: Task[]) {
    const isDropBefore = section !== null && dropTarget?.sectionId === section.id && dropTarget.beforeTaskId === task.id;
    return (
      <li
        key={task.id}
        className={`task-row${task.done ? ' is-done' : ''}${draggingTaskId === task.id ? ' is-dragging' : ''}${isDropBefore ? ' drop-before' : ''}`}
        draggable={section !== null && armedTaskId === task.id}
        onDragStart={(event) => {
          if (!section) return;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', task.id);
          setDraggingTaskId(task.id);
        }}
        onDragEnd={endDrag}
        onDragOver={(event) => {
          if (!section || !draggingTaskId || draggingTaskId === task.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const rect = event.currentTarget.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          // Resolve neighbours against the VISIBLE sequence (open before done,
          // completed possibly hidden) so the indicator matches the drop.
          const index = visible.findIndex((item) => item.id === task.id);
          const beforeTaskId = before ? task.id : visible[index + 1]?.id ?? null;
          setDropTarget({ sectionId: section.id, beforeTaskId });
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dropTarget) onDropAt(dropTarget);
        }}
      >
        {section !== null && (
          <span
            className="task-grip"
            aria-hidden="true"
            onPointerDown={() => setArmedTaskId(task.id)}
            onPointerUp={() => { if (!draggingTaskId) setArmedTaskId(null); }}
          >
            <GripVertical />
          </span>
        )}
        <button
          type="button"
          className="task-checkbox"
          role="checkbox"
          aria-checked={task.done}
          aria-label={`${task.done ? 'Reopen' : 'Complete'} ${task.title || 'untitled task'}`}
          onClick={() => toggleTask(task.id)}
        >
          <Check aria-hidden="true" />
        </button>
        <InlineText
          value={task.title}
          onCommit={(title) => updateTask(task.id, { title })}
          placeholder="Untitled task"
          ariaLabel={`Task title: ${task.title || 'untitled'}`}
          className="task-title"
        />
        {task.due && (
          <span className={`due-chip${!task.done && isOverdueKey(task.due) ? ' due-chip-overdue' : ''}`}>
            {formatDueKey(task.due)}
          </span>
        )}
        {task.notes && <span className="task-note-flag" title="Has notes" aria-label="Has notes"><NotebookPen aria-hidden="true" /></span>}
        <span className="task-actions">
          <button
            type="button"
            className="icon-button icon-button-quiet"
            aria-label={`Open details for ${task.title || 'untitled task'}`}
            onClick={() => setDetailsTaskId(task.id)}
          >
            <NotebookPen aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button icon-button-quiet"
            aria-label={`Delete ${task.title || 'untitled task'}`}
            onClick={() => {
              if (window.confirm(`Delete “${task.title || 'Untitled task'}”? This removes it on every synced device.`)) {
                deleteTask(task.id);
              }
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </span>
      </li>
    );
  }

  return (
    <section className="view todo-view">
      <SectionHeading
        eyebrow="Sections + tasks"
        title="To-Do List"
        copy={`${openCount} open · ${doneCount} done`}
        action={(
          <div className="todo-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => updateSettings({ hideCompleted: !hideCompleted })}
            >
              {hideCompleted ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              {hideCompleted ? 'Show completed' : 'Hide completed'}
            </button>
            <button type="button" className="button button-primary" onClick={() => addSection('New section')}>
              <Plus aria-hidden="true" /> New section
            </button>
          </div>
        )}
      />

      {sections.length === 0 && (
        <div className="panel todo-empty-panel">
          <ListTodo aria-hidden="true" />
          <p>No sections yet. Sections group tasks the way Notion pages use headings — one per class, project, or area.</p>
          <button type="button" className="button button-primary" onClick={() => addSection('Inbox')}>
            <Plus aria-hidden="true" /> Create your first section
          </button>
        </div>
      )}

      <div className="todo-sections">
        {sections.map((section, sectionIndex) => {
          const tasks = tasksBySection.get(section.id) ?? [];
          const openTasks = tasks.filter((task) => !task.done);
          const doneTasks = tasks.filter((task) => task.done);
          const visibleTasks = hideCompleted ? openTasks : [...openTasks, ...doneTasks];
          const isEndDropTarget = dropTarget?.sectionId === section.id && dropTarget.beforeTaskId === null;

          return (
            <section className="todo-section" key={section.id} style={accentStyle(section.color)}>
              <header className="todo-section-header">
                <button
                  type="button"
                  className={`collapse-toggle${section.collapsed ? '' : ' is-open'}`}
                  onClick={() => toggleSectionCollapsed(section.id)}
                  aria-expanded={!section.collapsed}
                  aria-label={`${section.collapsed ? 'Expand' : 'Collapse'} ${section.title || 'untitled section'}`}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
                <span className="section-dot" aria-hidden="true" />
                <InlineText
                  value={section.title}
                  onCommit={(title) => renameSection(section.id, title)}
                  placeholder="Untitled section"
                  ariaLabel={`Section title: ${section.title || 'untitled'}`}
                  className="section-title"
                />
                <span className="section-count">{openTasks.length ? `${openTasks.length} open` : tasks.length ? 'done' : 'empty'}</span>
                <SectionMenu
                  section={section}
                  isFirst={sectionIndex === 0}
                  isLast={sectionIndex === sections.length - 1}
                  hasCompleted={doneTasks.length > 0}
                  moveSection={moveSection}
                  setSectionColor={setSectionColor}
                  clearCompleted={clearCompleted}
                  deleteSection={deleteSection}
                />
              </header>

              {!section.collapsed && (
                <div
                  className={`todo-section-body${isEndDropTarget ? ' drop-end' : ''}`}
                  onDragOver={(event) => {
                    if (!draggingTaskId) return;
                    if ((event.target as HTMLElement).closest('.task-row')) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropTarget({ sectionId: section.id, beforeTaskId: null });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dropTarget) onDropAt(dropTarget);
                  }}
                >
                  {visibleTasks.length > 0 && (
                    <ul className="task-list">
                      {visibleTasks.map((task) => taskRow(task, section, visibleTasks))}
                    </ul>
                  )}
                  {visibleTasks.length === 0 && tasks.length > 0 && hideCompleted && (
                    <p className="todo-section-note">All {tasks.length} tasks here are completed and hidden.</p>
                  )}
                  <AddTaskRow onAdd={(title) => addTask(section.id, title)} />
                </div>
              )}
            </section>
          );
        })}

        {orphanTasks.length > 0 && (
          <section className="todo-section todo-section-recovered">
            <header className="todo-section-header">
              <span className="section-dot" aria-hidden="true" />
              <h2 className="section-title-static">Recovered tasks</h2>
              <span className="section-count">{orphanTasks.length} stranded</span>
            </header>
            <div className="todo-section-body">
              <p className="todo-section-note">
                These tasks belonged to a section that was deleted on another device.
                Reassign them from task details, or delete them.
              </p>
              <ul className="task-list">
                {orphanTasks.map((task) => taskRow(task, null, orphanTasks))}
              </ul>
            </div>
          </section>
        )}
      </div>

      {detailsTask && (
        <TaskDetailsModal
          task={detailsTask}
          sections={sections}
          onClose={() => setDetailsTaskId(null)}
          updateTask={updateTask}
          toggleTask={toggleTask}
          deleteTask={deleteTask}
          moveStep={(direction) => moveTaskStep(detailsTask, direction)}
          canMoveUp={detailsIndex > 0}
          canMoveDown={detailsIndex >= 0 && detailsIndex < detailsSiblings.length - 1}
        />
      )}
    </section>
  );
}
