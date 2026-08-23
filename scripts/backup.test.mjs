/**
 * Tests for `scripts/backup.sh`, on `node:test` because `scripts/` has no dependencies and must
 * keep having none. Run with `pnpm test:scripts`.
 *
 * The script is driven in its `once` mode against fakes on the PATH: a `pg_dump` that writes a
 * few bytes, and an `rclone` that implements the three subcommands backup.sh actually uses
 * (`copyto`, `lsf`, `deletefile`) over a local directory. That keeps the assertions about what
 * this repo controls, which is the ORDER and the CONSEQUENCES of those calls: what gets
 * uploaded, what gets pruned, when the freshness stamp is allowed to move, and what a failed
 * upload does to the local archives.
 *
 * The last test runs the compose healthcheck's own shell command, lifted out of
 * docker-compose.yml, so the two halves of the feature cannot drift apart silently.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BACKUP_SH = join(ROOT, 'scripts', 'backup.sh');
const COMPOSE = join(ROOT, 'docker-compose.yml');

const tempRoots = [];

after(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

/** A `pg_dump --format=custom --file=<path> <db>` that writes a plausible archive and exits 0. */
const FAKE_PG_DUMP = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in --file=*) out="\${arg#--file=}" ;; esac
done
[ -n "$out" ] || exit 64
printf 'PGDMP-fake-archive' > "$out"
`;

/**
 * The subset of rclone backup.sh calls, over a local directory. `fake:<path>` maps to
 * $FAKE_REMOTE/<path>, so the test exercises the real "remote with a colon in it" string
 * handling rather than a bare local path that would hide a quoting bug.
 *
 * Every invocation is appended to $RCLONE_LOG. $RCLONE_FAIL makes `copyto` fail the way a
 * network outage or a wrong credential does: non-zero, nothing written.
 */
const FAKE_RCLONE = `#!/bin/sh
echo "$*" >> "$RCLONE_LOG"
# Global flags come before the subcommand, exactly as real rclone accepts them.
while [ $# -gt 0 ]; do
  case "$1" in -*) shift ;; *) break ;; esac
done
cmd=$1
shift
resolve() { printf '%s/%s' "$FAKE_REMOTE" "\${1#fake:}"; }
case "$cmd" in
  copyto)
    [ -z "$RCLONE_FAIL" ] || { echo "fake rclone: upload refused" >&2; exit 1; }
    # Drop the flags (and the values of the two that take one), keep SRC and DST.
    src=""
    dst=""
    skip=""
    for arg in "$@"; do
      if [ -n "$skip" ]; then skip=""; continue; fi
      case "$arg" in
        --retries|--low-level-retries) skip=1 ;;
        -*) : ;;
        *) if [ -z "$src" ]; then src="$arg"; else dst="$arg"; fi ;;
      esac
    done
    target=$(resolve "$dst")
    mkdir -p "$(dirname "$target")"
    cp "$src" "$target"
    ;;
  lsf)
    pattern=""
    remote=""
    want_pattern=""
    for arg in "$@"; do
      if [ -n "$want_pattern" ]; then pattern="$arg"; want_pattern=""; continue; fi
      case "$arg" in
        --include) want_pattern=1 ;;
        -*) : ;;
        *) remote="$arg" ;;
      esac
    done
    dir=$(resolve "$remote")
    [ -d "$dir" ] || exit 0
    # shellcheck disable=SC2086
    ls -1 $dir/$pattern 2>/dev/null | while IFS= read -r f; do basename "$f"; done
    ;;
  deletefile)
    rm -f "$(resolve "$1")"
    ;;
  *)
    echo "fake rclone: unsupported subcommand $cmd" >&2
    exit 2
    ;;
