#!/usr/bin/env node
/**
 * Removes, from a `pnpm deploy` output directory, every package the deployed app can never
 * `require()`.
 *
 * ## The problem this exists for
 *
 * `pnpm --filter @kurultay/api deploy --prod` does prune: it drops `@kurultay/api`'s own
 * `devDependencies`. What it does not drop is *optional peer dependencies* — peers that the
 * publishing package itself marked `"optional": true`, meaning "load this only if the host
 * application brought it". pnpm's `auto-install-peers` (on by default since v8) installs them
 * anyway, and `deploy` copies whatever the lockfile resolved.
 *
 * Measured on this repository's `@kurultay/api` deploy, that is the majority of the tree.
 * `better-auth` declares optional peers on `next`, `react`, `react-dom`, `svelte`, `vue`,
 * `solid-js`, `drizzle-orm`, `mongodb`, `mysql2`, `better-sqlite3` and `vitest`; `@prisma/client`
 * declares them on `prisma` (the CLI) and `typescript`. Following those edges drags in
 * `@next/swc-linux-arm64-{gnu,musl}`, `@prisma/studio-core`, `@electric-sql/pglite`,
 * `@prisma/engines`, `@img/sharp-libvips-*`, `lightningcss-*`, `playwright`, `vite`, `rollup`,
 * `esbuild`, `terser` and `typescript` — none of which the API process opens, and none of which
 * it would be able to find if the lockfile had never resolved them, because the code paths that
 * reach for them are guarded exactly because the peer is optional.
 *
 * ## What "can never require it" means here, precisely
 *
 * The kept set is the closure of the deploy directory's top-level `node_modules` entries under
 * three edge kinds, read from each package's own `package.json`:
 *
 *   - `dependencies` — the package says it needs this.
 *   - `optionalDependencies` — the package uses this when the install succeeded, which in a
 *     deploy directory it did. Platform binaries live here; dropping them breaks things.
 *   - `peerDependencies` *not* marked optional in `peerDependenciesMeta` — the package says the
 *     host must provide this, so the host does.
 *
 * Everything else in `node_modules/.pnpm` is unreachable: pnpm's isolated layout means a package
 * resolves only what is symlinked into its own virtual-store directory, so an entry no kept
 * package links to has no path by which `require` could ever arrive at it. Deleting it is not a
 * judgement call about whether the code "probably" runs — there is no resolution path.
 *
 * The one deliberate looseness is optional peers that *are* also reachable some other way:
 * `pg` is an optional peer of `better-auth` and a direct dependency of `@kurultay/api`, so it
 * stays, as it must.
 *
 * ## The risk this cannot see, stated plainly
 *
 * "No resolution path" is true of the isolated layout's *primary* path, and it is not the only
 * path. Node resolves a bare specifier by walking parent directories, so a file at
 * `.pnpm/<id>/node_modules/x/index.js` tries `.pnpm/<id>/node_modules` first — the scope this
 * script follows — and then falls through to `.pnpm/node_modules`, pnpm's flat hoist of
 * everything the install resolved. That hoist is a real last-resort path, and it is deliberately
 * there to rescue packages that `require` something they never declared.
 *
 * So the class of breakage this closure cannot detect is exactly that: **a kept package that
 * requires a module absent from its own manifest**, which used to resolve through the hoist and
 * now will not. It is a bug in the requiring package rather than in this script, and it is
 * narrow, but it is real, it is invisible to a manifest-only walk, and it fails at runtime
 * rather than at build — the worst of the three properties.
 *
 * There is no static mitigation, only an empirical one: start the thing and use it. What stands
 * between this script and a broken deploy is `docker-compose.yml`'s healthcheck (`/health/ready`
 * probes Postgres and Redis, so "healthy" means the process got that far), the API's own e2e
 * suite, and — because the paths most likely to reach for something lazily are the ones that are
 * off by default — a boot with `SENTRY_DSN`, `SMTP_HOST` and `REDIS_URL` actually set. All three
 * of those are opt-in, all three load code no default-configuration boot ever touches, and a
 * prune verified only against the defaults would have tested the wrong half of the image.
 *
 * ## What this does not do
 *
 * It does not touch file *contents* — no stripping of `.d.ts`, sourcemaps or docs from packages
 * that stay. It does not read the application's source to decide anything; it reads manifests
 * only, which is both why it is cheap and why it has the blind spot above.
 *
 * ## Usage
 *
 *     node scripts/prune-deployed-modules.mjs <deploy-dir> [keep-root...]
 *
 * With no `keep-root` arguments the roots are every top-level entry the deploy produced — the
 * right answer for a `--prod` deploy, whose top level is already the production dependency list.
 *
 * Naming roots explicitly narrows the deploy to those packages and their closure, and removes the
 * other top-level links. That is how the migration image is built: a full (dev-inclusive) deploy
 * pruned to `prisma dotenv` is the Prisma CLI and nothing else — no Nest, no Jest, no compiler.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';

const [deployDir, ...keepRoots] = process.argv.slice(2);

if (!deployDir) {
  console.error('usage: prune-deployed-modules.mjs <deploy-dir> [keep-root...]');
  process.exit(1);
}

const nodeModules = join(deployDir, 'node_modules');
const store = join(nodeModules, '.pnpm');

if (!existsSync(store)) {
  console.error(
    `${store} does not exist — this expects a pnpm deploy directory using the isolated ` +
      `node-linker (the default). Nothing pruned.`,
  );
  process.exit(1);
}

/**
 * Lists the package names directly under a `node_modules` directory, descending one level into
 * `@scope` directories and skipping pnpm's own bookkeeping entries.
 */
