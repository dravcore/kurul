import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Talking to the board through the affordances a person uses.
 *
 * There is not a single `data-testid` in this application's production code, and this suite
 * does not add one. That is not purism: the board's accessible surface — `<section
 * aria-label="To Do">` for a column, `aria-label="Reorder <title>"` on each card's grip — is
 * richer than a test id would be, and asserting through it means a change that breaks a
 * screen-reader user also breaks this suite. A test id would have kept passing.
 */

/** A column is a `<section aria-label>`, which is an ARIA `region`. */
export function column(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** The grip button on a card — the drag handle, and the most stable per-card locator. */
export function cardHandle(scope: Page | Locator, title: string): Locator {
  return scope.getByRole('button', { name: `Reorder ${title}`, exact: true });
}

/**
 * The titles of the cards currently rendered in <column>, top to bottom.
 *
 * Read off the grip buttons' `aria-label` rather than the card text because a card's visible
 * text also carries a priority icon title, a due date and assignee names, and a helper that
 * has to strip those is a helper that will one day strip the wrong thing.
 *
 * Only *rendered* cards are counted, which is the honest thing to return: a column mounts its
 * first 40 cards and reveals more on scroll (`components/board/board-column.tsx`). Every
 * scenario here works with three or four cards, well inside that budget.
 */
export async function cardOrder(scope: Locator): Promise<string[]> {
  const labels = await scope
    .getByRole('button', { name: /^Reorder / })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  return labels.map((label) => label.replace(/^Reorder /, ''));
}

/**
 * Asserts the top-to-bottom card order of a column, waiting for it to settle.
 *
 * `expect.poll` rather than a bare `expect(await cardOrder(...))`: after a drop the order
 * changes twice — once optimistically, once when the server's answer lands — and after a
 * realtime event it changes when the socket payload arrives. Polling is what lets the
 * assertion describe the end state instead of racing one of the intermediate ones.
 */
export async function expectCardOrder(
  scope: Locator,
  expected: string[],
  message: string,
): Promise<void> {
  await expect.poll(() => cardOrder(scope), { message, timeout: 10_000 }).toEqual(expected);
}

/**
 * Longer than `playwright.config.ts`'s global 10s `expect.timeout` on purpose: that ceiling is
 * sized for the realtime path's worst *steady-state* case (a debounce plus a refetch), not for
 * the handshake this precondition waits on. On a cold CI runner the socket's first connect can
 * still be mid-flight — TLS plus the Socket.io handshake plus the `board:join` round trip,
 * queued behind whatever else is starting up — well past 10s without the join having failed or
 * even backed off once (`lib/socket.ts`'s reconnection backoff only engages after a failed
 * attempt). Failing this precondition on a slow-but-live socket was never the regression this
 * suite is watching for; every scenario's own assertions after `waitForBoardReady` still run
 * under the tighter global timeout, so a genuinely hung join is still caught, just given room
 * to be slow rather than merely wrong.
 */
const BOARD_READY_TIMEOUT_MS = 25_000;

/**
 * Waits until the board has painted and its socket has joined the board room.
 *
 * The room join matters even for the tests that never assert on realtime: joining acks with a
 * full resync, and a resync landing in the middle of a drag assertion is a race the suite
 * would otherwise have to out-run. `Reconnecting…` is the application's own word for "the
 * room is not joined yet" — it is rendered until the `board:join` ack comes back `ok`.
 */
export async function waitForBoardReady(page: Page): Promise<void> {
  await expect(column(page, 'To Do')).toBeVisible({ timeout: BOARD_READY_TIMEOUT_MS });
  await expect(page.getByText('Reconnecting…')).toBeHidden({ timeout: BOARD_READY_TIMEOUT_MS });
}

/**
 * Drags one card onto another with a real mouse, and waits for the drop to be applied.
 *
 * Three things about this are not optional:
 *
 * 1. **The grip, not the card body.** A card is an `<a href>`; pressing and releasing on it
 *    can end as a click that navigates to the task panel, which would make a failed drag look
 *    like a passing one right up until the order assertion. The grip is a `<button
 *    type="button">` and pointer listeners sit on the wrapper both share, so the drag starts
 *    either way — only the failure mode differs.
 * 2. **A move past the activation distance before anything else.** The PointerSensor is
 *    configured with `activationConstraint: { distance: 6 }`, so a `dragTo()` or a single
 *    jump to the destination never starts a drag at all: dnd-kit sees one pointer event, not
 *    a gesture.
 * 3. **Coordinates measured before the press.** dnd-kit's sortable snapshots every
 *    droppable's rect at drag start and detects collisions against that snapshot, so the
 *    pre-drag layout is the correct frame of reference — even though cards visibly slide out
 *    of the way while the pointer is down.
 *
 * Both points are taken from the grips, so the dragged card's rect ends up superimposed on
 * the target's: `closestCorners` then has an unambiguous winner rather than a near-tie
 * between two neighbours.
 */
export async function dragCardOnto(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const from = await centreOf(cardHandle(page, sourceTitle));
  const to = await centreOf(cardHandle(page, targetTitle));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Straight down and short: enough to cross the 6px threshold, not enough to leave the card.
  await page.mouse.move(from.x, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 16 });
  // One more event at rest. dnd-kit recomputes collisions per pointer move, and the last
  // move of a `steps` run and the drop would otherwise be the same frame.
  await page.mouse.move(to.x, to.y + 1, { steps: 2 });
  await page.mouse.up();
}

/**
 * Drags one card onto another with a **finger**, and waits for the drop to be applied.
 *
 * Everything `dragCardOnto` says about coordinates and the activation distance holds here
 * too. Two things are different, and both are the point of having a second helper:
 *
 * 1. **Real touch events, dispatched over CDP.** `page.mouse` in a `hasTouch` context still
 *    produces *mouse* events, and a mouse event is exactly what a phone does not send.
 *    `Input.dispatchTouchEvent` is what makes Chromium synthesise `pointerdown` with
 *    `pointerType: 'touch'` — which is the input dnd-kit's `PointerSensor` has to cope with,
 *    and the one where `touch-action` decides whether the gesture becomes a drag or a scroll.
 * 2. **The grip, and only the grip.** On touch the card body belongs to the column's
 *    scroller: the wrapper carrying dnd-kit's listeners has no `touch-action` of its own, so
 *    the browser claims a vertical drag there and cancels the pointer. The grip declares
 *    `touch-action: none` (`components/task/sortable-task-card.tsx`) and is the one place the
 *    gesture reaches dnd-kit. That is a deliberate division and it is asserted from both
 *    sides in `tests/mobile-navigation.spec.ts`.
 */
export async function touchDragCardOnto(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const from = await centreOf(cardHandle(page, sourceTitle));
  const to = await centreOf(cardHandle(page, targetTitle));
  const cdp = await page.context().newCDPSession(page);

  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    point?: { x: number; y: number },
  ): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: point ? [{ x: point.x, y: point.y }] : [],
    });
  };

  await touch('touchStart', from);
  // Past the 6px activation distance first, in small steps, exactly as the mouse helper does.
  await touch('touchMove', { x: from.x, y: from.y + 12 });
  const steps = 16;
  for (let step = 1; step <= steps; step += 1) {
    await touch('touchMove', {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + 12 + ((to.y - (from.y + 12)) * step) / steps,
    });
  }
  await touch('touchMove', { x: to.x, y: to.y + 1 });
  await touch('touchEnd');
  await cdp.detach();
}

export async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  // `scrollIntoViewIfNeeded` before measuring: a card below the fold is reached by scrolling,
  // and a bounding box measured before that scroll would name a point the pointer can never be
  // at. Which box actually scrolls changed with the fix for issue #184 — it used to be the
  // document, because the board's height chain did not constrain its columns and a tall column
  // grew the page instead; it is now the column's own `overflow-y-auto`. This call is correct
  // under both, which is why the fix did not move it: `scrollIntoViewIfNeeded` scrolls whatever
  // ancestor is scrollable, and the measurement happens after.
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Element has no bounding box — it is not laid out.');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
