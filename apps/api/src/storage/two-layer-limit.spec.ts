import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_BODY_MAX_BYTES } from '../auth/auth-body-limit';
import { DEFAULT_TRELLO_IMPORT_MAX_BYTES } from '../import/import-config';
import { DEFAULT_ATTACHMENT_MAX_BYTES } from './storage-config';

/**
 * The upload size limit exists in two layers and they are not independently tunable.
 *
 * The API enforces it with multer's `limits.fileSize`; the reverse proxy enforces it with
 * `request_body max_size`. Raising one alone produces the failure ADR 0022 added the proxy row
 * to prevent: a 413 logged as a successful proxied request in one direction and logged nowhere
 * at all in the other. Nothing in the type system connects a Caddyfile to a TypeScript
 * constant, so this spec is the connection — it fails the build the moment the two disagree.
 *
 * It reads the shipped files rather than a copy of them. A test that asserted against its own
 * duplicate of the number would pass on the day somebody edits the Caddyfile, which is the only
 * day it needed to fail.
 *
 * ## "Not independently tunable" is an ordering, not an equality
 *
 * The first version of this spec asserted the two numbers were *equal*, and that was wrong — it
 * pinned a bug rather than a contract. The layers do not measure the same thing: `max_size`
 * counts the whole request body, `ATTACHMENT_MAX_BYTES` counts the file part, and the multipart
 * envelope sits between them. With both at 25 MiB, a file of exactly the published limit passes
 * the API's check and fails the proxy's, so the documented maximum was not actually uploadable
 * through the shipped stack.
 *
 * The invariant that survives measurement is: **the proxy must never reject something the API
 * would accept.** It exists to cut absurd bodies before anything buffers them; the exact file
 * limit belongs to the API, the only layer that can name the file in its answer.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * The worst multipart envelope measured for this endpoint's request shape — one `kind` text
 * field and one file part — against a 26214400-byte file:
 *
 *   filename `a.png`                       309 bytes
 *   filename `screenshot.png`              318 bytes
 *   filename with 32 UTF-8 characters      340 bytes
 *   filename with 259 characters           563 bytes
 *
 * Measured by reading `Content-Length` off the request superagent produces, not estimated. The
 * number scales with the filename, which is the only variable-length part of the envelope, so
 * the 259-character case is the ceiling any real client can reach (255 is the usual filesystem
 * limit).
 */
const MEASURED_MULTIPART_ENVELOPE_BYTES = 563;

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** `25MiB` / `26214400` / `1m` → bytes. Caddy's own size grammar, the subset this repo uses. */
function parseSize(literal: string): number {
  const match = /^(\d+)\s*(B|KB|MB|GB|KiB|MiB|GiB|k|m|g)?$/i.exec(literal.trim());
  if (match === null) throw new Error(`Unparseable size literal: "${literal}"`);
  const value = Number(match[1]);
  const unit = (match[2] ?? 'B').toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 * 1000,
    gb: 1000 * 1000 * 1000,
    kib: 1024,
    mib: 1024 * 1024,
    gib: 1024 * 1024 * 1024,
    // nginx's suffixes, which are binary despite the spelling.
    k: 1024,
    m: 1024 * 1024,
    g: 1024 * 1024 * 1024,
  };
  return value * multipliers[unit]!;
}

/** The text between the `{` at `open` and the `}` that closes it. */
function braced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error('Unbalanced braces');
}

/**
 * The two proxy rules that carry a body limit, keyed by the Caddyfile directive that opens the
 * block and the nginx `location` the documented contract gives it.
 *
 * Both proxies are read *per rule* rather than "the first `max_size` in the file": since
 * `handle /auth/*` gained a `request_body` of its own, the first match in either file names the
 * auth ceiling, and the upload assertions below would be comparing 64 KiB to 25 MiB.
 */
const PROXY_RULES = {
  '/auth/*': { caddy: 'handle /auth/*', nginx: 'location /auth/' },
  '/api/*': { caddy: 'handle_path /api/*', nginx: 'location /api/' },
} as const;
type ProxyRule = keyof typeof PROXY_RULES;

/** `request_body { max_size … }` inside one `handle`/`handle_path` block of docker/Caddyfile. */
function caddyLimit(rule: ProxyRule): number {
  const caddyfile = read('docker/Caddyfile');
  const opener = PROXY_RULES[rule].caddy;
  const start = caddyfile.indexOf(opener);
  if (start === -1) throw new Error(`docker/Caddyfile has no "${opener}" block`);
  const block = braced(caddyfile, caddyfile.indexOf('{', start));
  const match = /max_size\s+(\S+)/.exec(block);
  if (match === null) throw new Error(`"${opener}" in docker/Caddyfile sets no max_size`);
  return parseSize(match[1]!);
}

