import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '../support/fixtures';
import { waitForBoardReady } from '../support/board-page';
import { API_URL, WEB_URL } from '../stack-env';
import { machine, median, ms, p95, report, sorted } from './stats';

/**
 * The ROADMAP metric: *"attaching a 10 MB file takes ≤3s"*.
 *
 * The phase plan (§4.1b) is explicit that the claim is worthless without the machine and the
 * method, and that an unmeasurable number is not to be claimed at all. So this file measures,
 * prints, and asserts nothing about the duration. What it *does* assert is that every run
 * really was an accepted upload — a rig that times a 413 and reports 40ms is the failure mode
 * this whole exercise exists to avoid.
 *
 * ## Two numbers, because "attaching a file" is two different things
 *
 * **Transport** — the POST alone, from the first byte leaving this process to the last byte of
 * the `201` arriving. This is the plan's definition and the `curl` loop it sketched, rewritten
 * in Node so it can reuse the suite's session instead of a hand-managed cookie jar. Split the
 * way `curl` splits it: time-to-headers (the server has parsed, sniffed and written) and
 * time-to-complete (the JSON body is in).
 *
 * **User-visible** — a real `<input type="file">` in a real browser, from the file being chosen
 * to the row appearing in the panel. This is what the ROADMAP's sentence actually promises a
 * person, and it is strictly larger: it contains the transport number plus the browser's own
 * multipart assembly, the panel's re-render, and the refetch that follows.
 *
 * ## What is deliberately NOT in either number
 *
 *  - **The reverse proxy.** These run against the suite's stack — a bare `node dist/main.js` on
 *    localhost — not against the shipped Compose stack behind Caddy. Caddy buffers the request
 *    body and enforces `request_body { max_size 25MiB }`, and neither of those costs appears
 *    here. A deployment measurement has to be taken on the deployment.
 *  - **The network.** Loopback only: no RTT, no bandwidth ceiling, no packet loss. On a WAN
 *    link a 10 MB body is bounded by upstream bandwidth long before it is bounded by anything
 *    in this repository, and no amount of server work will show up next to that.
 *  - **Containers.** No cgroup CPU limit, no overlay filesystem, no Docker volume — the bytes
 *    land on the host's SSD through the host's page cache.
 *  - **A cold anything.** The server is warm, the JIT is warm, the page cache is warm. The
 *    first upload after a boot is not represented.
 *
 * ## The fixture
 *
 * `%PDF-1.4\n` plus random padding to exactly 10,485,760 bytes — `file-type` recognises a PDF
 * from that signature alone, so no image library is needed to produce a file the allowlist
 * accepts. The padding is random on purpose: zeroes compress, and a compressible body would
 * flatter every buffering layer between here and the disk.
 */

const TEN_MB = 10 * 1024 * 1024;
const RUNS = 10;

/** Built once. A `Blob` can be read repeatedly, so every run posts the identical bytes. */
function tenMegabytePdf(): Buffer {
  const header = Buffer.from('%PDF-1.4\n');
  return Buffer.concat([header, randomBytes(TEN_MB - header.length)]);
}

/**
 * The same bytes as an `ArrayBuffer`, which is what `File` accepts.
 *
 * `Buffer` is a `Uint8Array` over an `ArrayBufferLike`, and `BlobPart` insists on a plain
 * `ArrayBuffer` — this copies once, before the clock starts, rather than casting the type
 * away.
 */
