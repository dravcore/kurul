import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';

type ManagerHandler = () => void;

interface FakeSocket {
  connected: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  io: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    handlers: Map<string, Set<ManagerHandler>>;
    emit: (event: string) => void;
  };
}

const created: FakeSocket[] = [];

function createFakeSocket(): FakeSocket {
  const handlers = new Map<string, Set<ManagerHandler>>();
  const client: FakeSocket = {
    connected: false,
    connect: vi.fn(() => {
      client.connected = true;
      return client;
    }),
    disconnect: vi.fn(() => {
      client.connected = false;
      return client;
    }),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    io: {
      handlers,
      on: vi.fn((event: string, handler: ManagerHandler) => {
        const set = handlers.get(event) ?? new Set<ManagerHandler>();
        set.add(handler);
        handlers.set(event, set);
      }),
      off: vi.fn((event: string, handler: ManagerHandler) => {
        handlers.get(event)?.delete(handler);
      }),
      emit: (event: string) => {
        for (const handler of handlers.get(event) ?? []) handler();
      },
    },
  };
  return client;
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const client = createFakeSocket();
    created.push(client);
    return client as unknown as Socket;
  }),
}));

async function loadSocketModule() {
  return import('./socket');
}

beforeEach(() => {
  created.length = 0;
  vi.mocked(io).mockClear();
  // Each test needs a pristine singleton, so the module is re-evaluated per test.
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('socket singleton', () => {
  it('configures a jittered, bounded reconnect backoff', async () => {
    const { getSocket } = await loadSocketModule();

    getSocket();

    expect(vi.mocked(io)).toHaveBeenCalledTimes(1);
    const options = vi.mocked(io).mock.calls[0]?.[1];
    expect(options).toMatchObject({
      autoConnect: false,
      reconnection: true,
      randomizationFactor: 0.5,
    });
    // A ceiling above the socket.io default of 5s, so a restarted API is not retried by
    // every client every five seconds forever.
    expect(options?.reconnectionDelayMax).toBeGreaterThan(5_000);
    expect(options?.reconnectionAttempts).toBeLessThan(Infinity);
  });

  it('reuses one client and connects it only once', async () => {
    const { connectSocket, getSocket } = await loadSocketModule();

    const first = connectSocket();
    const second = connectSocket();

    expect(first).toBe(second);
    expect(getSocket()).toBe(first);
    expect(vi.mocked(io)).toHaveBeenCalledTimes(1);
    expect(created[0]?.connect).toHaveBeenCalledTimes(1);
  });

  it('drops every listener when the socket is disposed', async () => {
    const { connectSocket, disconnectSocket, getSocket } = await loadSocketModule();

    connectSocket();
    disconnectSocket();

    const client = created[0];
    expect(client?.disconnect).toHaveBeenCalledTimes(1);
    expect(client?.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(client?.io.handlers.get('reconnect_failed')?.size ?? 0).toBe(0);
    // The disposed instance is not handed out again: sign-in after sign-out builds a fresh
    // socket rather than reusing one bound to the old session cookie.
    expect(getSocket()).not.toBe(client as unknown as Socket);
  });

  it('is a no-op when disposed twice', async () => {
    const { connectSocket, disconnectSocket } = await loadSocketModule();

    connectSocket();
    disconnectSocket();
    disconnectSocket();

    expect(created).toHaveLength(1);
    expect(created[0]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it('retries once after a long cooldown when the backoff gives up', async () => {
    const { connectSocket } = await loadSocketModule();

    connectSocket();
    const client = created[0];
    expect(client).toBeDefined();
    if (!client) return;
    client.connected = false;
    client.connect.mockClear();

    client.io.emit('reconnect_failed');
    client.io.emit('reconnect_failed');

    expect(client.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('cancels the parked retry when the socket is disposed', async () => {
    const { connectSocket, disconnectSocket } = await loadSocketModule();

    connectSocket();
    const client = created[0];
    expect(client).toBeDefined();
    if (!client) return;
    client.connected = false;
    client.io.emit('reconnect_failed');
    client.connect.mockClear();

    disconnectSocket();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(client.connect).not.toHaveBeenCalled();
  });
});
