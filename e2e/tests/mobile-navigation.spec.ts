import type { BrowserContextOptions, Locator, Page } from '@playwright/test';
import { expect, test, type TestUser } from '../support/fixtures';
import {
  cardHandle,
  centreOf,
  column,
  expectCardOrder,
  touchDragCardOnto,
  waitForBoardReady,
} from '../support/board-page';
import type { Stack } from '../support/stack';

/**
 * Scenario 7 — the board on a phone.
 *
 * This is the one scenario in the suite whose subject is the *viewport*. Everything it claims
 * is a fact about layout under a real engine at a real width, and there is no in-process suite
 * that can disagree with it: jsdom lays nothing out, so every `getBoundingClientRect` in a
 * Vitest test is zeros and a "touch targets are 44px" assertion there would pass whatever the
 * classes said. That is the admission criterion at the top of `playwright.config.ts` — a way
 * the product comes apart that only a browser can see — and it is met here twice over, because
 * the *input* is also different in kind: `hasTouch` + `isMobile` is what gives the page a
 * touchscreen and `pointer: coarse`, and neither can be added after the context exists.
 *
 * Four claims, one per test:
 *
 *   1. Navigation exists below 768px and behaves like a modal layer (FE-06).
 *   2. At 768px it stops, and the desktop shell is exactly what it was.
 *   3. Every interactive element on the mobile path is at least 44px (FE-06's metric).
 *   4. The document does not scroll and the column does (issue #184) — and a card can still be
 *      dragged with a finger, which is the thing that had to survive both changes.
 *
 * What this scenario does **not** establish is the roadmap's third clause, "the board flow can
 * be completed end to end on a real device". Chromium's mobile emulation is a viewport, a
 * touchscreen and a user-agent string; it is not a phone's renderer, its font metrics, its
 * scroll physics or its on-screen keyboard. That clause is an operator check and is not
 * claimed here.
 */

/**
 * 360×740 — the narrowest width the roadmap names, and roughly a Pixel in portrait.
 *
 * `isMobile` brings the mobile user-agent and overlay scrollbars (so a classic scrollbar does
 * not eat 15px of a 360px viewport and quietly change every answer below); `hasTouch` is what
 * makes a dispatched touch land on a page that believes it has a touchscreen.
 */
