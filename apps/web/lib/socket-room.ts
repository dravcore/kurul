import type { Socket } from 'socket.io-client';

/**
 * Emits a room join and keeps emitting it, with backoff, until the server acks `ok`.
 *
 * A join is emitted once per connection, from the socket's `connect` handler. Without a retry
 * a single denied ack is therefore permanent for the life of that socket: the room is never
 * joined, no event ever arrives, and the view keeps rendering its "not live" state — the board
 * shows "Reconnecting…" while the socket underneath is connected and perfectly healthy. That
 * is the UI describing a recovery that is not happening, and it is what a person sees for as
 * long as the tab stays open.
 *
 * The denials worth retrying are the transient ones: a membership row written moments ago and
 * not yet visible to the read, a board created in the same breath as the page that opens it.
 * A permanent denial (not a member, board deleted) is retried too, and that is deliberate —
 * the client cannot tell the two apart from an opaque ack, and the API answers them opaquely on
 * purpose, so the honest reading of "denied" is "not yet". The backoff is what keeps that from
 * costing anything: the delay doubles from `firstDelayMs` to `maxDelayMs` and stays there, so a
 * genuinely closed door is knocked on every `maxDelayMs`, not continuously.
 */
export type JoinRetryOptions = {
  firstDelayMs?: number;
  maxDelayMs?: number;
};

const DEFAULT_FIRST_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 15_000;

export type RoomJoin = {
  /** Emits the join now, cancelling any retry that was already parked. */
  start: () => void;
  /** Stops retrying. Safe to call when nothing is parked. */
  cancel: () => void;
};

export function createRoomJoin(
  socket: Socket,
  event: string,
  payload: Record<string, string>,
  onJoined: () => void,
  options: JoinRetryOptions = {},
): RoomJoin {
  const firstDelayMs = options.firstDelayMs ?? DEFAULT_FIRST_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let cancelled = false;

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function emit(): void {
    if (cancelled) return;
    socket.emit(event, payload, (ack: { ok?: boolean } | undefined) => {
      if (cancelled) return;
      if (ack?.ok) {
        attempt = 0;
        onJoined();
        return;
      }
      // A socket that dropped between the emit and the ack will re-join from `connect`; a
      // retry parked against the dead connection would only race that one.
      if (!socket.connected) return;
      const delay = Math.min(firstDelayMs * 2 ** attempt, maxDelayMs);
      attempt += 1;
      clear();
      timer = setTimeout(emit, delay);
    });
  }

  return {
    start(): void {
      cancelled = false;
      attempt = 0;
      clear();
      emit();
    },
    cancel(): void {
      cancelled = true;
      clear();
    },
  };
}
