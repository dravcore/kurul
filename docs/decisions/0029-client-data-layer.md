# 0029. The Client Data Layer Stays Hand-Rolled; the Flip Trigger Is the Third Generation Counter

**Status:** Accepted
**Date:** 2026-08-23

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0029-client-data-layer.md)

## Context

`apps/web` has no data-fetching library. It has never had one, and until now nothing wrote
down why, which meant every new screen re-argued the question from scratch and the answer
depended on who was writing it. This ADR records what the layer actually is, states the rules
it runs by, and fixes the one number that would flip it.

What exists today, in four pieces:

- **`lib/api.ts`** is a typed `fetch` wrapper: `api.get/post/patch/delete`, plus `apiStatus`
  and `resolveApiMessage` for turning a rejection into the right sentence. It carries no cache,
  no retry and no dedupe. That is deliberate: HTTP semantics and error mapping are the parts
  the API contract pins down ([api-conventions.md](../api-conventions.md)), and they are stable.
- **`lib/use-api-resource.ts`** is the read primitive: one `AbortSignal`, one `loading`, one
  `error`, one `failed`, `reload`, and a `setData` for local edits. It models **one value
  arriving once**, and the `fetcher` identity is the whole of its invalidation story. A `null`
  fetcher is how a screen holds off before it knows its workspace id. `useResourceField`
  narrows a setter to one field of a multi-list resource, so four lists fetched together stay
  one abort and one failure. About fifteen modules use it.
- **The board hook pattern.** `BoardView` owns no fetching of its own; it composes small hooks
  that each own one concern, and this ADR's companion refactor extends that pattern one level
  down: `useBoardCaches` (the lists and the two refs that mirror them), `useBoardFetch` (the
  reads), `useBoardLoad` (skeleton, error, retry), `useBoardPanelTask` (the deep-linked row),
  `useBoardData` (the composer), then `useBoardMutations`, `useBoardRealtime`,
  `useBoardTaskDnd` and `useBoardDialogs`.
- **Socket.io, carrying ids and not rows.** `use-board-socket.ts` and
  `use-notification-socket.ts` join a room, hold their handlers in a ref so an unstable callback
  does not re-subscribe, and ack a join with a resync request. Payloads are ids
  ([ADR 0005](0005-realtime-socketio.md)), so a created or updated task is **refetched**, which
  is why the client needs no merge strategy for server-pushed entities and no field-level
  conflict rules.

### The census this decision turns on

"Copies of the reconciliation pattern" is the ROADMAP row's shorthand, and it is too loose to
count with, so the codebase was read three times with three different definitions.

**Full optimistic writes** (snapshot, write the predicted value locally, merge the server's
answer over it, restore the snapshot on failure). **Three:**

| Site                                                                   | What it predicts                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `use-board-mutations.ts` `commitTaskMove`                              | The dragged card's column and position                          |
| `task-panel-fields.tsx` `save` (was `task-panel.tsx` before the split) | The task's title and description                                |
| `use-task-checklists.ts` `toggleItem`                                  | One checklist tick, plus the recounted `checklistSummary` badge |

Two near-misses sit next to them and are worth naming so nobody counts them by accident:
`task-properties-panel.tsx` `patchTask` restores a snapshot but never pre-writes, and
`workspace-provider.tsx` `onSwitch` pre-writes `activeId` but has no snapshot to go back to.

**Merge-a-server-row-into-a-local-list-by-id**, with no local prediction at all. **Twelve:**
`use-board-realtime.ts` `upsertRemoteTask`, `use-board-fetch.ts` `drainTasks`'s page merge,
`use-board-panel-task.ts`'s `onSuccess` fold, `board-view.tsx` `applyTaskPatch` and
`onColumnSaved`, `use-task-metadata.ts` `loadMoreComments`, `notifications-list.tsx` and
`use-notification-menu.ts` `openNotification`, `members-settings.tsx` twice,
`board-list.tsx` `onRenamed`, and `workspace-provider.tsx` `renameActiveWorkspace`.

