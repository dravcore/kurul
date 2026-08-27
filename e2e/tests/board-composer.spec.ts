import { expect, test } from '../support/fixtures';
import {
  addTaskButton,
  column,
  expectCardOrder,
  taskComposer,
  waitForBoardReady,
} from '../support/board-page';

/**
 * Scenario 8: creating a task, both ways, in a real browser.
 *
 * ADR 0035 removed the create dialog: the inline composer at the foot of a column is now the
 * only way a task comes into being, so a regression there is total rather than degraded, and
 * the ADR's own Consequences section says both paths are covered here.
 *
 * What only a browser can answer is where the caret is. The composer's contract is a sequence
 * of focus moves (Enter creates and *leaves* focus in an emptied field so the next title can be
 * typed straight away, Escape hands focus back to the button the composer replaced), and jsdom
 * cannot disagree with Chromium about any of it: it has no default `Enter` submission, it
 * runs no browser focus policy of its own, and `Open details` is a client navigation whose
 * effect (a panel rendered from a route) is a page, not a component. The component suite in
 * `apps/web/components/board/board-column.test.tsx` dispatches those keys directly at the
 * element it expects to handle them, which is the assumption a browser is here to check.
 *
 * Every scenario in this suite also carries the CSP check automatically: the `cspViolations`
 * fixture in `support/fixtures.ts` is `auto`, so a policy violation on either of these pages
 * fails the test without a line here asking for it.
 */

test('two tasks are created from the keyboard without the hands leaving it', async ({
  stack,
  openAs,
}) => {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const todo = columns[0]!;

  const page = await openAs(owner);
  await page.goto(`/board/${board.id}`);
  await waitForBoardReady(page);

  const todoColumn = column(page, todo.name);
  const addTask = addTaskButton(todoColumn);

  // `focus()` stands in for the Tab presses that reach this button, and Enter is then a real key
  // press through the browser's own activation behaviour rather than a synthesised click: what
  // opens the composer here is what opens it for a person on the keyboard.
  await addTask.focus();
  await expect(addTask).toBeFocused();
  await page.keyboard.press('Enter');

  const field = taskComposer(todoColumn).getByRole('textbox', { name: 'Task title', exact: true });
  await expect(field).toBeFocused();

  await page.keyboard.type('First from the keyboard');
  await page.keyboard.press('Enter');
  // The emptied field is the signal the create landed *and* that the composer stayed open, so
  // the second title can be typed into it without touching anything.
  await expect(field).toHaveValue('');

  await page.keyboard.type('Second from the keyboard');
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('');

  await expectCardOrder(
    todoColumn,
    ['First from the keyboard', 'Second from the keyboard'],
    'both titles should have become cards, in the order they were typed',
  );

  // The whole reason the composer stays open: `document.activeElement` is still the field after
  // two creates, which is what makes a run of them one gesture instead of two round trips.
  await expect(field).toBeFocused();

  await page.keyboard.press('Escape');
  // `toHaveCount(0)` rather than `toBeHidden()`: the composer is unmounted, and `toBeHidden`
  // passes instantly on a locator that matches nothing, which would also pass on a board that
  // never rendered a composer at all.
  await expect(taskComposer(todoColumn)).toHaveCount(0);
  await expect(addTask).toBeFocused();

  // And the two cards were persisted, not merely painted: a reload rebuilds the board from
  // `GET /boards/:id/tasks`, so what survives it is what the server stored.
  await page.reload();
  await waitForBoardReady(page);
  await expectCardOrder(
    column(page, todo.name),
    ['First from the keyboard', 'Second from the keyboard'],
    'both created cards must survive a reload',
  );
});

test('a task created from Open details opens its panel and stays on the board', async ({
  stack,
  openAs,
}) => {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const todo = columns[0]!;

  const page = await openAs(owner);
  await page.goto(`/board/${board.id}`);
  await waitForBoardReady(page);

  const todoColumn = column(page, todo.name);
  await addTaskButton(todoColumn).click();

  const composer = taskComposer(todoColumn);
  await composer.getByRole('textbox', { name: 'Task title', exact: true }).fill('Needs a due date');
  await composer.getByRole('button', { name: 'Open details', exact: true }).click();

  // One gesture, two outcomes: the task is created and its panel is open on it. The URL is the
  // half a component test cannot have, since the panel is a route rather than a rendered branch.
  await expect(page).toHaveURL(/\/task\//);
  const panel = page.getByRole('complementary', { name: 'Task details', exact: true });
  await expect(panel.getByRole('heading', { name: 'Needs a due date' })).toBeVisible();

  // Back to the board by URL rather than by closing the panel: this asserts what the server
  // stored, which a panel that is already on screen cannot.
  await page.goto(`/board/${board.id}`);
  await waitForBoardReady(page);
  await expectCardOrder(
    column(page, todo.name),
    ['Needs a due date'],
    'the task created from Open details must be on the board after a reload',
  );
});