function asArrayBuffer(bytes: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

test('10 MB upload: transport latency', async ({ stack }) => {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const task = (
    await stack.createTasks(owner, workspace.id, board.id, columns[0]!.id, ['Load'])
  )[0]!;

  const bytes = asArrayBuffer(tenMegabytePdf());
  expect(bytes.byteLength, 'the fixture must be exactly 10 MB').toBe(TEN_MB);

  // The suite's own session, lifted out of the API context that created the user. Everything
  // else about the request is what a browser would send, including the `Origin` header the
  // API's origin check requires on a multipart POST.
  const state = await owner.api.storageState();
  const cookie = state.cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
  const url = `${API_URL}/workspaces/${workspace.id}/tasks/${task.id}/attachments`;

  const toHeaders: number[] = [];
  const toComplete: number[] = [];

  for (let run = 0; run < RUNS; run++) {
    const form = new FormData();
    form.set('kind', 'FILE');
    // A fresh `File` per run, over the same buffer: `FormData` holds a reference, and reusing
    // one instance across runs would leave the second run measuring a consumed body.
    form.set('file', new File([bytes], 'measure-10mb.pdf', { type: 'application/pdf' }));

    const started = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { cookie, origin: WEB_URL },
      body: form,
    });
    const headersAt = performance.now();
    const body = await response.text();
    const completedAt = performance.now();

    // The assertion that keeps the numbers meaning what they say.
    expect(response.status, `run ${run + 1} was not accepted: ${body}`).toBe(201);

    toHeaders.push(headersAt - started);
    toComplete.push(completedAt - started);
  }

  report(`10 MB upload — transport (${RUNS} runs)`, [
    `machine     ${machine()}`,
    `stack       e2e stack: node ${API_URL} (no proxy, no container), loopback`,
    `file        ${TEN_MB} bytes, sniffed application/pdf, fixture = "%PDF-1.4\\n" + random padding`,
    `to-headers  median ${ms(median(toHeaders))} · p95 ${ms(p95(toHeaders))}`,
    `to-complete median ${ms(median(toComplete))} · p95 ${ms(p95(toComplete))}`,
    `raw (ms)    ${sorted(toComplete)
      .map((value) => value.toFixed(1))
      .join(' ')}`,
  ]);
});

test('10 MB upload: what the user waits for', async ({ stack, openAs }) => {
  const owner = await stack.createUser();
  const workspace = await stack.createWorkspace(owner);
  const { board, columns } = await stack.createBoard(owner, workspace.id);
  const todo = columns[0]!;
  const task = (await stack.createTasks(owner, workspace.id, board.id, todo.id, ['Load']))[0]!;

  // Written to disk and handed over as a path. `setInputFiles` with a `buffer` would push all
  // 10 MB through the CDP connection as base64 first, and that transfer is Playwright's cost,
  // not the product's — it would land inside the number and inflate it.
  const dir = await mkdtemp(join(tmpdir(), 'kurul-measure-'));
  const file = join(dir, 'measure-10mb.pdf');
  await writeFile(file, tenMegabytePdf());

  const page = await openAs(owner);
  const durations: number[] = [];

  try {
    for (let run = 0; run < RUNS; run++) {
      await page.goto(`/board/${board.id}/task/${task.id}`);
      await waitForBoardReady(page);
      const attachments = page.getByRole('region', { name: 'Attachments' });
      // Waiting for the *loaded* list before starting the clock: otherwise the first run also
      // times the panel's own initial read.
      await expect(attachments.getByRole('button', { name: /^Delete attachment/ })).toHaveCount(
        run,
      );

      const started = performance.now();
      await page.getByLabel('Attach a file').setInputFiles(file);
      await expect(attachments.getByRole('button', { name: /^Delete attachment/ })).toHaveCount(
        run + 1,
      );
      durations.push(performance.now() - started);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  report(`10 MB upload — browser, file chosen → row listed (${RUNS} runs)`, [
    `machine     ${machine()}`,
    `stack       Chromium → next standalone ${WEB_URL} → node ${API_URL}, loopback, no proxy`,
    `includes    browser multipart assembly + POST + panel re-render; excludes the file picker`,
    `duration    median ${ms(median(durations))} · p95 ${ms(p95(durations))}`,
    `raw (ms)    ${sorted(durations)
      .map((value) => value.toFixed(1))
      .join(' ')}`,
  ]);
});
