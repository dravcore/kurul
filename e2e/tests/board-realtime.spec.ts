import { expect, test } from '../support/fixtures';
import {
  column,
  dragCardOnto,
  expectCardOrder,
  waitForBoardReady,
  watchSocketHandshake,
} from '../support/board-page';

/**
 * Scenario 2 — one person moves a card, a second browser sees it move.
 *
 * Two real browser contexts, not two tabs and not the same session twice: the whole path has
 * to hold. Socket.io authenticates from the handshake cookie, so a second context proves the
 * gateway resolves a *different* user's session; `board:join` is membership-checked, so the
 * observer proves an invited member is actually admitted to the room; and the move arrives as
 * ids only, which the observer's client applies to its local board state.
 *
 * There is no reload anywhere in this test, and that is the point. The observer never asks
 * the server for anything after the initial load — if the card moves on their screen, it
 * moved because a socket frame said so.
 */
test('a move made in one browser appears in another without a reload', async ({
  stack,
  openAs,
}) => {
  // The observer's address has to be confirmed before they can accept an invitation, so this
  // account takes the full sign-up → verification mail → link route.
  const owner = await stack.createUser();
  const observer = await stack.createUser({ confirmEmail: true });

  const workspace = await stack.createWorkspace(owner);
  await stack.addMember(owner, workspace.id, observer);

  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const todo = columns[0]!;
  const inProgress = columns[1]!;

  await stack.createTasks(owner, workspace.id, board.id, todo.id, ['Travelling card']);
  await stack.createTasks(owner, workspace.id, board.id, inProgress.id, ['Resident card']);

  const ownerPage = await openAs(owner);
  const observerPage = await openAs(observer);

  // Installed before the navigation that opens the sockets — see `watchSocketHandshake`.
  const ownerHandshake = watchSocketHandshake(ownerPage);
  const observerHandshake = watchSocketHandshake(observerPage);

  await Promise.all([
    ownerPage.goto(`/board/${board.id}`),
    observerPage.goto(`/board/${board.id}`),
  ]);
  // Both sides must have *joined the room*, not merely rendered: `Reconnecting…` is shown
  // until `board:join` acks `ok`, and a move emitted before the observer joins is a frame
  // nobody was listening for. Waiting on the application's own indicator is what removes the
  // need for a sleep here.
  await Promise.all([waitForBoardReady(ownerPage), waitForBoardReady(observerPage)]);

  await expectCardOrder(
    column(observerPage, inProgress.name),
    ['Resident card'],
    'the observer should start with one card in the target column',
  );

  await dragCardOnto(ownerPage, 'Travelling card', 'Resident card');

  await expectCardOrder(
    column(ownerPage, inProgress.name),
    ['Travelling card', 'Resident card'],
    'the mover should see the card land in the target column',
  );

  // The assertion this test exists for.
  await expectCardOrder(
    column(observerPage, inProgress.name),
    ['Travelling card', 'Resident card'],
    'the observer must see the move arrive over the socket, with no reload',
  );
  await expectCardOrder(
    column(observerPage, todo.name),
    [],
    'and must see the card leave the column it came from',
  );

  // The observer's tab never navigated: if it had, this would be a test of `GET /tasks`
  // wearing a realtime costume.
  expect(observerPage.url()).toBe(`${new URL(observerPage.url()).origin}/board/${board.id}`);

  // The handshake itself, asserted off the wire rather than through the indicator above.
  // Both of these used to hold only by luck, and lost that luck on a loaded CI runner.
  for (const [who, read] of [
    ['owner', ownerHandshake],
    ['observer', observerHandshake],
  ] as const) {
    const { connectPacketsPerConnection, deniedJoins } = read();
    expect(
      connectPacketsPerConnection.length,
      `${who} should have opened a socket`,
    ).toBeGreaterThan(0);
    expect(
      connectPacketsPerConnection,
      `${who} must send exactly one namespace CONNECT per connection — a duplicate makes Socket.io close the client`,
    ).toEqual(connectPacketsPerConnection.map(() => 1));
    expect(deniedJoins, `${who} must not be denied a room it is a member of`).toEqual([]);
  }
});
