import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { column, waitForBoardReady } from '../support/board-page';
import { expect, test } from '../support/fixtures';

/**
 * Scenario 5 — attaching a file to a card, in a browser.
 *
 * The API suite already proves the endpoints (`apps/api/test/attachment.e2e-spec.ts`: tenant
 * scope, the size limit, the MIME allowlist, traversal, orphan sweep, origin check) and the
 * Vitest suite already proves the components render what they are handed. Neither of them can
 * fail on the four things below, which is the whole reason this file exists:
 *
 *  1. **A real `<input type="file">` and a real multipart body.** jsdom does not produce one and
 *     the API suite writes its own by hand; only a browser exercises the boundary the browser
 *     actually builds.
 *  2. **A non-ASCII filename surviving the round trip.** The UTF-8 fix landed in the API suite
 *     (#216) against a body that suite composed itself. Whether *Chromium's* multipart encoding
 *     and busboy's decoding agree had never been checked anywhere, and neither had whether the
 *     name comes back out of `Content-Disposition`'s RFC 5987 parameter intact.
 *  3. **The bytes.** A row that renders is not a file that downloads: the download is taken and
 *     compared byte for byte against what was uploaded.
 *  4. **The card badge.** `TaskDto.attachmentCount` is filled by a Prisma `_count` on the
 *     *board list* query — a different query from the one the panel uses — so the badge is the
 *     only thing that can falsify it, and only after a reload.
 *
 * Every positive assertion here is paired with something that would fail if the feature were
 * absent: the empty state is asserted *before* the upload, the badge is asserted absent before
 * it is asserted present, and the deletion is confirmed against the server rather than against
 * the list the panel is holding in memory. A scenario that would pass with the feature ripped
 * out is the failure mode this phase has hit most often.
 */

/**
 * A file whose name only survives if the whole path is UTF-8 clean — and whose extension is
 * *not* the thing that makes it acceptable.
 *
 * `application/pdf` rather than the PNG the plan's sketch used, for a mechanical reason worth
 * writing down: the API serves images `inline` (ADR 0024 K4), and Chromium ignores an
 * `<a download>` whose href is cross-origin — which the API is here, on port 4110 against the
 * web app's 3110. An inline image would therefore *navigate* instead of downloading and
 * `waitForEvent('download')` would hang until the test timeout. A PDF is served
 * `Content-Disposition: attachment`, so the browser downloads it whatever the anchor says, and
 * `suggestedFilename()` then reads back the server's own RFC 5987 parameter.
 */
const FILE_NAME = 'ölçüm raporu.pdf';

/**
 * `%PDF-` is all `file-type` needs (`attachment-mime.ts`), so a valid sample is a signature plus
 * padding. The padding is random rather than zeroes so the byte comparison after the download
 * can only pass on the real content — a buffer of zeroes would also match a truncated or
 * re-created file of the same length.
 */
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(4096)]);

/** A 1×1 PNG. Small enough to be a literal, real enough for the sniffer and for `<img>`. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('a file attached to a card round-trips: listed, counted, downloadable, deletable', async ({
  stack,
  openAs,
}) => {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const todo = columns[0]!;
  const task = (await stack.createTasks(owner, workspace.id, board.id, todo.id, ['Alpha']))[0]!;

  const page = await openAs(owner);
  await page.goto(`/board/${board.id}`);
  await waitForBoardReady(page);

  // The card is an `<a>` whose accessible name is "Open task" plus the priority, the title and
  // every badge in the meta row — which is what makes the name the place to assert the count.
  const card = column(page, todo.name).getByRole('link', { name: /Open task .*Alpha/ });
  await expect(card).toBeVisible();
  // Before anything is attached the badge renders zero nodes (`attachment-badge.tsx` returns
  // null on 0). Asserting that first is what stops the assertion further down from being a
  // sentence that was always true.
  await expect(card).not.toHaveAccessibleName(/attachment/);

  await card.click();

  const attachments = page.getByRole('region', { name: 'Attachments' });
  // "Nothing attached yet" is the panel's own word for an empty, *loaded* list. Waiting for it
  // rather than for the section proves the read finished and returned nothing — without it,
  // "the file appears" could be satisfied by a section that simply had not rendered yet.
  await expect(attachments.getByText('Nothing attached yet')).toBeVisible();

  await page
    .getByLabel('Attach a file')
    .setInputFiles({ name: FILE_NAME, mimeType: 'application/pdf', buffer: PDF_BYTES });

  const fileLink = attachments.getByRole('link', { name: `Download ${FILE_NAME}` });
  await expect(fileLink).toBeVisible();
  // The accessible name above comes from an `aria-label`; this is the text a sighted user sees.
  // Both are the filename the server sent back, and both have to be the *same* filename.
  await expect(fileLink).toHaveText(FILE_NAME);
  // The named failure, not just the absence of success: a UTF-8 body decoded as latin-1 renders
  // `ölçüm` as `Ã¶lÃ§Ã¼m`, so a stray `Ã` anywhere in the section is that bug and nothing else.
  await expect(attachments.getByText(/Ã/)).toHaveCount(0);
  await expect(attachments.getByText('Nothing attached yet')).toBeHidden();

  // A second attachment, an image, for the one path that only exists in a browser: the preview
  // fetches the bytes through `lib/api.ts` and renders them from a `blob:` URL, which is how the
  // panel works around a cross-origin API and a CSP whose `img-src` names no host. If the
  // request or the object URL were broken, no `<img>` would ever appear.
  await page
    .getByLabel('Attach a file')
    .setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG_BYTES });
  await expect(attachments.getByRole('img', { name: 'shot.png' })).toBeVisible();

  // The board's half of the feature, and the half only a reload can falsify: the count comes
  // from the list query's `_count`, not from anything the panel put in the client's cache.
  await page.goto(`/board/${board.id}`);
  await waitForBoardReady(page);
  await expect(card).toHaveAccessibleName(/2 attachments/);

  await card.click();
  await expect(fileLink).toBeVisible();

  // And the bytes really come back. `suggestedFilename()` is the server's `Content-Disposition`
  // — the RFC 5987 parameter — because a cross-origin href makes Chromium ignore the anchor's
  // own `download` attribute; this assertion is therefore about the API's header, not the DOM's.
  const [download] = await Promise.all([page.waitForEvent('download'), fileLink.click()]);
  expect(download.suggestedFilename()).toBe(FILE_NAME);
  const downloadedPath = await download.path();
  expect(await readFile(downloadedPath)).toEqual(PDF_BYTES);

  await attachments.getByRole('button', { name: `Delete attachment ${FILE_NAME}` }).click();
  await expect(fileLink).toBeHidden();

  // The panel dropping a row from its own state would satisfy the assertion above on its own.
  // This one asks the server, over HTTP, with the user's session.
  await expect
    .poll(
      async () =>
        (await stack.listAttachments(owner, workspace.id, task.id)).map((row) => row.filename),
      { message: 'the deleted attachment should be gone from the API too' },
    )
    .toEqual(['shot.png']);

  await page.goto(`/board/${board.id}`);
  await waitForBoardReady(page);
  await expect(card).toHaveAccessibleName(/1 attachment\b/);
});
