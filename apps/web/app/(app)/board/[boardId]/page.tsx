import { BoardView } from '@/components/board/board-view';

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}): Promise<React.ReactElement> {
  const { boardId } = await params;
  return <BoardView boardId={boardId} />;
}
