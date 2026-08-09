import type { Server } from 'socket.io';
import { SocketEvents } from '@kurultay/shared-types';
import { boardRoom, RealtimeService } from './realtime.service';

describe('RealtimeService', () => {
  it('emits to the board room when a server is attached', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const service = new RealtimeService();
    service.attachServer({ to } as unknown as Server);

    const payload = {
      workspaceId: 'ws',
      boardId: 'b1',
      actorId: 'u1',
      taskId: 't1',
    };
    service.emitToBoard('b1', SocketEvents.TASK_CREATED, payload);

    expect(to).toHaveBeenCalledWith(boardRoom('b1'));
    expect(emit).toHaveBeenCalledWith(SocketEvents.TASK_CREATED, payload);
  });

  it('no-ops when the server is not attached', () => {
    const service = new RealtimeService();
    expect(() =>
      service.emitToBoard('b1', SocketEvents.TASK_DELETED, {
        workspaceId: 'ws',
        boardId: 'b1',
        actorId: 'u1',
        taskId: 't1',
      }),
    ).not.toThrow();
  });
});
