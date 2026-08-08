# 0005. Realtime: Socket.io + Redis Adapter

**Status:** Accepted
**Date:** 2026-08-08

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0005-realtime-socketio.md)

## Context

A kanban board needs board/task state to stay in sync across connected clients.
The project already runs its own Postgres and Redis infrastructure rather than
targeting a serverless deployment.

## Decision

**Socket.io** with **`@socket.io/redis-adapter`**, over bare `ws` and over
managed realtime services (Ably, Pusher, Liveblocks).

## Rationale

- With self-hosted infrastructure already in place, Socket.io + the Redis
  adapter is the standard choice: `@socket.io/redis-adapter` fans events out
  across all server instances, which is required for horizontal scaling.
- Bare `ws` has lower overhead but leaves room management and automatic
  reconnection to be hand-built — both are needed anyway for a kanban board's
  multi-client scenario, so the savings don't materialize.
- Managed services (Ably, Pusher, Liveblocks) solve problems specific to
  serverless deployments; they don't apply here since we operate our own
  server infrastructure end to end.
- **Deliberate sequencing:** realtime is placed last in the feature order (see
  [project-skeleton.md](../project-skeleton.md)) — after auth, boards, tasks,
  task metadata, filtering, and dashboards — because the data flow needs to
  settle first. Wiring sockets in early would mean updating event contracts on
  every subsequent feature change.

## Consequences

- Rooms and reconnection are handled by the library rather than hand-rolled.
- A proven horizontal-scaling path exists via the Redis adapter when multiple
  server instances are needed.
- No vendor lock-in or per-connection managed-service cost.
- Redis pub/sub becomes another load pattern to operate, on top of its caching
  and queue duties.
- Deferring realtime to last means socket event contracts aren't validated
  against real usage until late in the build — reworks discovered then could
  ripple back into earlier features.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Bare `ws` | Lower overhead, but rooms and reconnection logic — both needed anyway — would have to be hand-written |
| Ably / Pusher / Liveblocks (managed) | Solve serverless scaling problems we don't have; add cost and an external dependency that self-hosted infra makes unnecessary |