/** `client_max_body_size` inside one `location` block of the documented nginx contract. */
function nginxLimit(
  doc: 'docs/self-hosting.md' | 'docs/tr/self-hosting.md',
  rule: ProxyRule,
): number {
  const text = read(doc);
  const opener = PROXY_RULES[rule].nginx;
  const start = text.indexOf(opener);
  if (start === -1) throw new Error(`${doc} has no "${opener}" block`);
  const block = braced(text, text.indexOf('{', start));
  const match = /client_max_body_size\s+([^;]+);/.exec(block);
  if (match === null) throw new Error(`"${opener}" in ${doc} sets no client_max_body_size`);
  return parseSize(match[1]!);
}

describe('the two-layer upload limit', () => {
  it('is 25 MiB in the API', () => {
    expect(DEFAULT_ATTACHMENT_MAX_BYTES).toBe(26_214_400);
  });

  it('leaves docker/Caddyfile room for the multipart envelope, above the file limit', () => {
    const proxyLimit = caddyLimit('/api/*');

    // Strictly greater, so a file of exactly the published maximum can still be uploaded once
    // its envelope is counted. Equality here is the bug this assertion replaced.
    expect(proxyLimit).toBeGreaterThan(DEFAULT_ATTACHMENT_MAX_BYTES);
    expect(proxyLimit - DEFAULT_ATTACHMENT_MAX_BYTES).toBeGreaterThan(
      MEASURED_MULTIPART_ENVELOPE_BYTES,
    );
  });

  it('leaves the same room in docs/self-hosting.md, where an operator replacing Caddy reads it', () => {
    // nginx defaults `client_max_body_size` to 1 MB, so an operator who followed the published
    // contract and omitted this row is the one who gets the broken install (ADR 0022).
    const proxyLimit = nginxLimit('docs/self-hosting.md', '/api/*');
    expect(proxyLimit).toBeGreaterThan(DEFAULT_ATTACHMENT_MAX_BYTES);
    expect(proxyLimit - DEFAULT_ATTACHMENT_MAX_BYTES).toBeGreaterThan(
      MEASURED_MULTIPART_ENVELOPE_BYTES,
    );
  });

  it('leaves the same room in the Turkish mirror', () => {
    const proxyLimit = nginxLimit('docs/tr/self-hosting.md', '/api/*');
    expect(proxyLimit).toBeGreaterThan(DEFAULT_ATTACHMENT_MAX_BYTES);
    expect(proxyLimit - DEFAULT_ATTACHMENT_MAX_BYTES).toBeGreaterThan(
      MEASURED_MULTIPART_ENVELOPE_BYTES,
    );
  });

  it('keeps the two proxy numbers equal to each other, so replacing Caddy changes nothing', () => {
    // The bundled proxy and the published nginx row are the *same* layer described twice. They
    // have to agree with each other even though neither agrees with the API's number, and
    // nothing above would notice one of them drifting — each is only compared to the API.
    const caddy = caddyLimit('/api/*');
    const nginx = nginxLimit('docs/self-hosting.md', '/api/*');
    const nginxTr = nginxLimit('docs/tr/self-hosting.md', '/api/*');

    expect(nginx).toBe(caddy);
    expect(nginxTr).toBe(caddy);
  });

  /**
   * The importer is a second body that crosses the same proxy, under a limit of its own.
   *
   * It is checked here rather than in `src/import` because the fact being pinned is not about
   * importing — it is that *every* multipart ceiling in this API stays under the one layer in
   * front of it. A second file would let the two drift into two different rules.
   */
  it('keeps the Trello import limit under the proxy limit, envelope included', () => {
    const proxyLimit = caddyLimit('/api/*');

    expect(DEFAULT_TRELLO_IMPORT_MAX_BYTES).toBe(20_971_520);
    // Not "smaller than" — smaller *with room for the multipart envelope*, the same margin the
    // attachment rows above check. Without this, raising TRELLO_IMPORT_MAX_BYTES to 30 MiB would
    // produce an import Caddy kills with an empty-bodied 413 the API never sees, which is exactly
    // the untraceable failure ADR 0022 added the proxy row to prevent.
    //
    // MEASURED_MULTIPART_ENVELOPE_BYTES is reused rather than re-measured: it is the worst case
    // for a *wider* request shape (an extra `kind` text field), and an import request carries one
    // part fewer, so it is already a valid upper bound here.
    expect(proxyLimit).toBeGreaterThan(DEFAULT_TRELLO_IMPORT_MAX_BYTES);
    expect(proxyLimit - DEFAULT_TRELLO_IMPORT_MAX_BYTES).toBeGreaterThan(
      MEASURED_MULTIPART_ENVELOPE_BYTES,
    );
  });

  it('is the same Trello import number in .env.example and in the compose default', () => {
    // A limit an operator can set in .env but the container never receives is the same class of
    // defect as an unconfigured default: the variable exists and does nothing.
    expect(/^TRELLO_IMPORT_MAX_BYTES=(\d+)$/m.exec(read('.env.example'))?.[1]).toBe(
      String(DEFAULT_TRELLO_IMPORT_MAX_BYTES),
    );
    expect(
      /TRELLO_IMPORT_MAX_BYTES:\s*\$\{TRELLO_IMPORT_MAX_BYTES:-(\d+)\}/.exec(
        read('docker-compose.yml'),
      )?.[1],
    ).toBe(String(DEFAULT_TRELLO_IMPORT_MAX_BYTES));
  });

  it('is the same number in .env.example and in the compose default', () => {
    expect(/^ATTACHMENT_MAX_BYTES=(\d+)$/m.exec(read('.env.example'))?.[1]).toBe(
      String(DEFAULT_ATTACHMENT_MAX_BYTES),
    );
    expect(
      /ATTACHMENT_MAX_BYTES:\s*\$\{ATTACHMENT_MAX_BYTES:-(\d+)\}/.exec(
        read('docker-compose.yml'),
      )?.[1],
    ).toBe(String(DEFAULT_ATTACHMENT_MAX_BYTES));
  });

  /**
   * The other pair that has to agree: the orphan sweep's grace period is
   * `BACKUP_KEEP × BACKUP_INTERVAL`, which only means anything if the API is actually given
   * those two values. They were compose-only until this PR.
   */
  it('passes the backup rotation to the api service, which the orphan sweep reads', () => {
    const compose = read('docker-compose.yml');
    const apiService = compose.slice(
      compose.indexOf('\n  api:'),
      compose.indexOf('\n  web:', compose.indexOf('\n  api:')),
    );

    expect(apiService).toContain('BACKUP_INTERVAL: ${BACKUP_INTERVAL:-86400}');
    expect(apiService).toContain('BACKUP_KEEP: ${BACKUP_KEEP:-7}');
    expect(apiService).toContain('STORAGE_PATH: /data/attachments');
    expect(apiService).toContain('attachment_data:/data/attachments');
  });
});

