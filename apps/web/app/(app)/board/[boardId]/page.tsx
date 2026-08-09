import { Suspense } from 'react';
import { BoardView } from '@/components/board/board-view';
import { Skeleton } from '@/components/ui/skeleton';

function BoardFallback(): React.ReactElement {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[var(--topbar-height)] items-center border-b border-border px-3">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex gap-3 overflow-x-auto p-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-64 w-[var(--column-width)] shrink-0" />
        ))}
      </div>
    </div>
  );
}

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}): Promise<React.ReactElement> {
  const { boardId } = await params;
  return (
    <Suspense fallback={<BoardFallback />}>
      <BoardView boardId={boardId} />
    </Suspense>
  );
}