const PHONE: BrowserContextOptions = {
  viewport: { width: 360, height: 740 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
};

/**
 * 768px exactly — the `md` boundary, where the mobile layout has to stop.
 *
 * A boundary rather than a comfortable tablet width on purpose: Tailwind's `max-md` is
 * `width < 768px`, so 768 is the first pixel that belongs to the desktop layout and is where
 * an off-by-one would show. The same test at 1024px would stay green with the drawer wrongly
 * extended to 900.
 */
const TABLET: BrowserContextOptions = {
  viewport: { width: 768, height: 1024 },
  hasTouch: true,
};

/** WCAG 2.5.5 (AAA), and the figure `docs/design.md` §4 holds the mobile layout to. */
const MIN_TOUCH_TARGET_PX = 44;

interface Fixture {
  owner: TestUser;
  boardPath: string;
  columnNames: string[];
}

async function boardWith(stack: Stack, titles: string[]): Promise<Fixture> {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const { board, columns } = await stack.createBoard(owner, workspace.id);
  await stack.createTasks(owner, workspace.id, board.id, columns[0]!.id, titles);
  return {
    owner,
    boardPath: `/board/${board.id}`,
    columnNames: columns.map((entry) => entry.name),
  };
}

/** A finger, not a mouse: `click()` in a touch context still sends mouse events. */
async function tap(page: Page, locator: Locator): Promise<void> {
  const point = await centreOf(locator);
  await page.touchscreen.tap(point.x, point.y);
}

/**
 * A column's scroll container — the only locator in this suite that is structural rather than
 * an affordance.
 *
 * `board-page.ts` says the suite talks to the board through the surface a person uses, and it
 * holds: a scroll container is not something a person addresses, it is a box, and it has no
 * accessible surface to address it by. It is the `<section aria-label>`'s single element
 * child after the header, which is as close to naming it as the DOM allows without adding a
 * test id this codebase does not have.
 */
function columnScroller(section: Locator): Locator {
  return section.locator('xpath=./div');
}

interface Target {
  name: string;
  width: number;
  height: number;
}

/**
 * Every interactive element currently on screen, with its measured box.
 *
 * A sweep rather than a hand-written list of the controls this author happened to think of:
 * the claim is about *every* interactive element on the mobile path, and a list is exactly how
 * the control added next quarter escapes it.
 *
 * Two exclusions, both narrow and both necessary:
 *   - `aria-hidden` subtrees. While the drawer is open, Radix marks the whole page behind it
 *     hidden and inert; measuring those would be measuring controls no finger can reach.
 *   - Boxes under 4px in either axis. That is the visually-hidden band — the skip link's 1×1
 *     `sr-only` box, Radix's zero-size focus guards — none of which are targets while they are
 *     hidden. The skip link is not let off: it is measured in the first test at the moment it
 *     is focused, which is the only moment it is one.
 *
 * One substitution: a **checkbox is measured by its label**. A native checkbox is a 14px
 * platform control that is not going to be resized into a 44px square without ceasing to look
 * like a checkbox, and it does not need to be — its label toggles the same input, sits flush
 * against it, and is the box a thumb actually aims at. Measuring the label is measuring the
 * target; measuring the 14px box would be measuring a decoration. A checkbox with no label at
 * all falls through to its own box and fails, which is the correct outcome.
 */
async function visibleTargets(scope: Page | Locator): Promise<Target[]> {
  const selector = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
  ].join(', ');

  return scope.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((node) => !node.closest('[aria-hidden="true"]'))
      .map((node) => {
        const isCheckbox =
          node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio');
        const labelled = isCheckbox
          ? (node.closest('label') ??
            (node.id ? document.querySelector(`label[for="${node.id}"]`) : null))
          : null;
        const target = labelled ?? node;
        const box = target.getBoundingClientRect();
        return {
          name:
            node.getAttribute('aria-label') ??
            target.textContent?.trim().slice(0, 40) ??
            node.tagName.toLowerCase(),
          width: Math.round(box.width * 100) / 100,
          height: Math.round(box.height * 100) / 100,
        };
      })
      .filter((target) => target.width > 4 && target.height > 4),
  );
}

function tooSmall(targets: Target[]): Target[] {
  return targets.filter(
    (target) => target.height < MIN_TOUCH_TARGET_PX || target.width < MIN_TOUCH_TARGET_PX,
  );
}