**Generation-counted writes** (a request that, on resolving, has to ask whether it is still
the latest one before it is allowed to touch state). **Two:** `use-board-mutations.ts`
`moveGenerationRef` and `workspace-provider.tsx` `switchGenerationRef`, the second of which
says in its own comment that it is copying the first.

Those three numbers are the baseline. Twelve is not alarming: an id-keyed merge is four lines
and its correctness is local. Three is not alarming either. Two is the one that matters, and
the next section says why.

## Decision

**The client data layer stays hand-rolled, and the flip trigger is the third generation
counter.**

`grep -rn "GenerationRef" apps/web` returns two hits today. **When it returns three, the web
app adopts React Query.** No debate, no re-measurement, no judgement call about whether this
particular counter was avoidable.

That is the ROADMAP row's "third copy of the reconciliation pattern" sharpened, and it is
sharpened rather than adopted verbatim because on the loose reading the trigger has already
fired: there are three full optimistic writes today and the layer is fine. Splitting the
pattern into its parts is what makes the count mean something. The cheap part is the shape:
snapshot, predict, merge, roll back, about twenty lines, obvious at the call site, and its
failure mode is visible in the component it lives in. The expensive part is the concurrency
bookkeeping around it: deciding whether a response that has arrived is still allowed to be
believed. That reasoning is subtle, it is easy to get quietly wrong (the wrong answer is not a
crash, it is a stale value that looks correct), and it is the exact thing a query library owns
for you. Two hand-written instances is a coincidence. Three is a policy.

The rules the layer runs by, so the next screen does not re-derive them:

1. **A read that is one value arriving once goes through `useApiResource`.** No new bespoke
   `AbortController` plus `loading` plus `error` triple. The `if (signal.aborted)` guard around
   each `setState` is the part that is easy to forget, and forgetting it writes the previous
   workspace's rows into the new view.
2. **A read that is several values arriving at different times stays hand-rolled, and says so
   in a comment.** There is exactly one today: the board load, where the frame and the first
   task page together decide when the skeleton comes down while the remaining pages stream in
   behind an already-painted board. `useBoardLoad`'s docstring carries that argument. A second
   such read is not a trigger, but it must earn the same paragraph.
3. **Writes live in a hook beside the state they touch**, not in a shared mutation registry.
   An optimistic pre-write is opt-in and each one states the rollback it will perform. A write
   with no visible latency problem does not get one: `use-task-attachments.ts` applies strictly
   after the await, on purpose, and its docstring contrasts itself with the checklist toggle.
4. **Socket payloads are ids; the client refetches.** No client-side entity cache, no
   normalization, no cross-hook cache keys. This is what keeps the realtime layer free of merge
   rules, and it is the reason the twelve id-keyed merges are each four lines rather than a
   shared reducer nobody can read.
5. **A new `*GenerationRef` is the trigger, not a code review comment.** Whoever needs the
   third one opens the React Query migration instead of writing it.

**Cost when triggered**, stated now so the trigger is a plan and not an alarm: add
`@tanstack/react-query`, keep `lib/api.ts` unchanged as the fetcher, re-implement
`useApiResource`'s signature on top of `useQuery` so its consumers migrate without touching
their call sites, move the three optimistic writes to `useMutation` with `onMutate`/`onError`
rollback, and leave the board's streaming drain as a manual `setQueryData` per page, because
that shape does not become expressible just because a library arrived. Estimated at one focused
change, not a rewrite, which is the other reason waiting is safe.

## Rationale

**Why not React Query now.** The honest reason is that the two things it is bought for are not
problems here yet. Its cache is a cross-component dedupe and a staleness policy, and this app
has almost no read shared between two mounted components: the board owns its lists, the panel
owns its four metadata lists, the settings screens each own one. Its mutation machinery is
optimistic-update ergonomics, and three call sites do not amortise a new mental model that
every future contributor has to learn before they can add a screen. Against that sit real
costs: a `QueryClientProvider` in the test tree for suites that currently render plain
components, ~13 kB gzipped, and a second answer to "where does this data live" alongside the
`useApiResource` calls that would remain during any incremental migration.

