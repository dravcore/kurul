import type { BrowserContext, Locator, Page } from '@playwright/test';
import { cardHandle, column, waitForBoardReady } from '../support/board-page';
import { expect, test, type TestUser } from '../support/fixtures';
import type { Stack } from '../support/stack';
import { machine, median, ms, p95, report, sorted } from './stats';

/**
 * What the attachment badge costs the board — an A/B on this rig, and nothing more.
 *
 * ## What this is not
 *
 * It is **not** a repeat of P2-8, and nothing printed here may be laid beside P2-8's numbers.
 * That measurement was a DevTools performance profile of a card dragged by hand on a different
 * machine in a headed browser; a "34.1% busy" read off the DevTools panel and a "73.4% busy"
 * computed from `Performance.getMetrics` are not the same statistic to begin with, which is the
 * reason P3-2's badge agent already declined to quote across them. This file inherits both the
 * refusal and the substitute that agent used.
 *
 * What it does instead is the thing that *is* available: hold the rig fixed, change one variable
 * — every card carrying an attachment badge, or none of them — and report the difference. A
 * difference measured on one machine is a weaker claim than an absolute budget, and it is the
 * strongest claim this toolchain supports. It is also directly comparable to the A/B P3-2 ran
 * for `ChecklistBadge`, because it is deliberately the same shape.
 *
 * ## What is measured
 *
 *  - **DOM nodes** with the board painted, counted in the page. The badge measured out at five
 *    elements per card here; whether it is five or fifty is the kind of thing a refactor changes
 *    silently, and P3-2 chose `SquareCheckBig` over `ListChecks` on exactly this number.
 *  - **Paint** — `goto` to all cards present and the socket joined.
 *  - **A synthetic drag**, with Chromium's own counters (`Performance.getMetrics` over CDP)
 *    sampled either side: script, layout, style-recalc time and their counts.
 *  - **Frame pacing during that drag**, from `requestAnimationFrame` timestamps collected in
 *    the page. Reported as the median and p95 interval — a dropped frame shows up as an
 *    interval well over 16.7ms.
 *  - **Long tasks** (>50ms) over the whole iteration, via `PerformanceObserver`.
 *
 * ## What is NOT measured, and cannot be from here
 *
 *  - **Anything about a human drag.** Playwright dispatches synthetic pointer events at its own
 *    pace; the gesture is not the one a hand makes and the compositor is not under the same
 *    pressure. The frame intervals below describe *this* gesture.
 *  - **"% busy" over a profile window.** `Performance.getMetrics` reports cumulative durations,
 *    not a timeline, and there is no `TracingStartedInBrowser` capture here to divide by.
 *  - **The GPU / compositor side.** Metrics here are main-thread only.
 *  - **Headed rendering.** This runs headless, which is the whole reason the numbers cannot be
 *    laid beside P2-8's.
 *  - **Real attachment bytes.** The badge reads `TaskDto.attachmentCount`, which counts rows of
 *    either kind, so the "with" variant attaches LINK rows — same count, same badge, no file
 *    upload to make the setup take a minute. If that ever stops being true, this file is wrong.
 */

/** One full column's worth: `board-column.tsx` mounts its first 40 cards and reveals more on scroll. */
const CARDS = 40;
const ITERATIONS = 7;

interface Sample {
  nodes: number;
  paintMs: number;
  dragScriptMs: number;
  dragLayoutMs: number;
  dragStyleMs: number;
  dragLayoutCount: number;
  frameMedianMs: number;
  frameP95Ms: number;
  longTasks: number;
}

type Metrics = Record<string, number>;
type Session = Awaited<ReturnType<BrowserContext['newCDPSession']>>;

/**
 * One CDP session per page, enabled once.
 *
 * `Performance.enable` re-bases the counters, so a session created per read reports the time
 * since *that* call — which made every "delta" in the first version of this file zero, and
 * occasionally negative. Negative durations were the tell: a counter that only ever grows
 * cannot go backwards unless something reset it.
 */
async function readMetrics(session: Session): Promise<Metrics> {
  const { metrics } = await session.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((entry) => [entry.name, entry.value]));
}

/** Chromium's counters are cumulative, so every reported figure is a difference of two reads. */
function delta(before: Metrics, after: Metrics, name: string): number {
  return (after[name] ?? 0) - (before[name] ?? 0);
}

