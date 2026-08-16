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
