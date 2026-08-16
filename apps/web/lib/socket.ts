import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import { getApiBaseUrl } from '@/lib/api';
import { isSameOriginApiBaseUrl } from '@/lib/api-url';

/**
 * One socket per tab, shared by every hook that needs the realtime feed.
 *
 * Lifecycle: `getSocket()` builds it lazily and never connects on its own, `connectSocket()`
 * opens it (hooks call this on mount), and `disconnectSocket()` disposes it — the singleton
 * is dropped, so the next `getSocket()` builds a fresh one. Nothing else may hold on to the
 * instance across a disposal: a sign-out invalidates the session cookie the handshake was
 * built with, so the old socket must not be reused.
 *
 * Per-feature listeners are added and removed by the hook that owns them. `removeAllListeners()`
 * on disposal is the backstop for the ones that were not: without it, a repeated
 * sign-in/sign-out cycle leaks an orphan `Socket` plus every closure ever registered on it,
 * which is what a long-lived kiosk session eventually notices.
 */
let socket: Socket | null = null;

/** Set while a manager-level retry is parked after the backoff gave up. */
let coolDownTimer: ReturnType<typeof setTimeout> | null = null;

/** First retry delay; each attempt backs off from here up to the ceiling. */
const RECONNECT_DELAY_MS = 1_000;

/**
 * Ceiling on the backoff. socket.io defaults to 5s, which on an API restart means every
 * connected client retries at least every 5s forever — the herd never thins out. A 20s
 * ceiling cuts that steady-state rate fourfold.
 */
const RECONNECT_DELAY_MAX_MS = 20_000;

/**
 * Spread applied to every delay (`delay * [1 - f, 1 + f]`). This matches the socket.io
 * default rather than changing it, but it is stated here because it is the reason a
 * restarted API is not hit by N clients on the same tick — it must not be tuned away.
 */
const RECONNECT_RANDOMIZATION_FACTOR = 0.5;

/** Attempts before the backoff gives up and hands over to the cooldown retry. */
const RECONNECT_ATTEMPTS = 15;

/**
 * How long a client waits after exhausting its attempts (~4 minutes of backoff) before it
 * tries once more. An unbounded fast retry loop is what floods a restarting API; giving up
 * for good is worse, because a kiosk left open overnight would never come back.
 */
const RECONNECT_COOLDOWN_MS = 60_000;

function onReconnectFailed(): void {
  if (coolDownTimer !== null) return;
  const client = socket;
  coolDownTimer = setTimeout(() => {
    coolDownTimer = null;
    if (socket === client && client !== null && !client.connected) {
      client.connect();
    }
  }, RECONNECT_COOLDOWN_MS);
}

const CONNECT_OPTIONS: Partial<ManagerOptions & SocketOptions> = {
  autoConnect: false,
  withCredentials: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: RECONNECT_ATTEMPTS,
  reconnectionDelay: RECONNECT_DELAY_MS,
  reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
  randomizationFactor: RECONNECT_RANDOMIZATION_FACTOR,
};

/**
 * Builds the client for whichever of the two API topologies this build was configured for
 * (`lib/api-url.ts`).
 *
 * The same-origin branch cannot be expressed by passing the base as the URL: socket.io reads
 * a leading-slash string as a *namespace*, so `io('/api')` would silently connect to
 * namespace `/api` on this origin over the default `/socket.io` path — a handshake the server
 * answers with "Invalid namespace" rather than an obvious wiring error. The engine's HTTP
 * path is a separate option, and it is the one the reverse proxy routes on, so the URL is
 * omitted (socket.io then uses `window.location`) and the prefix goes into `path` instead.
 * The API keeps socket.io mounted at its own default `/socket.io`; the proxy strips the
 * `/api` prefix before forwarding, so neither side has to be told about the other's mount
 * point.
 */
function createSocket(): Socket {
  const base = getApiBaseUrl();
  return isSameOriginApiBaseUrl(base)
    ? io({ ...CONNECT_OPTIONS, path: `${base}/socket.io` })
    : io(base, CONNECT_OPTIONS);
}

export function getSocket(): Socket {
  if (!socket) {
    socket = createSocket();
    socket.io.on('reconnect_failed', onReconnectFailed);
  }
  return socket;
}

export function connectSocket(): Socket {
  const client = getSocket();
  if (!client.connected) {
    client.connect();
  }
  return client;
}

export function disconnectSocket(): void {
  if (!socket) return;
  if (coolDownTimer !== null) {
    clearTimeout(coolDownTimer);
    coolDownTimer = null;
  }
  const client = socket;
  socket = null;
  client.disconnect();
  client.io.off('reconnect_failed', onReconnectFailed);
  // Drops any listener a hook forgot to remove, so the instance and its closures can go.
  client.removeAllListeners();
}