/**
 * Two boards, one workspace.
 *
 * Not two workspaces: the web app keeps an *active* workspace and scopes its reads to it, so a
 * board belonging to the other one answers "The board couldn't load." — measured, not guessed.
 * Two boards side by side also make the A/B tighter, since both arms share a workspace row, a
 * member row and a session.
 */
async function buildBoard(
  stack: Stack,
  owner: TestUser,
  workspaceId: string,
  withAttachments: boolean,
): Promise<{ boardId: string; columnName: string }> {
  const { board, columns } = await stack.createBoard(owner, workspaceId);
  const todo = columns[0]!;
  const titles = Array.from(
    { length: CARDS },
    (_, index) => `Card ${String(index).padStart(2, '0')}`,
  );
  const tasks = await stack.createTasks(owner, workspaceId, board.id, todo.id, titles);

  if (withAttachments) {
    for (const task of tasks) {
      const response = await owner.api.post(
        `/workspaces/${workspaceId}/tasks/${task.id}/attachments`,
        { data: { kind: 'LINK', url: 'https://example.invalid/spec', filename: 'Spec' } },
      );
      expect(response.ok(), `link attachment failed: ${response.status()}`).toBe(true);
    }
  }

  return { boardId: board.id, columnName: todo.name };
}

async function measureOnce(
  page: Page,
  boardId: string,
  columnName: string,
  expectBadge: boolean,
): Promise<Sample> {
  // Installed before the navigation so the observer exists before the first long task can
  // happen — a `PerformanceObserver` created after the fact sees nothing, and `buffered: true`
  // only helps for entries the browser was already keeping.
  await page.addInitScript(() => {
    (window as unknown as { __longTasks: number }).__longTasks = 0;
    new PerformanceObserver((list) => {
      (window as unknown as { __longTasks: number }).__longTasks += list.getEntries().length;
    }).observe({ entryTypes: ['longtask'] });
  });

  const startedAt = performance.now();
  await page.goto(`/board/${boardId}`);
  await waitForBoardReady(page);
  const board = column(page, columnName);
  await expect(board.getByRole('button', { name: /^Reorder / })).toHaveCount(CARDS);
  // The variable itself, asserted rather than assumed: an A/B whose "with" arm silently lost
  // its badges is two measurements of the same thing.
  await expect(board.getByLabel('1 attachment')).toHaveCount(expectBadge ? CARDS : 0);
  const paintMs = performance.now() - startedAt;

  // Counted in the page, not from `Performance.getMetrics`.
  //
  // CDP's `Nodes` counter includes detached nodes the collector has not reached yet, so on a
  // reused tab it climbs monotonically across navigations: the first version of this file read
  // 1254 nodes on iteration one and 12000 on iteration seven, which made the *arm that ran
  // second* look cheaper. A `querySelectorAll('*')` counts what is attached and nothing else,
  // and the tab is fresh per iteration anyway.
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);

  await page.evaluate(() => {
    const state = window as unknown as { __frames: number[] };
    state.__frames = [];
    const tick = (timestamp: number): void => {
      state.__frames.push(timestamp);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const before = await readMetrics(session);
  await dragWithinColumn(page, board);
  const after = await readMetrics(session);
  await session.detach();

  const frames = await page.evaluate(
    () => (window as unknown as { __frames: number[] }).__frames ?? [],
  );
  const intervals = frames.slice(1).map((value, index) => value - (frames[index] ?? value));
  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number }).__longTasks ?? 0,
  );

  return {
    nodes,
    paintMs,
    dragScriptMs: delta(before, after, 'ScriptDuration') * 1000,
    dragLayoutMs: delta(before, after, 'LayoutDuration') * 1000,
    dragStyleMs: delta(before, after, 'RecalcStyleDuration') * 1000,
    dragLayoutCount: delta(before, after, 'LayoutCount'),
    frameMedianMs: median(intervals),
    frameP95Ms: p95(intervals),
    longTasks,
  };
}

/**
 * Drags the top card of the column onto the third, and refuses to return until the order has
 * actually changed.
 *
 * The three cards nearest the top, and **no scrolling**. The first version of this file dragged
 * card 0 onto card 8: scrolling card 8 into view pushed card 0 off the top, the press landed on
 * empty space, and the measurement reported a drag that never happened — `LayoutCount` delta 0
 * on every iteration, which is what gave it away. The assertion at the end is the fix that
 * survives: a no-op gesture is now a failed measurement rather than a flattering one.
 */