function packageNamesIn(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const entry of entries) {
    if (entry.name === '.pnpm' || entry.name === '.bin' || entry.name === '.modules.yaml') continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(join(dir, entry.name))) {
        names.push(`${entry.name}/${scoped}`);
      }
      continue;
    }
    names.push(entry.name);
  }
  return names;
}

/**
 * Resolves `name` from `fromNodeModules` and reports which virtual-store entry it landed in.
 * Returns null when the link is dangling or points outside the store — a workspace package
 * copied in place, say — in which case there is nothing in the store to keep alive for it.
 */
function storeEntryFor(fromNodeModules, name) {
  let real;
  try {
    real = realpathSync(join(fromNodeModules, name));
  } catch {
    return null;
  }
  if (!real.startsWith(store + sep)) return null;
  const [id, ...rest] = real.slice(store.length + 1).split(sep);
  return { id, packageDir: real, relative: rest.join(sep) };
}

function manifestAt(packageDir) {
  try {
    return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** The dependency names a package can reach at runtime. See the header for why these three. */
function runtimeEdges(manifest) {
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const meta = manifest.peerDependenciesMeta ?? {};
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    if (!meta[peer]?.optional) names.add(peer);
  }
  return names;
}

const rootNames = packageNamesIn(nodeModules);
const roots = keepRoots.length > 0 ? keepRoots : rootNames;

for (const root of roots) {
  if (!rootNames.includes(root)) {
    console.error(`${root} is not a top-level entry of ${nodeModules} — refusing to guess.`);
    process.exit(1);
  }
}

const keep = new Set();
const queue = [];

for (const name of roots) {
  const entry = storeEntryFor(nodeModules, name);
  if (entry && !keep.has(entry.id)) {
    keep.add(entry.id);
    queue.push(entry);
  }
}

while (queue.length > 0) {
  const { id, packageDir } = queue.pop();
  const scope = join(store, id, 'node_modules');
  for (const name of runtimeEdges(manifestAt(packageDir))) {
    const next = storeEntryFor(scope, name);
    if (next && !keep.has(next.id)) {
      keep.add(next.id);
      queue.push(next);
    }
  }
}

const allIds = readdirSync(store).filter((name) => name !== 'node_modules' && name !== 'lock.yaml');
const drop = allIds.filter((id) => !keep.has(id));

for (const id of drop) rmSync(join(store, id), { recursive: true, force: true });

// pnpm's `.pnpm/node_modules` is a flat hoist of everything the install resolved, offered as a
// last-resort resolution path. Links into packages that just went away are dangling; sweep them
// so nothing later mistakes a broken symlink for an installed package.
const hoisted = join(store, 'node_modules');
let danglingHoistLinks = 0;
for (const name of packageNamesIn(hoisted)) {
  const link = join(hoisted, name);
  if (!existsSync(link)) {
    rmSync(link, { force: true });
    danglingHoistLinks += 1;
  }
}

// `node_modules/.bin` is the same story with a twist: pnpm writes a small shell shim per
// package that declares a bin, not a symlink, so a shim for a pruned package is a file that
// still exists and execs something that does not. Read the paths each shim reaches for and drop
// the ones where none of them are there any more — a `tsc` in an image with no TypeScript is at
// best a puzzle for whoever finds it.
let deadBinShims = 0;
const binDir = join(nodeModules, '.bin');
for (const name of existsSync(binDir) ? readdirSync(binDir) : []) {
  const shim = join(binDir, name);
  let targets;
  try {
    targets = [...readFileSync(shim, 'utf8').matchAll(/\$basedir\/(\.\.\/[^"'\s]+)/g)].map(
      (match) => match[1],
    );
  } catch {
    continue;
  }
  if (targets.length === 0) continue;
  if (targets.some((target) => existsSync(join(binDir, target)))) continue;
  rmSync(shim, { force: true });
  deadBinShims += 1;
}

// When roots were named explicitly, the top level still lists everything the deploy installed.
// Drop the links that are no longer backed by a kept package.
let removedRootLinks = 0;
for (const name of rootNames) {
  if (roots.includes(name)) continue;
  rmSync(join(nodeModules, name), { recursive: true, force: true });
  removedRootLinks += 1;
}

console.log(
  `pruned ${deployDir}: kept ${keep.size} of ${allIds.length} store entries, ` +
    `removed ${drop.length} unreachable, ${removedRootLinks} top-level links, ` +
    `${danglingHoistLinks} dangling hoist links, ${deadBinShims} dead bin shims`,
);
