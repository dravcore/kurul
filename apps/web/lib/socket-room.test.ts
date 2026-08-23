import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { createRoomJoin } from './socket-room';

type Ack = (response: { ok: boolean; error?: string } | undefined) => void;

function fakeSocket(replies: Array<{ ok: boolean; error?: string } | undefined>) {
  const emit = vi.fn((_event: string, _payload: unknown, ack?: Ack) => {
    ack?.(replies.shift() ?? { ok: true });
  });
  return { connected: true, emit } as unknown as Socket & {
    connected: boolean;
    emit: typeof emit;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createRoomJoin', () => {
  it('reports the room joined on the first ok ack, without a retry', async () => {
    const socket = fakeSocket([{ ok: true }]);
    const onJoined = vi.fn();

    createRoomJoin(socket, 'board:join', { boardId: 'b1' }, onJoined).start();

    expect(onJoined).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it('retries a denied join until it is accepted', async () => {
    // The failure this exists for: a join is emitted once per connection, so a single denied
    // ack used to be permanent — the room stayed unjoined, no event ever arrived, and the
    // board rendered "Reconnecting…" over a socket that was connected and healthy.
    const socket = fakeSocket([
      { ok: false, error: 'unauthenticated' },
      { ok: false, error: 'board not found' },
      { ok: true },
    ]);
    const onJoined = vi.fn();

    createRoomJoin(socket, 'board:join', { boardId: 'b1' }, onJoined).start();

    expect(onJoined).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(onJoined).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledTimes(3);
  });

  it('backs off between denials and settles at the ceiling', async () => {
    const socket = fakeSocket([]);
    vi.mocked(socket.emit).mockImplementation(((_e: string, _p: unknown, ack?: Ack) => {
      ack?.({ ok: false });
    }) as never);

    createRoomJoin(socket, 'board:join', { boardId: 'b1' }, vi.fn(), {
      firstDelayMs: 100,
      maxDelayMs: 400,
    }).start();

    // 100, 200, 400, then 400 forever — a permanently closed door is knocked on at the
    // ceiling, not continuously.
    expect(socket.emit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.emit).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(socket.emit).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(socket.emit).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(400);
    expect(socket.emit).toHaveBeenCalledTimes(5);
  });

  it('stops retrying once cancelled', async () => {
    const socket = fakeSocket([{ ok: false }]);
    const onJoined = vi.fn();

    const join = createRoomJoin(socket, 'board:join', { boardId: 'b1' }, onJoined);
    join.start();
    join.cancel();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it('does not park a retry against a socket that has dropped', async () => {
    // The `connect` handler re-joins on the next connection; a retry parked here would only
    // race it and emit into a dead socket.
    const socket = fakeSocket([{ ok: false }]);
    vi.mocked(socket.emit).mockImplementation(((_e: string, _p: unknown, ack?: Ack) => {
      socket.connected = false;
      ack?.({ ok: false });
    }) as never);

    createRoomJoin(socket, 'board:join', { boardId: 'b1' }, vi.fn()).start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });
});