async function dragWithinColumn(page: Page, board: Locator): Promise<void> {
  const labels = await board
    .getByRole('button', { name: /^Reorder / })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  const title = (index: number): string => (labels[index] ?? '').replace(/^Reorder /, '');
  const moved = title(0);
  const from = await centre(cardHandle(board, moved));
  const to = await centre(cardHandle(board, title(2)));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Past dnd-kit's 6px activation distance first; a single jump is one pointer event, not a
  // gesture, and starts no drag at all (`support/board-page.ts` documents the same three rules).
  await page.mouse.move(from.x, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.move(to.x, to.y + 1, { steps: 2 });
  await page.mouse.up();

  await expect
    .poll(
      () =>
        board
          .getByRole('button', { name: /^Reorder / })
          .first()
          .getAttribute('aria-label'),
      { message: 'the drag must actually move a card, or the metrics describe nothing' },
    )
    .not.toBe(`Reorder ${moved}`);
}

/** No `scrollIntoViewIfNeeded`: see `dragWithinColumn`. Every card this touches is above the fold. */
async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element has no bounding box — it is not laid out.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function summarise(label: string, samples: Sample[], key: keyof Sample, unit: 'ms' | ''): string {
  const values = samples.map((sample) => sample[key]);
  const format = (value: number): string => (unit === 'ms' ? ms(value) : value.toFixed(0));
  return `${label.padEnd(16)} median ${format(median(values)).padEnd(10)} p95 ${format(p95(values)).padEnd(10)} raw ${sorted(
    values,
  )
    .map((value) => (unit === 'ms' ? value.toFixed(1) : value.toFixed(0)))
    .join(' ')}`;
}

test('board cost with and without the attachment badge', async ({ stack, openAs }) => {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const withBadges = await buildBoard(stack, owner, workspace.id, true);
  const withoutBadges = await buildBoard(stack, owner, workspace.id, false);

  const page = await openAs(owner);
  const on: Sample[] = [];
  const off: Sample[] = [];

  // One tab for all fourteen samples, navigated to `about:blank` between them so the previous
  // board is detached rather than merely replaced.
  //
  // A fresh context per sample was tried first and is the cleaner idea — no carried-over JIT
  // state, no warm cache — but fourteen contexts opened and closed in sequence left the board's
  // socket stuck on "Reconnecting…" partway through the run, and a measurement rig that flakes
  // is worse than one with a named bias. The bias is this: every number below is a *warm* tab's
  // number, and the two arms alternate so the warming is shared. The absolute paint figure is
  // therefore optimistic; the difference between the arms, which is the only thing this file
  // claims, is not affected.
  //
  // Alternated rather than run in two blocks: thermal drift and background load on a laptop are
  // slow, so two consecutive blocks would attribute the drift to the variable.
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const arms = [
      [on, withBadges, true],
      [off, withoutBadges, false],
    ] as const;
    // …and the order within a pair flips every iteration. Always measuring the badged arm first
    // would hand it every cost of being first — a colder cache, a colder allocator — and the
    // whole result here is a difference of a few milliseconds, which is exactly the size such
    // an artefact has.
    for (const [samples, board, expectBadge] of iteration % 2 === 0 ? arms : [arms[1], arms[0]]) {
      await page.goto('about:blank');
      samples.push(await measureOnce(page, board.boardId, board.columnName, expectBadge));
    }
  }

  for (const [label, samples] of [
    [`${CARDS} cards, every card badged`, on],
    [`${CARDS} cards, no attachments`, off],
  ] as const) {
    report(`board A/B — ${label} (${ITERATIONS} iterations)`, [
      `machine   ${machine()}`,
      `browser   headless Chromium, ${ITERATIONS} loads + one synthetic drag each`,
      summarise('DOM nodes', samples, 'nodes', ''),
      summarise('paint', samples, 'paintMs', 'ms'),
      summarise('drag script', samples, 'dragScriptMs', 'ms'),
      summarise('drag layout', samples, 'dragLayoutMs', 'ms'),
      summarise('drag style', samples, 'dragStyleMs', 'ms'),
      summarise('layout count', samples, 'dragLayoutCount', ''),
      summarise('frame gap', samples, 'frameMedianMs', 'ms'),
      summarise('frame gap p95', samples, 'frameP95Ms', 'ms'),
      summarise('long tasks', samples, 'longTasks', ''),
    ]);
  }
});