**Why the trigger is a counter and not a date or a file size.** A date expires whether or not
the codebase changed. A line count measures the wrong thing, as this PR's companion refactor
shows: `use-board-data.ts` went from 381 lines to 158 without one line of its logic getting
simpler, because the lines were four concerns stacked, not one concern that was too big. A
generation counter, by contrast, appears exactly when someone has hit real request concurrency
and has decided to solve it by hand. It is greppable, it is countable by anyone in one command,
and it cannot be argued down.

**Why the hand-rolled layer is defensible on its own terms and not just cheap.** Both
primitives already do the thing teams usually adopt a library to get right. `useApiResource`
sets `loading`/`error` during render when the request identity changes rather than from the top
of the effect, which removes a whole class of one-frame lies where a consumer reads
`loading === false` next to the previous request's error. The board load reveals on the first
page instead of the last. Both socket hooks flip `connected` only once the room is actually
joined, so a socket that connected and was denied the room does not look live. None of that is
free with a query library either; it is application logic that would survive the migration
unchanged.

## Consequences

- **The activity feed is unblocked.** The Beyond MVP row
  [Realtime push of the activity feed](../../ROADMAP.md#beyond-mvp) was waiting on this ADR, and
  what it was waiting for is an answer to "which layer do I build this in". It can now be built
  with the idiom that already exists and adds no new state: the panel's comment path already
  does it. `use-board-realtime.ts`'s `onCommentAdded` bumps `metaRefreshKey` for the selected
  task, that key is part of `useTaskMetadata`'s fetcher identity, and a changed fetcher identity
  is what `useApiResource` treats as a reload. An activity event pushed on the board room does
  the same thing through the same key. What it must **not** do is introduce a fourth optimistic
  write or a third generation counter for a feed that is append-only and server-ordered; if it
  turns out to need one, that is the trigger firing and the feed waits for the migration.
- Rule 1 makes `useApiResource` the default answer for new read screens, which is a constraint
  on contributors as much as a convenience: a bespoke fetch triple in review now has a document
  to be measured against.
- The layer keeps its known gaps, named rather than discovered later: no cross-component request
  dedupe, no refetch on window focus, no background staleness. Where any of those has been
  wanted it was solved locally and narrowly, which is what `lib/use-poll-fallback.ts` is.
- Tests stay provider-free. The board and task suites render components and hooks directly, with
  no client to construct or reset between cases.
- The three optimistic writes stay bespoke, and each will keep needing its own test for the
  rollback path. That is the accepted recurring cost of this decision, and it is the cost the
  trigger is watching.

## Alternatives considered

| Alternative                                               | Why not                                                                                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt React Query now                                     | Buys a cross-component cache the app has almost no shared reads to fill, and mutation ergonomics for three call sites; costs a provider in every test tree and a second data-flow idiom during migration |
| SWR instead                                               | Same trade at a smaller size, and it has less to say about the mutation half, which is the only half showing strain                                                                                      |
| A global store (Zustand, Redux) for board and task state  | Moves server state into client state, which is the category error the socket layer was designed around: the API stays authoritative and payloads carry ids                                               |
| A normalized entity cache written in-house                | Adopts the hardest part of a query library and none of its testing, docs or community; strictly worse than flipping the trigger                                                                          |
| Server Components plus Next's `fetch` cache for the board | The board is a live, dragged, socket-updated surface behind a session cookie; nothing here is cacheable per request or renderable once                                                                   |
| A generic in-house `useMutation` wrapper now              | Three call sites whose optimistic shapes differ (a list reorder, two field patches, a recounted summary) would each need an escape hatch, leaving the abstraction plus the special cases                 |
| Trigger on a file-size or call-site count instead         | Counts symptoms of layering, not of difficulty; `use-board-data.ts` shrank by 58% in this same PR with no logic change                                                                                   |
| No trigger, revisit "when it hurts"                       | That is the state this ADR exists to end: the question was re-argued per screen and answered by whoever asked                                                                                            |