/**
 * The other rule with a body limit, held to the same ordering and to a tighter equality.
 *
 * `/auth/*` is bounded twice as well: `request_body max_size` on `handle /auth/*` and the
 * mount's own `AUTH_BODY_MAX_BYTES` check (`auth/auth-body-limit.ts`). The ordering rule is
 * the one the upload pair follows, the proxy must never reject something the API would accept,
 * but there is no multipart envelope between the two here: an auth body is a JSON object, and
 * `Content-Length` is the number both layers compare. So the proxy needs no headroom above the
 * API, and the assertion is `>=` rather than "greater by more than an envelope".
 */
describe('the two-layer auth body limit', () => {
  it('is 64 KiB in the API', () => {
    expect(AUTH_BODY_MAX_BYTES).toBe(65_536);
  });

  it('is bounded in docker/Caddyfile at or above the API constant', () => {
    expect(caddyLimit('/auth/*')).toBeGreaterThanOrEqual(AUTH_BODY_MAX_BYTES);
  });

  it('is bounded in docs/self-hosting.md at or above the API constant', () => {
    // nginx defaults `client_max_body_size` to 1 MB, so an operator who omitted this row would
    // still be bounded, sixteen times more loosely than the shipped proxy. The row exists so
    // that the contract table and the snippet say the same number the Caddyfile does.
    expect(nginxLimit('docs/self-hosting.md', '/auth/*')).toBeGreaterThanOrEqual(
      AUTH_BODY_MAX_BYTES,
    );
  });

  it('is bounded in the Turkish mirror at or above the API constant', () => {
    expect(nginxLimit('docs/tr/self-hosting.md', '/auth/*')).toBeGreaterThanOrEqual(
      AUTH_BODY_MAX_BYTES,
    );
  });

  it('keeps the two proxy numbers equal to each other, so replacing Caddy changes nothing', () => {
    const caddy = caddyLimit('/auth/*');

    expect(nginxLimit('docs/self-hosting.md', '/auth/*')).toBe(caddy);
    expect(nginxLimit('docs/tr/self-hosting.md', '/auth/*')).toBe(caddy);
  });

  it('stays far below the upload ceiling: the two rules are different limits on purpose', () => {
    // A future edit that copies the 26 MiB line into the auth block would pass every assertion
    // above and quietly reopen the finding. An auth body is a few hundred bytes; the ceiling is
    // meant to be small.
    expect(caddyLimit('/auth/*')).toBeLessThan(DEFAULT_TRELLO_IMPORT_MAX_BYTES);
    expect(caddyLimit('/auth/*')).toBeLessThan(caddyLimit('/api/*'));
  });
});
