import { expect, test } from '../support/fixtures';
import {
  cardOrder,
  column,
  dragCardOnto,
  expectCardOrder,
  waitForBoardReady,
} from '../support/board-page';

/**
 * Scenario 1 — sign in, open a board, drag a card, and find it still moved after a reload.
 *
 * This is the one flow the product is *for*, and until this file existed it had no
 * verification in a browser at all. The unit suite exercises `useBoardTaskDnd`'s pure move
 * arithmetic against a fabricated event; the integration suite exercises
 * `PATCH /tasks/:id/position` against a real database. Neither can tell you whether a person
 * dragging a card in Chrome produces that event, or whether the resulting request is the one
 * the board then reloads from.
 *
 * The reload is the assertion that matters. The board applies a move optimistically, so the
 * order changes on screen the instant the pointer lifts whether or not anything was
 * persisted — an assertion made before the reload would stay green with the PATCH deleted.
 */
test('a dragged card keeps its new order after a reload', async ({ stack, page }) => {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const todo = columns[0]!;

  // Three cards, created in order. The one that moves is the last, so the assertion is about
  // an order that could not have arisen by accident from creation order.
  await stack.createTasks(owner, workspace.id, board.id, todo.id, [
    'Alpha card',
    'Bravo card',
    'Charlie card',
  ]);

  // Signing in through the form, not through a cookie: this scenario is the suite's only
  // coverage of the login page and of the middleware's deep-link round trip, so it takes the
  // long way in — request a protected URL while signed out, get bounced to `/login?next=…`,
  // and expect to land back on the board that was asked for.
  await page.goto(`/board/${board.id}`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fboard%2F${board.id}$`));
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(`/board/${board.id}`);
  await waitForBoardReady(page);

  const todoColumn = column(page, todo.name);
  await expectCardOrder(
    todoColumn,
    ['Alpha card', 'Bravo card', 'Charlie card'],
    'the board should paint the three cards in the order they were created',
  );

  // Dropping the last card onto the first inserts it above — `applyMove` in
  // `use-board-task-dnd.ts` places the dragged card before the card it was released over
  // whenever it is travelling upwards.
  await dragCardOnto(page, 'Charlie card', 'Alpha card');

  await expectCardOrder(
    todoColumn,
    ['Charlie card', 'Alpha card', 'Bravo card'],
    'the drop should reorder the column on screen',
  );

  // The real test. A reload throws away every scrap of client state and rebuilds the board
  // from `GET /boards/:id/tasks`, so what is on screen afterwards is what the server stored.
  //
  // Deliberately no assertion on `Task.position` itself: it is a Float produced by fractional
  // indexing, and its value is an implementation detail that rebalancing is allowed to change
  // at any time. The order is the contract.
  await page.reload();
  await waitForBoardReady(page);

  await expectCardOrder(
    column(page, todo.name),
    ['Charlie card', 'Alpha card', 'Bravo card'],
    'the new order must survive a reload — this is what fails when the move is not persisted',
  );

  // And nothing leaked sideways: the neighbouring column is still empty.
  //
  // Asserted on a column that is *proved to be on screen* first. An empty result from
  // `cardOrder` cannot distinguish "this column holds no cards" from "this column never
  // rendered", so without the visibility check the emptiness assertion would also pass on a
  // board that failed to paint at all.
  const inProgress = column(page, columns[1]!.name);
  await expect(inProgress).toBeVisible();
  expect(await cardOrder(inProgress)).toEqual([]);
});