test('at 360px the sidebar is a drawer, and it behaves like a modal layer', async ({
  stack,
  openAs,
}) => {
  const { boardPath, owner } = await boardWith(stack, ['Alpha card', 'Bravo card']);
  const page = await openAs(owner, PHONE);

  await page.goto(boardPath);
  await waitForBoardReady(page);

  // The rail is gone. This is what FE-06 measured: at 360px it kept its 56px — 15% of the
  // viewport — and still could not show a workspace name in it. Resolved with `includeHidden`
  // and counted first, so this cannot pass by the sidebar having been deleted outright.
  const sidebar = page.getByRole('complementary', { includeHidden: true });
  await expect(sidebar, 'the desktop sidebar should still be rendered, just not shown').toHaveCount(
    1,
  );
  await expect(sidebar).toBeHidden();

  // And nothing overflows sideways. The board *canvas* scrolls horizontally on purpose; the
  // document must not, which is the whole point of the topbar reflow.
  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(documentOverflow, 'the page must not scroll horizontally at 360px').toBeLessThanOrEqual(0);

  const hamburger = page.getByRole('button', { name: 'Open navigation' });
  await expect(hamburger).toBeVisible();
  await tap(page, hamburger);

  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  // Focus is inside the layer, which is what makes the next Tab stay inside it.
  const focusIsInDrawer = await page.evaluate(
    () => document.activeElement?.closest('[data-slot="dialog-drawer-content"]') !== null,
  );
  expect(focusIsInDrawer, 'opening the drawer should move focus into it').toBe(true);

  // Escape dismisses and hands focus back to the control that opened it.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(hamburger).toBeFocused();

  // And the drawer actually navigates.
  await tap(page, hamburger);
  await expect(drawer).toBeVisible();
  await tap(page, drawer.getByRole('link', { name: 'Dashboard' }));
  await expect(page).toHaveURL('/dashboard');
  // The drawer does not survive the navigation. App Router keeps the shell mounted, so a
  // drawer that only closed on dismissal would still be covering the page it just opened.
  await expect(drawer).toBeHidden();

  // The skip link is still the first tab stop and still reaches `<main>` (PR #103). The drawer
  // added a portal and two focus guards to the document; this is the check that none of them
  // landed in front of it.
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await expect(skipLink).toBeFocused();
  const skipBox = await skipLink.boundingBox();
  expect(skipBox, 'the focused skip link must be laid out').not.toBeNull();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('at the md boundary the desktop shell is unchanged', async ({ stack, openAs }) => {
  const { boardPath, owner } = await boardWith(stack, ['Alpha card']);
  const page = await openAs(owner, TABLET);

  await page.goto(boardPath);
  await waitForBoardReady(page);

  // 768px is the first pixel of the desktop layout: the sidebar is back and the hamburger is
  // not shown. Both halves matter — a drawer that also appears beside a visible sidebar is two
  // navigations for the same thing.
  await expect(page.getByRole('complementary')).toBeVisible();
  const hamburger = page.getByRole('button', { name: 'Open navigation', includeHidden: true });
  await expect(
    hamburger,
    'the trigger is rendered at every width, and hidden above md',
  ).toHaveCount(1);
  await expect(hamburger).toBeHidden();
});

test('every interactive element on the mobile path is at least 44px', async ({ stack, openAs }) => {
  const { boardPath, owner } = await boardWith(stack, ['Alpha card', 'Bravo card']);
  const page = await openAs(owner, PHONE);

  // `?q=` puts an active filter chip on the board. The chip is a 24px pill on desktop by
  // design and is the control most likely to be forgotten, so the sweep runs with one on
  // screen rather than on a board that happens not to have any.
  await page.goto(`${boardPath}?q=card`);
  await waitForBoardReady(page);
  await expect(page.getByRole('button', { name: 'Remove filter Search: card' })).toBeVisible();

  const boardTargets = await visibleTargets(page);
  // Guards the sweep against passing on an empty set — `[].every(…)` is `true`, and a board
  // that failed to paint would otherwise read as a board with no undersized controls. The
  // floor is well under what this page actually has, so it does not need editing every time a
  // control moves.
  expect(boardTargets.length, 'the sweep found nothing to measure').toBeGreaterThanOrEqual(8);
  expect(
    tooSmall(boardTargets),
    `undersized controls on the board at 360px (of ${boardTargets.length} measured)`,
  ).toEqual([]);

  // Now the drawer, whose controls are the ones the finding is actually about.
  await tap(page, page.getByRole('button', { name: 'Open navigation' }));
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();

  const drawerTargets = await visibleTargets(drawer);
  expect(drawerTargets.length, 'the drawer sweep found nothing to measure').toBeGreaterThanOrEqual(
    6,
  );
  expect(
    tooSmall(drawerTargets),
    `undersized controls in the navigation drawer (of ${drawerTargets.length} measured)`,
  ).toEqual([]);

  // And the task panel, which below `md` is a fullscreen sheet and is where the second half of
  // "complete the board flow" happens — a board you can navigate but not edit is not a flow.
  // It is also the densest surface in the app: two `<select>`s, three checkbox lists, a
  // comment box and a destructive action.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await tap(page, page.getByRole('link', { name: /Alpha card/ }).first());
  const panel = page.getByRole('complementary').last();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Delete task' })).toBeVisible();

  const panelTargets = await visibleTargets(panel);
  expect(panelTargets.length, 'the panel sweep found nothing to measure').toBeGreaterThanOrEqual(
    10,
  );
  expect(
    tooSmall(panelTargets),
    `undersized controls in the task panel (of ${panelTargets.length} measured)`,
  ).toEqual([]);
});

test('the board scrolls its columns, not the page — and a card can be dragged with a finger', async ({
  stack,
  openAs,
}) => {
  // 25 cards: more than fills a 740px column, and inside the 40-card render budget so every
  // one of them is mounted and the column's scroll height is the real one.
  const titles = Array.from(
    { length: 25 },
    (_, index) => `Card ${String(index + 1).padStart(2, '0')}`,
  );
  const { boardPath, columnNames, owner } = await boardWith(stack, titles);
  const page = await openAs(owner, PHONE);

  await page.goto(boardPath);
  await waitForBoardReady(page);

  const todo = column(page, columnNames[0]!);
  await expect(cardHandle(todo, 'Card 01')).toBeVisible();

  /**
   * Issue #184, measured.
   *
   * Before the height-chain fix the shell was `min-h-screen` — a floor with no ceiling — so
   * nothing below it was bounded, the column's `overflow-y-auto` never clipped, and the
   * *document* grew instead (27 425px on a 1 000-task board). Twenty-five cards is enough for
   * that to show at 740px: the page would be roughly twice the viewport.
   */
  const scroll = await page.evaluate(() => ({
    documentScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(
    scroll.documentScrollHeight,
    'the document must not grow past the viewport — the column is what scrolls',
  ).toBeLessThanOrEqual(scroll.innerHeight + 1);

  // The column's card list is the scroller, and it really does have somewhere to go.
  const list = columnScroller(todo);
  const listMetrics = await list.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  expect(
    listMetrics.scrollHeight,
    'twenty-five cards should overflow the column at 740px',
  ).toBeGreaterThan(listMetrics.clientHeight);

  // The column header is `sticky` to that scroller. It was sticky before this change too, and
  // it meant nothing: the box it was stuck to never moved.
  const header = todo.getByRole('heading', { name: columnNames[0]! });
  const headerBefore = await header.boundingBox();
  await list.evaluate((node) => node.scrollTo(0, 240));
  await expect
    .poll(async () => list.evaluate((node) => node.scrollTop), {
      message: 'the column should have scrolled',
    })
    .toBeGreaterThan(0);
  const headerAfter = await header.boundingBox();
  // 2px, not exact equality. The header does move, by a repeatable ~0.6px: at
  // `deviceScaleFactor: 3` the sticky box is snapped to a device pixel and the scrolled
  // content underneath changes which third of a CSS pixel it lands on. The claim being made
  // is "it did not travel with the 240px of scroll", and a tolerance that cannot tell 0.6
  // from 240 is not a weaker claim — a tolerance tight enough to fail on 0.6 is just a
  // flake, which this suite runs with `retries: 0` specifically to refuse.
  expect(
    Math.abs(headerAfter!.y - headerBefore!.y),
    'the column header should stay put while its cards scroll',
  ).toBeLessThan(2);
  // And the page still did not move.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await list.evaluate((node) => node.scrollTo(0, 0));

  /**
   * The drag, with a finger.
   *
   * This is the constraint that was most at risk: a column that scrolls on touch and a
   * `PointerSensor` want the same gesture. The division is `touch-action` — the card body
   * belongs to the scroller, the grip declares `touch-action: none` and belongs to dnd-kit —
   * and both halves are asserted below, because only asserting the drag would let a build ship
   * where the column could no longer be scrolled at all.
   */
  const moved = ['Card 03', 'Card 01', 'Card 02', ...titles.slice(3)];
  await touchDragCardOnto(page, 'Card 03', 'Card 01');
  await expectCardOrder(todo, moved, 'a touch drag by the grip should reorder the column');

  // Persisted, not just optimistic — same reasoning as scenario 1.
  await page.reload();
  await waitForBoardReady(page);
  await expectCardOrder(
    column(page, columnNames[0]!),
    moved,
    'the touch-driven move must survive a reload',
  );

  // The other half: a finger dragged up the card *body* scrolls the column and moves nothing.
  // That is the deliberate behaviour, and it is what makes the board readable on a phone.
  const listAfter = columnScroller(column(page, columnNames[0]!));
  const body = await centreOf(page.getByRole('link', { name: /Card 05/ }).first());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [body] });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: body.x, y: body.y - step * 20 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();

  await expect
    .poll(async () => listAfter.evaluate((node) => node.scrollTop), {
      message: 'dragging the card body with a finger should scroll the column',
    })
    .toBeGreaterThan(0);
  await expectCardOrder(
    column(page, columnNames[0]!),
    moved,
    'scrolling with a finger must not reorder anything',
  );
});
