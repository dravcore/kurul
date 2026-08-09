import type { Announcements } from '@dnd-kit/core';
import type { ColumnDto, TaskDto } from '@kurultay/shared-types';
import { parseColumnDroppableId } from '@/components/board/board-column';

/**
 * The slice of a next-intl translator this module needs.
 *
 * Narrowing it to a plain function keeps the announcement wording testable without
 * standing up an intl provider.
 */
export type DndTranslator = (key: string, values?: Record<string, string>) => string;

/**
 * Localised screen-reader announcements for board drag and drop.
 *
 * dnd-kit ships hardcoded English announcements and renders its own live region for them,
 * so these replace the defaults rather than adding a second region — two live regions on
 * one drag means every move is read out twice.
 */
export function buildTaskDndAnnouncements(
  tasks: readonly TaskDto[],
  columns: readonly ColumnDto[],
  t: DndTranslator,
): Announcements {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const columnNameById = new Map(columns.map((column) => [column.id, column.name]));

  const titleOf = (id: string | number): string => taskById.get(String(id))?.title ?? String(id);

  /** A drop target is either a column's empty area or a card sitting in one. */
  const columnNameOf = (id: string | number | undefined): string | null => {
    if (id === undefined) return null;
    const overId = String(id);
    const columnId = parseColumnDroppableId(overId) ?? taskById.get(overId)?.columnId;
    if (columnId === undefined) return null;
    return columnNameById.get(columnId) ?? null;
  };

  return {
    onDragStart: ({ active }) => t('dnd.pickedUp', { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) => {
      const column = columnNameOf(over?.id);
      const title = titleOf(active.id);
      return column === null
        ? t('dnd.overNothing', { title })
        : t('dnd.overColumn', { title, column });
    },
    onDragEnd: ({ active, over }) => {
      const column = columnNameOf(over?.id);
      const title = titleOf(active.id);
      return column === null
        ? t('dnd.droppedNowhere', { title })
        : t('dnd.dropped', { title, column });
    },
    onDragCancel: ({ active }) => t('dnd.cancelled', { title: titleOf(active.id) }),
  };
}
