import { expect, test } from '../support/fixtures';

/**
 * Scenario 4 — click a notification, land on the task it is about.
 *
 * This one exists because of a gap that is invisible from the API side: a notification row
 * carries `taskId` but **not** `boardId`, and the board is in the URL. The web app closes the
 * gap by fetching the task and reading `boardId` off it
 * (`apps/web/lib/notification-nav.ts`), which means "clicking a notification opens the right
 * task" depends on a second request succeeding, in the browser, with the recipient's session.
 * No API test can observe that, and no unit test can observe the navigation it produces.
 *
 * The assertion is deliberately on both halves: the URL, and the task panel's own heading.
 * A URL alone would pass if the route rendered an error; the heading alone would pass if the
 * panel opened the wrong task with the same title.
 */
test('clicking a notification opens the task it refers to', async ({ stack, openAs }) => {
  const owner = await stack.createUser();
  const assignee = await stack.createUser({ confirmEmail: true });

  const workspace = await stack.createWorkspace(owner);
  await stack.addMember(owner, workspace.id, assignee);

  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const [assignedTask] = await stack.createTasks(owner, workspace.id, board.id, columns[0]!.id, [
    'Card that needs an owner',
  ]);

  // Assigning someone else's task to them is what the API turns into an `assignment`
  // notification; assigning it to yourself deliberately produces nothing.
  await stack.assign(owner, workspace.id, assignedTask!.id, assignee.id);

  const page = await openAs(assignee);
  await page.goto('/dashboard');

  const bell = page.getByRole('button', { name: 'Notifications' });
  await expect(bell, 'the bell should show the unread notification').toContainText('1');
  await bell.click();

  const notification = page.getByRole('menuitem', {
    name: /Assigned to .Card that needs an owner./,
  });
  await expect(notification).toBeVisible();
  await notification.click();

  await expect(page).toHaveURL(`/board/${board.id}/task/${assignedTask!.id}`);

  const panel = page.getByRole('complementary', { name: 'Task details' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Card that needs an owner' })).toBeVisible();
});
