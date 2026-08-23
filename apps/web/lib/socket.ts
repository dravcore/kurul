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

/** Set while a retry is parked after socket.io abandoned the connection outright. */
let refusalTimer: ReturnType<typeof setTimeout> | null = null;

/** Consecutive refusals, so the retry below backs off instead of hammering. */
let refusals = 0;

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

/**
 * Re-opens a socket that socket.io has abandoned.
 *
 * socket.io reconnects a connection that *dropped*; it does not reconnect one the server
 * *refused*. Both a middleware rejection (`connect_error`) and a server-side
 * `socket.disconnect()` (`disconnect` with reason `io server disconnect`) run the client's
 * `destroy()`, which clears the subscriptions `active` is derived from and cancels the backoff
 * — `reconnect_failed` never fires either, so even the cooldown above never arms. The socket is
 * then dead for the lifetime of the page while every consumer still renders "Reconnecting…",
 * which is the UI stating something that is not true: nothing is reconnecting, and nothing ever
 * will. A refused handshake is rarely permanent (a session that was momentarily unreadable, an
 * API restarting mid-handshake), so the honest behaviour is to keep trying, slowly.
 *
 * Slowly is the operative word: this path has no backoff of its own to inherit, so it carries
 * one. The delay doubles per consecutive refusal from `RECONNECT_DELAY_MS` up to
 * `RECONNECT_DELAY_MAX_MS`, jittered by the same factor as the manager's, and the counter
 * resets on the next successful connection.
 */
function onConnectionRefused(): void {
  const client = socket;
  if (client === null || client.active || refusalTimer !== null) return;

  const step = Math.min(RECONNECT_DELAY_MS * 2 ** refusals, RECONNECT_DELAY_MAX_MS);
  const jitter = 1 + RECONNECT_RANDOMIZATION_FACTOR * (Math.random() * 2 - 1);
  refusals += 1;

  refusalTimer = setTimeout(
    () => {
      refusalTimer = null;
      if (socket === client && !client.connected && !client.active) {
        client.connect();
      }
    },
    Math.round(step * jitter),
  );
}

function onConnected(): void {
  refusals = 0;
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
    socket.on('connect', onConnected);
    socket.on('connect_error', onConnectionRefused);
    socket.on('disconnect', onConnectionRefused);
  }
  return socket;
}

/**
 * Opens the socket if it is not already open **or opening**.
 *
 * `active` rather than `connected`, and the difference is a bug that reached production.
 * `connected` only turns true when the server's CONNECT acknowledgement arrives, so during the
 * round trip in between it still reads false. Two hooks mount on the board — one for the board
 * room, one for the notification room — and they land in separate commits milliseconds apart,
 * so the second call used to find `connected === false`, call `connect()` on an already-opening
 * socket and make socket.io-client emit the namespace CONNECT packet a *second* time on the
 * same connection. Socket.io 4.x treats a duplicate CONNECT for a namespace it has already
 * attached as an invalid state and closes the whole client (`Client.ondecoded`), so the very
 * first connection died mid-handshake and the joins sent behind it were never answered.
 *
 * `active` is true from the moment `connect()` subscribes until the socket is disconnected or
 * gives up, which is exactly "already opening or open".
 */
export function connectSocket(): Socket {
  const client = getSocket();
  if (!client.active && !client.connected) {
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
  if (refusalTimer !== null) {
    clearTimeout(refusalTimer);
    refusalTimer = null;
  }
  refusals = 0;
  const client = socket;
  socket = null;
  client.disconnect();
  client.io.off('reconnect_failed', onReconnectFailed);
  client.off('connect', onConnected);
  client.off('connect_error', onConnectionRefused);
  client.off('disconnect', onConnectionRefused);
  // Drops any listener a hook forgot to remove, so the instance and its closures can go.
  client.removeAllListeners();
}
