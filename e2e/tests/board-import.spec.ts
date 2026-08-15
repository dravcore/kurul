import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoardDto } from '@kurultay/shared-types';
import { repoRoot } from '../load-env.mjs';
import { column, expectCardOrder } from '../support/board-page';
import { expect, test } from '../support/fixtures';

/**
 * Scenario 6 — importing a Trello export, in a browser.
 *
 * The API suite already proves the endpoint (`apps/api/test/trello-import.e2e-spec.ts`: tenant
 * scope, the admin role, the size limit, a malformed body, two imports making two boards) and the
 * unit suites already prove the mapping (`import/trello-import-planner.spec.ts`) and the panel's
 * rendering (`components/board/import-report-panel.test.tsx`). None of them can fail on the three
 * things below, which is why this file exists:
 *
 *  1. **A real `<input type="file">` carrying a JSON export.** The dialog builds its own
 *     `FormData` and hands it to `api.postForm`, which relies on the browser to write the
 *     multipart boundary — a header the API suite composes itself and therefore cannot disagree
 *     with. If the field name, the `Content-Type` or the boundary were wrong, every in-process
 *     suite would still be green.
 *  2. **The report reaching the screen.** The roadmap metric is worded "the partial-failure report
 *     is shown to the user" (`audit/ROADMAP.md`), and an API that answers a correct report to a
 *     browser that renders nothing is exactly the failure that wording exists to prevent. The
 *     report only ever exists in the body of the `201` — there is no `ImportRun` table and no
 *     status endpoint (ADR 0025) — so a panel that dropped it drops the only copy.
 *  3. **The board the report is about.** The panel is handed an object by the API and renders it;
 *     on its own it would say "4 tasks" just as happily if nothing had been written. So the
 *     numbers are checked against the board itself: the run ends on the board page, counting the
 *     cards the server actually returns.
 *
 * Every positive assertion is paired with something that would fail if the import were absent:
 * the board list's empty state is asserted *before* the import, the report region is asserted
 * hidden before it is asserted visible, and the skipped groups are asserted by their real counts
 * rather than by "some group appeared".
 *
 * ## The fixture is the API suite's fixture, on purpose
 *
 * `apps/api/test/fixtures/trello/synthetic-full-board.json` is read here rather than re-invented,
 * so the numbers this scenario asserts are the same numbers `trello-import-planner.spec.ts` pins
 * unit-side. A copy would let the two drift, and the browser's copy would be the one nobody
 * remembers to update. It is *synthetic* — ADR 0025 records that no real Trello export was
 * available, so nothing here is evidence about Trello's real schema, only about this stack.
 *
 * The plan's sketch for this scenario asserted `/\d+ cards?/`. That is wrong and was measured to
 * be wrong: the panel counts what it *wrote* in Kurultay's vocabulary — "4 tasks" — and reserves
 * "cards" for the Trello cards that did not come across. A `cards` regex would pass on the
 * skipped-group sentence while the imported count silently rendered nothing.
 */

/**
 * Four lists (one archived), six cards (one archived, one unnamed), five labels, three checklists,
 * three attachments (one with a `file:` URL), two comments and two members. Everything this
 * scenario asserts is a consequence of that shape; see the fixture's own README.
 */
const FIXTURE_PATH = join(
  repoRoot,
  'apps',
  'api',
  'test',
  'fixtures',
  'trello',
  'synthetic-full-board.json',
);

/** The board name inside the fixture. */
const BOARD_NAME = 'Product Roadmap';

