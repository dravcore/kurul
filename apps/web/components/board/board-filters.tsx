'use client';

import type { LabelDto, WorkspaceMemberDto } from '@kurul/shared-types';
import type { BoardTaskFilters } from '@/lib/task-query';
import { BoardFilterChips } from './board-filter-chips';
import { BoardFilterMenu } from './board-filter-menu';
import { BoardFilterSearch } from './board-filter-search';

interface BoardFiltersProps {
  filters: BoardTaskFilters;
  members: WorkspaceMemberDto[];
  labels: LabelDto[];
  onChange: (next: BoardTaskFilters) => void;
}

/**
 * The board filter bar: search box, filter menu, and the chips for whatever is active.
 * It holds no state of its own — `filters` comes from the URL and every control hands the
 * next value straight back to `onChange`.
 */
export function BoardFilters({
  filters,
  members,
  labels,
  onChange,
}: Readonly<BoardFiltersProps>): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <BoardFilterSearch
          value={filters.q}
          onCommit={(query) => onChange({ ...filters, q: query || undefined })}
        />
        <BoardFilterMenu filters={filters} members={members} labels={labels} onChange={onChange} />
      </div>

      <BoardFilterChips filters={filters} members={members} labels={labels} onChange={onChange} />
    </div>
  );
}
