import { BoardView } from '@/components/board/board-view';

export default async function BoardTaskPage({
  params,
}: {
  params: Promise<{ boardId: string; taskId: string }>;
}): Promise<React.ReactElement> {
  const { boardId, taskId } = await params;
  return <BoardView boardId={boardId} selectedTaskId={taskId} />;
}