test('a Trello export imported in a browser writes a board and shows what did not come across', async ({
  stack,
  openAs,
}) => {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const exportBytes = await readFile(FIXTURE_PATH);

  const page = await openAs(owner);
  await page.goto('/dashboard');

  // "No boards yet" is the list's own word for a *loaded* and empty roster. Waiting for it rather
  // than for the import button is what stops "the imported board appears" from being a sentence
  // that was already true before the import ran.
  await expect(page.getByRole('heading', { name: 'No boards yet' })).toBeVisible();

  const report = page.getByRole('region', { name: 'Import report' });
  await expect(report).toBeHidden();

  await page.getByRole('button', { name: 'Import from Trello' }).click();
  await page.getByLabel('Trello board export (.json)').setInputFiles({
    name: 'synthetic-full-board.json',
    mimeType: 'application/json',
    buffer: exportBytes,
  });
  await page.getByRole('button', { name: 'Import board' }).click();

  await expect(report).toBeVisible();

  // The counts the user can act on. Three lists came across as columns — the fourth was archived
  // — and four of the six cards became tasks.
  //
  // `getByText(…, { exact: true })` rather than `toContainText` on the whole region, because the
  // region also contains the sentence "3 columns came across changed…". A substring match would
  // be satisfied by that sentence alone, so the written-count line could render nothing at all and
  // this assertion would still be green.
  await expect(report.getByText('3 columns', { exact: true })).toBeVisible();
  await expect(report.getByText('4 tasks', { exact: true })).toBeVisible();

  // At least one skipped group, by its real number and its real reason. Both of these carry
  // samples, so the panel renders them as a `<details>` whose `<summary>` is the sentence.
  await expect(
    report.getByText(/^1 list was not imported: it was archived in Trello/),
  ).toBeVisible();
  await expect(
    report.getByText(/^1 card was not imported: it was archived in Trello/),
  ).toBeVisible();

  // `count` and `samples.length` are different numbers, and this group is where the difference is
  // visible in a browser: the API sends `count: 2` with *no* samples, because a comment has no
  // name worth quoting. A panel that headlined `samples.length` would render "0 comments" here —
  // which is why the negative assertion is spelled out rather than left implied.
  await expect(report.getByText(/^2 comments were not imported/)).toBeVisible();
  await expect(report.getByText(/\b0 comments\b/)).toHaveCount(0);

  // The board list refetched and the new board is in it. This cannot pass on a failed import: the
  // list comes from `GET /workspaces/:id/boards`, not from anything the dialog put in state.
  await expect(page.getByRole('link', { name: BOARD_NAME })).toBeVisible();

  // A second opinion over HTTP, with the owner's own session: exactly one board exists, and it is
  // the imported one. The DOM assertion above and this one would only agree by accident if the
  // import had not written anything.
  const listed = (await (
    await owner.api.get(`/workspaces/${workspace.id}/boards`)
  ).json()) as BoardDto[];
  expect(listed.map((board) => board.name)).toEqual([BOARD_NAME]);

  // `Button asChild` around a `next/link`, so this is an `<a role="link">` and not a button.
  await report.getByRole('link', { name: 'Go to board' }).click();

  // The report's `boardId` is a real board and not a fabricated id — the link landed on the row
  // the API just listed.
  await expect(page).toHaveURL(`/board/${listed[0]!.id}`);

  // `waitForBoardReady` is not usable here: it waits for the seeded "To Do" column, and an
  // imported board has the export's own columns. The two halves of it are, though — a column has
  // painted, and the socket has joined the board room, so no resync can land mid-assertion.
  await expect(column(page, 'Backlog')).toBeVisible();
  await expect(page.getByText('Reconnecting…')).toBeHidden();

  // The report said "4 tasks"; here are the four, in the columns and the order the export implies.
  // `pos` is read for order and re-issued as a value (ADR 0025), and the fixture writes `Import
  // boards from Trello` at 16384 *after* the card at 65535 — so a board that carried the file's
  // array order instead would fail here and only here.
  await expectCardOrder(
    column(page, 'Backlog'),
    ['Import boards from Trello', 'Board drag and drop jumps on Safari'],
    'Backlog should hold both live cards in Trello `pos` order',
  );
  await expectCardOrder(
    column(page, 'In Progress'),
    ['Column category settings dialog'],
    'the unnamed card in this list should have been skipped, not imported blank',
  );
  await expectCardOrder(
    column(page, 'Shipped'),
    ['Checklists on cards'],
    'Shipped should hold its single card',
  );

  // The archived list is the other half of the "1 list was not imported" sentence: reported, and
  // genuinely absent from the board.
  await expect(column(page, 'Old Sprint')).toHaveCount(0);
});
