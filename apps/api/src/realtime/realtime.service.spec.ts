import type { Server } from 'socket.io';
import { SocketEvents } from '@kurultay/shared-types';
import { boardRoom, RealtimeService } from './realtime.service';

function attachedService() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  const service = new RealtimeService();
  service.attachServer({ to } as unknown as Server);
  return { service, to, emit };
}

describe('RealtimeService', () => {
  it('names the room after the board id', () => {
    expect(boardRoom('b1')).toBe('board:b1');
  });

  it('emits to the board room when a server is attached', () => {
    const { service, to, emit } = attachedService();

    const payload = {
      workspaceId: 'ws',
      boardId: 'b1',
      actorId: 'u1',
      taskId: 't1',
    };
    service.emitToBoard('b1', SocketEvents.TASK_CREATED, payload);

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith(boardRoom('b1'));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(SocketEvents.TASK_CREATED, payload);
  });

  it('scopes each emit to its own board room', () => {
    const { service, to, emit } = attachedService();

    service.emitToBoard('b1', SocketEvents.COLUMN_CHANGED, {
      workspaceId: 'ws',
      boardId: 'b1',
      actorId: 'u1',
      columnId: 'c1',
    });
    service.emitToBoard('b2', SocketEvents.TASK_MOVED, {
      workspaceId: 'ws',
      boardId: 'b2',
      actorId: 'u1',
      taskId: 't1',
      columnId: 'c9',
      position: 1500,
    });

    expect(to.mock.calls).toEqual([[boardRoom('b1')], [boardRoom('b2')]]);
    expect(emit.mock.calls[1]).toEqual([
      SocketEvents.TASK_MOVED,
      {
        workspaceId: 'ws',
        boardId: 'b2',
        actorId: 'u1',
        taskId: 't1',
        columnId: 'c9',
        // Float position, forwarded as-is — the client sorts on it.
        position: 1500,
      },
    ]);
  });

  it('drops the emit when the server is not attached', () => {
    const service = new RealtimeService();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });

    expect(() =>
      service.emitToBoard('b1', SocketEvents.TASK_DELETED, {
        workspaceId: 'ws',
        boardId: 'b1',
        actorId: 'u1',
        taskId: 't1',
      }),
    ).not.toThrow();

    expect(to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
