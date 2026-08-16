# Phase 9 — Realtime — design

**Date:** 2026-08-09 · **Status:** shipped · **Scope:** board live sync (Socket.io)

## Goals

Two authenticated clients on the same board see each other’s task, column, and comment
mutations without refresh. Completing this phase closes Phases 1–9 MVP.

## Locked decisions

| Topic       | Choice                                                      |
| ----------- | ----------------------------------------------------------- |
| Scope       | Board sync only — no notification Socket push, no presence  |
| Transport   | Socket.io + `@socket.io/redis-adapter` (ADR 0005)           |
| Process     | In-process Nest gateway; no Compose `ws` split for MVP      |
| Payload     | Thin IDs + `actorId`; move includes `columnId` / `position` |
| Rooms       | `board:{boardId}` after membership-checked `board:join`     |
| Auth        | Better Auth session cookie on handshake                     |
| Emit timing | After successful mutation TX commit                         |
| Mid-drag    | Remote `task:moved` cancels drag, snaps to server, toast    |
| Reconnect   | Resync board tasks + columns via REST                       |

## Non-goals

Email, presence avatars, notification/unread Socket push, outbox/Redis stream fan-out,
separate `ws` process role.

## Auth and rooms

1. Handshake resolves session via `auth.api.getSession` + `fromNodeHeaders` (cookie).
2. Unauthenticated sockets are disconnected.
3. Client sends `board:join` `{ boardId }` → server verifies board exists and user is a
   workspace member → joins room `board:{boardId}`.
4. `board:leave` leaves the room. Unmount / disconnect cleans up via Socket.io.

## Events

Contract: `@kurul/shared-types` `SocketEvents` / payload map. Every payload includes
`actorId` for self-echo handling.

| Event            | Emit after                       | Client action                                      |
| ---------------- | -------------------------------- | -------------------------------------------------- |
| `task:created`   | task create                      | Fetch task if missing; insert into list            |
| `task:updated`   | patch / assignee / label         | Fetch task; replace in list                        |
| `task:moved`     | position move                    | Apply columnId+position; cancel mid-drag if active |
| `task:deleted`   | delete                           | Remove from list                                   |
| `column:changed` | column create/update/move/delete | Refetch columns                                    |
| `comment:added`  | comment create                   | Refetch comments if task panel open                |

## Client

- `useBoardSocket(boardId)` on board mount; `withCredentials: true`.
- Reconnecting UI copy from design.md (“Reconnecting…”).
- Realtime arrivals / drag cancel toasts use `aria-live="polite"`.

## Testing

- Unit: emit helper; join rejects non-members.
- E2E/smoke: authenticated join + mutation emit (or service spy if socket e2e is heavy).

## See also

- [ADR 0005](../../decisions/0005-realtime-socketio.md)
- [roadmap Phase 9](../roadmap-mvp-phases.md#phase-9--realtime)
