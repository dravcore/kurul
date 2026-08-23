import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';

type ManagerHandler = () => void;

interface FakeSocket {
  connected: boolean;
  /**
   * socket.io-client's own "opening or open" flag, and the reason this fake is written the way
   * it is. The real `connect()` does **not** set `connected` — that only turns true when the
   * server's CONNECT ack arrives, a round trip later. A fake that flipped `connected`
   * synchronously made "connects it only once" pass while the shipped code was calling
   * `connect()` twice on an opening socket, which is exactly the bug this file now covers.
   */
  active: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  handlers: Map<string, Set<SocketHandler>>;
  emit: (event: string, ...args: unknown[]) => void;
  io: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    handlers: Map<string, Set<ManagerHandler>>;
    emit: (event: string) => void;
  };
}

type SocketHandler = (...args: unknown[]) => void;

const created: FakeSocket[] = [];

function createFakeSocket(): FakeSocket {
  const handlers = new Map<string, Set<ManagerHandler>>();
  const socketHandlers = new Map<string, Set<SocketHandler>>();
  const client: FakeSocket = {
    connected: false,
    active: false,
    connect: vi.fn(() => {
      client.active = true;
      return client;
    }),
    disconnect: vi.fn(() => {
      client.connected = false;
      client.active = false;
      return client;
    }),
    removeAllListeners: vi.fn(),
    handlers: socketHandlers,
    on: vi.fn((event: string, handler: SocketHandler) => {
      const set = socketHandlers.get(event) ?? new Set<SocketHandler>();
      set.add(handler);
      socketHandlers.set(event, set);
    }),
    off: vi.fn((event: string, handler: SocketHandler) => {
      socketHandlers.get(event)?.delete(handler);
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of [...(socketHandlers.get(event) ?? [])]) handler(...args);
    },
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
  vi.unstubAllEnvs();
});