esac
`;

/** A world to run backup.sh in: fake binaries on the PATH, a backup dir, an attachments dir. */
function makeWorld({ withRclone = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kurul-backup-'));
  tempRoots.push(root);

  const bin = join(root, 'bin');
  const backups = join(root, 'backups');
  const attachments = join(root, 'attachments');
  const remote = join(root, 'remote');
  mkdirSync(bin);
  mkdirSync(backups);
  mkdirSync(attachments);
  mkdirSync(remote);
  writeFileSync(join(attachments, 'upload.txt'), 'an uploaded file');

  writeFileSync(join(bin, 'pg_dump'), FAKE_PG_DUMP);
  chmodSync(join(bin, 'pg_dump'), 0o755);
  if (withRclone) {
    writeFileSync(join(bin, 'rclone'), FAKE_RCLONE);
    chmodSync(join(bin, 'rclone'), 0o755);
  }

  return { root, bin, backups, attachments, remote, rcloneLog: join(root, 'rclone.log') };
}

function runBackup(world, env = {}) {
  const result = spawnSync('sh', [BACKUP_SH, 'once'], {
    encoding: 'utf8',
    env: {
      PATH: `${world.bin}:${process.env.PATH}`,
      BACKUP_DIR: world.backups,
      ATTACHMENT_DIR: world.attachments,
      BACKUP_KEEP: '7',
      FAKE_REMOTE: world.remote,
      RCLONE_LOG: world.rcloneLog,
      ...env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    // Every log line is `<UTC timestamp> backup: …`; the timestamp is the only part that
    // changes between runs, so drop it to compare what the script actually said.
    lines: (result.stdout ?? '')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/^\S+ /, '')),
  };
}

function rcloneCalls(world) {
  try {
    return readFileSync(world.rcloneLog, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function stampOf(name) {
  const match = /^kurul-(\d{8}T\d{6}Z)/.exec(name);
  return match?.[1];
}

describe('backup.sh without an off-host target', () => {
  it('writes both archives, calls no rclone, and leaves no freshness stamp', () => {
    const world = makeWorld();
    const run = runBackup(world);

    assert.equal(run.status, 0, run.stderr);
    const written = readdirSync(world.backups);
    const dump = written.find((f) => f.endsWith('.dump'));
    const files = written.find((f) => f.endsWith('-files.tar.gz'));
    assert.ok(dump, `no dump in ${written.join(', ')}`);
    assert.ok(files, `no file archive in ${written.join(', ')}`);
    assert.equal(stampOf(dump), stampOf(files), 'both archives share one cycle timestamp');

    // The acceptance criterion "without one, behaviour is unchanged" is this: two log lines,
    // the same two as before the off-host half existed, and nothing about a remote.
    assert.equal(run.lines.length, 2);
    assert.ok(
      run.lines.every((line) => /^backup: wrote /.test(line)),
      run.lines.join(' | '),
    );
    assert.deepEqual(rcloneCalls(world), []);
    assert.deepEqual(
      written.filter((f) => f.startsWith('.')),
      [],
      'no stamp file and no rclone cache when BACKUP_REMOTE is unset',
    );
  });
});

describe('backup.sh with an off-host target', () => {
  it('pushes both archives and stamps the cycle', () => {
    const world = makeWorld();
    const before = Date.now();
    const run = runBackup(world, { BACKUP_REMOTE: 'fake:kurul' });

    assert.equal(run.status, 0, run.stderr);
    const local = readdirSync(world.backups);
    const dump = local.find((f) => f.endsWith('.dump'));
    const stamp = stampOf(dump);

    const remote = readdirSync(join(world.remote, 'kurul')).sort();
    assert.deepEqual(remote, [`kurul-${stamp}-files.tar.gz`, `kurul-${stamp}.dump`]);

    const stampFile = join(world.backups, '.offhost-stamp');
    assert.ok(statSync(stampFile).mtimeMs >= before - 1000, 'stamp is fresh');
    assert.ok(
      run.lines.some((line) => line.includes(`pushed kurul-${stamp}.dump to fake:kurul`)),
      run.lines.join(' | '),
    );
    // Uploads use `copyto` with an explicit destination name, never a directory copy that
    // could rename or nest the archive. `--config=` rides along on every call so an env-only
    // setup does not print rclone's "config file not found" NOTICE once per invocation.
    assert.ok(
      rcloneCalls(world).some(
        (call) =>
          call.startsWith('--config= copyto') && call.endsWith(`fake:kurul/kurul-${stamp}.dump`),
      ),
      rcloneCalls(world).join(' | '),
    );
  });

  it('prunes the remote to BACKUP_KEEP per series without touching the new upload', () => {
    const world = makeWorld();
    const remoteDir = join(world.remote, 'kurul');
    mkdirSync(remoteDir, { recursive: true });
    // Four older cycles already off-host, in both series.
    for (const old of ['20200101T000000Z', '20200102T000000Z', '20200103T000000Z']) {
      writeFileSync(join(remoteDir, `kurul-${old}.dump`), 'old');
      writeFileSync(join(remoteDir, `kurul-${old}-files.tar.gz`), 'old');
    }

    const run = runBackup(world, { BACKUP_REMOTE: 'fake:kurul', BACKUP_KEEP: '2' });
    assert.equal(run.status, 0, run.stderr);

    const stamp = stampOf(readdirSync(world.backups).find((f) => f.endsWith('.dump')));
    const remote = readdirSync(remoteDir).sort();
    assert.deepEqual(remote, [
      'kurul-20200103T000000Z-files.tar.gz',
      'kurul-20200103T000000Z.dump',
      `kurul-${stamp}-files.tar.gz`,
      `kurul-${stamp}.dump`,
    ]);
    // The two series are pruned to the same count, the way prune() does locally.
    assert.equal(remote.filter((f) => f.endsWith('.dump')).length, 2);
    assert.equal(remote.filter((f) => f.endsWith('-files.tar.gz')).length, 2);
  });

  it('keeps the local archives, logs loudly, and does not stamp when the upload fails', () => {
    const world = makeWorld();
    const stampFile = join(world.backups, '.offhost-stamp');
    // A stamp from an earlier, successful cycle. A failed push must not refresh it, which is
    // what eventually turns the container unhealthy.
    writeFileSync(stampFile, '');
    const stale = new Date(Date.now() - 3 * 86400 * 1000);
    utimesSync(stampFile, stale, stale);

    const run = runBackup(world, { BACKUP_REMOTE: 'fake:kurul', RCLONE_FAIL: '1' });

    assert.notEqual(run.status, 0, 'a hand-run backup that never reached the remote fails loudly');
    const local = readdirSync(world.backups);
    assert.ok(
      local.some((f) => f.endsWith('.dump')),
      'local dump survives a failed upload',
    );
    assert.ok(
      local.some((f) => f.endsWith('-files.tar.gz')),
      'local file archive survives a failed upload',
    );
    assert.equal(
      Math.round(statSync(stampFile).mtimeMs),
      Math.round(stale.getTime()),
      'the stamp is untouched by a failed push',
    );
    const errors = run.lines.filter((line) => line.includes('ERROR off-host'));
    assert.equal(errors.length, 2, run.lines.join(' | '));
    assert.ok(errors.every((line) => line.includes('OFF-HOST COPY IS NOW STALE')));
    // Nothing was pruned on the remote off the back of a failed cycle.
    assert.deepEqual(
      rcloneCalls(world).filter((call) => call.includes('deletefile')),
      [],
    );
  });

  it('leaves an operator-supplied rclone config alone', () => {
    const world = makeWorld();
    const run = runBackup(world, {
      BACKUP_REMOTE: 'fake:kurul',
      RCLONE_CONFIG: '/config/rclone.conf',
    });

    assert.equal(run.status, 0, run.stderr);
    // No `--config=` override: rclone reads RCLONE_CONFIG itself, and forcing the env-only
    // mode here would silently ignore the file the operator mounted.
    assert.ok(
      rcloneCalls(world).every((call) => !call.includes('--config=')),
      rcloneCalls(world).join(' | '),
    );
  });

  it('fails the cycle instead of hanging when rclone cannot be provided', () => {
    // No rclone on the PATH and a cache directory that cannot be filled (the download URL is
    // never reached because the test env has no network guarantee): the run must end, loudly.
    const world = makeWorld({ withRclone: false });
    const run = runBackup(world, {
      BACKUP_REMOTE: 'fake:kurul',
      // Point the cache at a path that cannot be created, so ensure_rclone gives up at once
      // rather than downloading 20 MB inside a unit test.
      RCLONE_CACHE: '/dev/null/nope',
    });

    assert.notEqual(run.status, 0);
    assert.ok(
      readdirSync(world.backups).some((f) => f.endsWith('.dump')),
      'the local recovery point is taken even when the off-host half cannot run',
    );
  });
});

describe('the compose healthcheck', () => {
  // Lifted verbatim from docker-compose.yml so a change to one side fails here rather than in
  // production. `$$` is Compose's escape for a literal `$`; `/backups` becomes the test dir.
  const healthcheck = (() => {
    const compose = readFileSync(COMPOSE, 'utf8');
    const line = compose
      .split('\n')
      .find((l) => l.includes('.offhost-stamp') && l.includes('mmin'));
    assert.ok(line, 'no backup healthcheck command found in docker-compose.yml');
    return line.trim().replace(/^'/, '').replace(/',$/, '').replaceAll('$$', '$');
  })();

  function check(dir, env) {
    const result = spawnSync('sh', ['-c', healthcheck.replaceAll('/backups', dir)], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    });
    return result.status === 0;
  }

  function age(file, secondsAgo) {
    const when = new Date(Date.now() - secondsAgo * 1000);
    utimesSync(file, when, when);
  }

  it('reads the dump mtime when no remote is configured', () => {
    const world = makeWorld();
    const dump = join(world.backups, 'kurul-20200101T000000Z.dump');
    writeFileSync(dump, 'x');
    const env = { BACKUP_INTERVAL: '3600', BACKUP_REMOTE: '' };

    assert.equal(check(world.backups, env), true, 'fresh dump is healthy');
    age(dump, 3 * 3600);
    assert.equal(check(world.backups, env), false, 'a dump older than 2x the interval is not');
  });

  it('reads the off-host stamp when a remote is configured', () => {
    const world = makeWorld();
    // A perfectly fresh LOCAL dump, which must not be enough on its own here.
    writeFileSync(join(world.backups, 'kurul-20200101T000000Z.dump'), 'x');
    const stamp = join(world.backups, '.offhost-stamp');
    const env = { BACKUP_INTERVAL: '3600', BACKUP_REMOTE: 'fake:kurul' };

    assert.equal(check(world.backups, env), false, 'no off-host copy yet is unhealthy');
    writeFileSync(stamp, '');
    assert.equal(check(world.backups, env), true, 'a fresh off-host stamp is healthy');
    age(stamp, 3 * 3600);
    assert.equal(check(world.backups, env), false, 'a stale off-host stamp is unhealthy');
  });

  it('never rounds a small interval down to -mmin -0', () => {
    const world = makeWorld();
    writeFileSync(join(world.backups, 'kurul-20200101T000000Z.dump'), 'x');
    assert.equal(check(world.backups, { BACKUP_INTERVAL: '5', BACKUP_REMOTE: '' }), true);
  });
});

// `execFileSync` is imported for the shellcheck-style syntax gate below: a script that does not
// parse is a broken backup, and `sh -n` catches that without running anything.
describe('backup.sh syntax', () => {
  it('parses under POSIX sh', () => {
    execFileSync('sh', ['-n', BACKUP_SH]);
  });
});
