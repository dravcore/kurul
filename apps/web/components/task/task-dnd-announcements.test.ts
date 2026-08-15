import { describe, expect, it } from 'vitest';
import type { Active, Over } from '@dnd-kit/core';
import { ColumnCategory, Priority, type ColumnDto, type TaskDto } from '@kurultay/shared-types';
import { columnDroppableId } from '@/components/board/board-column';
import { buildTaskDndAnnouncements } from './task-dnd-announcements';

const COLUMN_A = 'column-a';
const COLUMN_B = 'column-b';

function task(id: string, columnId: string): TaskDto {
  return {
    id,
    boardId: 'board-1',
    columnId,
    title: `Task ${id}`,
    description: null,
    priority: Priority.MEDIUM,
    position: 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    attachmentCount: 0,
  };
}

function column(id: string, name: string): ColumnDto {
  return {
    id,
    boardId: 'board-1',
    name,
    position: 1000,
    color: null,
    category: ColumnCategory.UNSTARTED,
    taskCount: 0,
  };
}

const tasks = [task('a', COLUMN_A), task('d', COLUMN_B)];
const columns = [column(COLUMN_A, 'To Do'), column(COLUMN_B, 'Done')];

/** Echoes the key and its values so assertions read the wiring, not the English copy. */
const translate = (key: string, values?: Record<string, string>): string =>
  values ? `${key}:${Object.values(values).join('|')}` : key;

const active = (id: string) => ({ id }) as Active;
const over = (id: string) => ({ id }) as Over;

describe('buildTaskDndAnnouncements', () => {
  const announcements = buildTaskDndAnnouncements(tasks, columns, translate);

  it('names the task when it is picked up', () => {
    expect(announcements.onDragStart({ active: active('a') })).toBe('dnd.pickedUp:Task a');
  });

  it('names the column when hovering its empty area', () => {
    expect(
      announcements.onDragOver({ active: active('a'), over: over(columnDroppableId(COLUMN_B)) }),
    ).toBe('dnd.overColumn:Task a|Done');
  });

  it('resolves the column of a hovered card', () => {
    expect(announcements.onDragEnd({ active: active('a'), over: over('d') })).toBe(
      'dnd.dropped:Task a|Done',
    );
  });

  it('reports a drop outside any column as a return', () => {
    expect(announcements.onDragEnd({ active: active('a'), over: null })).toBe(
      'dnd.droppedNowhere:Task a',
    );
  });

  it('reports a cancelled drag', () => {
    expect(announcements.onDragCancel({ active: active('a'), over: null })).toBe(
      'dnd.cancelled:Task a',
    );
  });
});