describe('socket target', () => {
  it('dials a same-origin API through the engine path, not as a namespace', async () => {
    // `io('/api')` would connect to socket.io *namespace* `/api` on the default `/socket.io`
    // path — a handshake the server rejects with "Invalid namespace", and one that would only
    // surface at runtime in a proxied deployment. The prefix belongs in `path`, and the URL is
    // omitted so socket.io uses `window.location`. This is the shipped image's configuration
    // (apps/web/Dockerfile), so it is the branch every self-hosted install runs.
    vi.stubEnv('NEXT_PUBLIC_API_URL', '/api');
    vi.resetModules();
    const { getSocket } = await loadSocketModule();

    getSocket();

    const [first, second] = vi.mocked(io).mock.calls[0] ?? [];
    expect(second).toBeUndefined();
    expect(first).toMatchObject({ path: '/api/socket.io', withCredentials: true });
    expect(typeof first).not.toBe('string');
  });

  it('still dials an absolute API origin directly, with socket.io’s default path', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.com');
    vi.resetModules();
    const { getSocket } = await loadSocketModule();

    getSocket();

    const [first, second] = vi.mocked(io).mock.calls[0] ?? [];
    expect(first).toBe('https://api.example.com');
    // No `path` override: the API serves socket.io at its own root in this topology.
    expect(second).not.toHaveProperty('path');
  });

  it('keeps the same reconnect policy on both topologies', async () => {
    // The backoff below is what stops a restarted API being retried by every client forever.
    // It lives in one shared object precisely so the two `io(...)` call shapes cannot drift.
    vi.stubEnv('NEXT_PUBLIC_API_URL', '/api');
    vi.resetModules();
    const { getSocket } = await loadSocketModule();

    getSocket();

    expect(vi.mocked(io).mock.calls[0]?.[0]).toMatchObject({
      autoConnect: false,
      reconnection: true,
      randomizationFactor: 0.5,
      reconnectionAttempts: 15,
    });
  });
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

  it('does not re-open a socket that is still opening', async () => {
    // The board mounts two hooks — board room and notification room — in separate commits
    // milliseconds apart, and both call `connectSocket()`. The socket is `active` but not yet
    // `connected` in between, and a second `connect()` there makes socket.io-client send the
    // namespace CONNECT packet twice on one connection. Socket.io 4.x reads a duplicate CONNECT
    // for a namespace it already holds as an invalid state and closes the whole client, so the
    // first connection dies mid-handshake and every join queued behind it goes unanswered.
    const { connectSocket } = await loadSocketModule();

    connectSocket();
    const client = created[0];
    expect(client).toBeDefined();
    if (!client) return;
    expect(client.active).toBe(true);
    // Still awaiting the server's CONNECT ack, exactly as the real client would be.
    expect(client.connected).toBe(false);

    connectSocket();

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('re-opens the socket after the server refuses the handshake', async () => {
    // socket.io reconnects a connection that dropped, but not one the server refused: a
    // `connect_error` runs the client's `destroy()`, which clears `active` and cancels the
    // backoff — `reconnect_failed` never fires either. Without this retry the socket is dead
    // for the lifetime of the page while the board still renders "Reconnecting…".
    const { connectSocket } = await loadSocketModule();

    connectSocket();
    const client = created[0];
    expect(client).toBeDefined();
    if (!client) return;
    client.active = false;
    client.connect.mockClear();

    client.emit('connect_error', new Error('unauthorized'));

    expect(client.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('re-opens the socket after a server-side disconnect', async () => {
    const { connectSocket } = await loadSocketModule();

    connectSocket();
    const client = created[0];
    expect(client).toBeDefined();
    if (!client) return;
    client.active = false;
    client.connect.mockClear();

    client.emit('disconnect', 'io server disconnect');
    await vi.advanceTimersByTimeAsync(2_000);

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary drop to socket.io’s own reconnection', async () => {
    // `active` stays true while the manager is backing off, and a retry scheduled here would
    // race it. The extra retry exists only for the cases socket.io has abandoned.
    const { connectSocket } = await loadSocketModule();

    connectSocket();
    const client = created[0];
    expect(client).toBeDefined();
    if (!client) return;
    client.connect.mockClear();

    client.emit('disconnect', 'transport close');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(client.connect).not.toHaveBeenCalled();
  });

  it('backs off between refusals instead of hammering a refusing server', async () => {
    const { connectSocket } = await loadSocketModule();

    connectSocket();
    const client = created[0];
    expect(client).toBeDefined();
    if (!client) return;

    const delays: number[] = [];
    for (let refusal = 0; refusal < 4; refusal += 1) {
      client.active = false;
      client.connect.mockClear();
      client.emit('connect_error', new Error('unauthorized'));
      let waited = 0;
      while (client.connect.mock.calls.length === 0 && waited < 120_000) {
        await vi.advanceTimersByTimeAsync(100);
        waited += 100;
      }
      delays.push(waited);
    }

    // Doubling, with the manager's jitter factor applied, so a refused client is not a
    // steady load on the API it is refusing to talk to.
    expect(delays[0] ?? 0).toBeLessThan(delays[3] ?? 0);
    expect(delays[3] ?? 0).toBeGreaterThan(2_000);
  });

  it('forgets the refusal backoff once a connection succeeds', async () => {
    const { connectSocket } = await loadSocketModule();

    connectSocket();
    const client = created[0];
    expect(client).toBeDefined();
    if (!client) return;

    client.active = false;
    client.emit('connect_error', new Error('unauthorized'));
    await vi.advanceTimersByTimeAsync(60_000);

    client.connected = true;
    client.active = true;
    client.emit('connect');

    client.connected = false;
    client.active = false;
    client.connect.mockClear();
    client.emit('connect_error', new Error('unauthorized'));
    // Back to the first, short delay rather than continuing to double from where it left off.
    await vi.advanceTimersByTimeAsync(1_600);

    expect(client.connect).toHaveBeenCalledTimes(1);
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
