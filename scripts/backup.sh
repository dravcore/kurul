#!/bin/sh
#
# Scheduled logical backups for a Kurul instance — the database and the uploaded files.
#
# Runs as the `backup` sidecar in docker-compose.yml (image: postgres:18-alpine, so pg_dump
# always matches the server major). Every BACKUP_INTERVAL seconds it writes one
# `pg_dump -Fc` archive and, when ATTACHMENT_DIR is set, one `.tar.gz` of the attachments
# directory into BACKUP_DIR, then prunes each series down to BACKUP_KEEP archives, newest kept.
# Both archives of one cycle carry the SAME timestamp, which is how a restore knows which tar
# belongs to which dump.
#
# THE FILE ARCHIVE IS NOT A SNAPSHOT. pg_dump takes a consistent view of the database; tar takes
# whatever the directory looks like as it walks it, so a file uploaded while this runs can end up
# truncated in the archive. The window is one tar of the attachments directory, once per
# BACKUP_INTERVAL. Restoring such a file yields a corrupt download, not a missing row — the row
# is in the dump either way, and the restore drill in docs/development.md measures the gap by
# comparing each restored file's size against the size its row records. Widening this to a real
# snapshot means LVM/ZFS or pausing uploads, neither of which a single-host Compose install
# carries; see ADR 0022's scope note on backup_data living on the same host as postgres_data.
#
# Usage:
#   backup.sh          # loop forever: dump, archive, prune, sleep BACKUP_INTERVAL, repeat.
#                      # The first pass is skipped when a dump younger than BACKUP_INTERVAL/2
#                      # already exists, so a container restart is not a backup cycle (see the
#                      # main loop at the bottom)
#   backup.sh once     # take exactly one of each, prune, exit (manual/ad-hoc backup, and what
#                      # the restore drill in docs/development.md uses). Never skipped: an
#                      # operator asking for a dump gets a dump
#
# Configuration (all optional except the password):
#   PGHOST           postgres        # in-network address of the database server
#   PGPORT           5432
#   PGUSER           kurul
#   PGDATABASE       kurul
#   PGPASSWORD       -               # required; passed by compose, read by pg_dump directly
#   BACKUP_DIR       /backups        # the backup_data named volume
#   ATTACHMENT_DIR   -               # read-only mount of the attachments volume; blank = skip
#   BACKUP_INTERVAL  86400           # seconds between cycles (86400 = daily -> RPO <= 24h)
#   BACKUP_KEEP      7               # how many archives of EACH series to retain
#   BACKUP_REMOTE    -               # rclone remote path (e.g. s3:bucket/kurul); blank = no
#                                    # off-host copy, and this script behaves exactly as it did
#                                    # before that option existed
#
# OFF-HOST COPY. backup_data lives on the same host as postgres_data, so everything above
# covers "I dropped the wrong table" and covers nothing about a dead disk. Set BACKUP_REMOTE to
# an rclone remote path and every cycle also pushes BOTH archives there, prunes the remote to
# the same BACKUP_KEEP, and touches a stamp file the container healthcheck reads, so an
# instance whose off-host copy has silently stopped arriving reports unhealthy instead of
# looking fine until the restore. Credentials are rclone's own: either RCLONE_CONFIG_* env
# vars (rclone's native env-only config, no file needed) or a mounted rclone.conf pointed at by
# RCLONE_CONFIG. See docs/self-hosting.md#off-host-copies.
#
# BACKUP_INTERVAL and BACKUP_KEEP are read by the API too: the nightly orphan-file sweep will
# not delete a stored file while a dump old enough to disown it is still restorable, and that
# grace period is their product. Shortening either one shortens that window.
#
# Restore is `pg_restore`, not `psql` — see docs/development.md#upgrading-and-backups for
# the full, rehearsed procedure, including the file half.

set -eu

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-kurul}"
PGDATABASE="${PGDATABASE:-kurul}"
export PGHOST PGPORT PGUSER PGDATABASE

BACKUP_DIR="${BACKUP_DIR:-/backups}"
ATTACHMENT_DIR="${ATTACHMENT_DIR:-}"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-86400}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

# rclone is not in postgres:18-alpine and this script is bind-mounted into a stock image rather
# than baked into one, so when an off-host target is configured the binary is fetched once and
# cached in the backup volume. Pinned by version AND sha256: an unpinned download is a remote
# party choosing what runs as root in the container that holds every backup. Bumping the version
# means replacing all three sums from https://downloads.rclone.org/vX.Y.Z/SHA256SUMS.
#
# The cache is a DOT directory, which is what keeps it invisible to prune_pattern()'s
# `kurul-*` globs, to the remote push (which names the two files it uploads), and to an
# operator's `ls /backups`.
RCLONE_VERSION="1.75.0"
RCLONE_SHA256_AMD64="aa2804e08f48250e71009c727124b6341cd0288465804a9a09d14663cabafbaa"
RCLONE_SHA256_ARM64="d0ad88ba4c8e285b7c9efa591e0ab643280a91741e13c27f3a9c0957ccfa5203"
RCLONE_SHA256_ARMV7="8fcfdd4121348b79b485b40c52dc22f3d26ee167ec78105e15f5dbe2246eee97"
RCLONE_CACHE="${RCLONE_CACHE:-$BACKUP_DIR/.rclone}"

# Resolved by ensure_rclone() on first use, then reused for the life of the process.
RCLONE_BIN=""

# rclone prints `NOTICE: Config file "…/rclone.conf" not found - using defaults` on EVERY
# invocation when there is no config file, which for the recommended env-var setup is every
# invocation forever: three NOTICE lines per cycle in the log an operator is supposed to be able
# to scan for the word ERROR. `--config=` tells rclone the config is deliberately env-only and
# silences it. Only when the operator has said nothing about a config file, though: an
# RCLONE_CONFIG they set, or a conf mounted at the default path, must keep working untouched.
RCLONE_CONFIG_ARG=""
if [ -z "${RCLONE_CONFIG:-}" ] && [ ! -f "${HOME:-/root}/.config/rclone/rclone.conf" ]; then
  RCLONE_CONFIG_ARG="--config="
fi

# The freshness stamp the compose healthcheck reads. Touched only after a cycle's archives have
# actually landed on the remote, so its mtime is the age of the newest OFF-HOST copy, not of the
# newest local one. Also a dot file, for the same reason as the cache above.
REMOTE_STAMP="$BACKUP_DIR/.offhost-stamp"

log() {
  # Same shape as the API's access log: UTC, one line, greppable.
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"
}

# One timestamp per cycle, shared by both archives of that cycle. It lives outside take_dump
# because the person restoring answers "which tar belongs to which dump" by reading the names.
#
# Two cycles inside the same second (a rotation test, back-to-back manual runs) would collide on
# the name. Wait for the next second rather than disambiguating with a suffix: that keeps every
# archive name strictly increasing, which is what makes the name sort in prune_pattern() a
# chronological sort. Time only moves forward, so this cannot spin.
next_stamp() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  while [ -e "$BACKUP_DIR/kurul-$stamp.dump" ] ||
    [ -e "$BACKUP_DIR/kurul-$stamp-files.tar.gz" ]; do
    sleep 1
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
  done
  echo "$stamp"
}

# Write to a .part file first and rename only on success. A dump interrupted by a container
# stop therefore never looks like a finished archive, and never survives rotation as one.
take_dump() {
  target="$BACKUP_DIR/kurul-$1.dump"

  if pg_dump --format=custom --file="$target.part" "$PGDATABASE"; then
    mv "$target.part" "$target"
    log "wrote $target ($(wc -c <"$target" | tr -d ' ') bytes)"
    return 0
  fi

  # A failed dump must not take the sidecar down with it — the database may just be
  # restarting. Drop the partial file, report, and let the next cycle try again.
  rm -f "$target.part"
  log "ERROR pg_dump failed against $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
  return 1
}

# The uploaded attachment files, beside the dump they belong to. Skipped entirely when
# ATTACHMENT_DIR is unset — an instance with STORAGE_PATH unset stores no files, and an empty
# tar every night would be a recovery point that restores nothing.
#
# Same .part-then-rename discipline as take_dump, and the same limit stated at the top of this
# file: that discipline hides a half-written ARCHIVE, not a half-written FILE.
take_files() {
  [ -n "$ATTACHMENT_DIR" ] || return 0
  [ -d "$ATTACHMENT_DIR" ] || {
    log "ERROR ATTACHMENT_DIR=$ATTACHMENT_DIR is not a directory"
    return 1
  }

  target="$BACKUP_DIR/kurul-$1-files.tar.gz"

  if tar -czf "$target.part" -C "$ATTACHMENT_DIR" .; then
    mv "$target.part" "$target"
    log "wrote $target ($(wc -c <"$target" | tr -d ' ') bytes)"
    return 0
  fi

  rm -f "$target.part"
  log "ERROR tar failed against $ATTACHMENT_DIR"
  return 1
}

# Keep the newest BACKUP_KEEP archives matching one pattern, delete the rest. Names are ISO-8601
# basic UTC, so a reverse lexicographic sort is a reverse chronological sort. `.part` files are
# not matched.
#
# shellcheck disable=SC2086 # $1 is a glob and has to be expanded by ls, not passed as one word
prune_pattern() {
  ls -1 "$BACKUP_DIR"/$1 2>/dev/null | sort -r | tail -n "+$((BACKUP_KEEP + 1))" |
    while IFS= read -r old; do
      rm -f "$old"
      log "pruned $old"
    done
}

# Both series are pruned to the SAME BACKUP_KEEP. Separate counts would break the API's orphan
# sweep, whose grace period is BACKUP_KEEP × BACKUP_INTERVAL and assumes one retention window,
# not two — a file series kept for fewer cycles than the dump series would let the sweep delete
# files a restorable dump still knows nothing about.
#
# `kurul-*.dump` and `kurul-*-files.tar.gz` cannot match each other's files, so the two
# passes are independent even though the dump glob looks broader than it is.
prune() {
  prune_pattern "kurul-*.dump"
  prune_pattern "kurul-*-files.tar.gz"
}

# Seconds since the newest finished dump was written; fails when there is none, or when the
# mtime cannot be read, and the caller then takes a dump, i.e. behaves as this script always
# did. Newest by NAME, the same sort prune_pattern() trusts, not `ls -t`. The mtime rather than
# the timestamp in the name because parsing that back into seconds is a different `date` on
# every libc; `stat -c %Y` is GNU and BusyBox (postgres:18-alpine, where this runs), `stat -f %m`
# is BSD, which is what the test suite meets on a macOS laptop.
newest_dump_age() {
  newest=$(ls -1 "$BACKUP_DIR"/kurul-*.dump 2>/dev/null | sort -r | head -n 1)
  [ -n "$newest" ] || return 1
  mtime=$(stat -c %Y "$newest" 2>/dev/null || stat -f %m "$newest" 2>/dev/null) || return 1
  [ -n "$mtime" ] || return 1
  echo $(($(date +%s) - mtime))
}

# --- off-host copy (everything below is dead code while BACKUP_REMOTE is unset) --------------

# An rclone the operator already supplied always wins: a derived image with the distro package
# in it, a binary bind-mounted onto the PATH, an air-gapped host that cannot reach
# downloads.rclone.org at all. Only when there is none does this download the pinned static
# build, verify its sha256 BEFORE unpacking it, and cache it in the backup volume so a restart
# loop cannot turn into a download loop.
#
# Why not a dedicated image for this sidecar: docs/self-hosting.md installs by curl-ing
# docker-compose.yml, .env and this very script onto a host with no source tree. A `build:`-only
# backup image cannot be built there (audit finding OPS-01 was exactly that failure mode for the
# migrate service), and a published one would leave every existing install unable to pull an
# image its compose file suddenly required. Fetching on demand keeps the default install on
# stock postgres:18-alpine, byte for byte as before, and costs the instances that opted in one
# ~20 MB download on their first cycle (~78 MB unpacked in the backup volume, once).
#
# The cached binary is named after its version, so a version bump is a different file rather
# than an in-place overwrite of a running one. `$RCLONE_CACHE/rclone` is a symlink onto whichever
# version is current, purely so the restore instructions in docs/self-hosting.md can name one
# stable path that does not go stale the next time the pin moves.
link_rclone() {
  ln -sf "$(basename "$RCLONE_BIN")" "$RCLONE_CACHE/rclone" 2>/dev/null || true
}

ensure_rclone() {
  [ -z "$RCLONE_BIN" ] || return 0

  if command -v rclone >/dev/null 2>&1; then
    RCLONE_BIN=$(command -v rclone)
    log "off-host: using rclone from PATH ($RCLONE_BIN)"
    return 0
  fi

  cached="$RCLONE_CACHE/rclone-v$RCLONE_VERSION"
  if [ -x "$cached" ]; then
    RCLONE_BIN="$cached"
    link_rclone
    return 0
  fi

  case "$(uname -m)" in
    x86_64 | amd64) rc_arch="amd64" rc_sum="$RCLONE_SHA256_AMD64" ;;
    aarch64 | arm64) rc_arch="arm64" rc_sum="$RCLONE_SHA256_ARM64" ;;
    armv7l | armv7) rc_arch="arm-v7" rc_sum="$RCLONE_SHA256_ARMV7" ;;
    *)
      log "ERROR off-host: no pinned rclone build for $(uname -m); install rclone into the image or drop a binary on the PATH"
      return 1
      ;;
  esac

  rc_zip="rclone-v$RCLONE_VERSION-linux-$rc_arch.zip"
  rc_tmp="$RCLONE_CACHE/.fetch.$$"
  # The cache directory is created here rather than beside `mkdir -p "$BACKUP_DIR"` below on
  # purpose: whatever goes wrong with the off-host half must never come between this script and
  # a LOCAL recovery point, and a top-level mkdir under `set -e` would do exactly that.
  mkdir -p "$rc_tmp" || {
    log "ERROR off-host: cannot create the rclone cache at $RCLONE_CACHE"
    return 1
  }

  log "off-host: fetching rclone v$RCLONE_VERSION ($rc_arch), one time, into $RCLONE_CACHE"
  if ! wget -q -O "$rc_tmp/$rc_zip" "https://downloads.rclone.org/v$RCLONE_VERSION/$rc_zip"; then
    rm -rf "$rc_tmp"
    log "ERROR off-host: could not download $rc_zip"
    return 1
  fi

  # Verified before anything in the archive is unpacked, let alone executed.
  if ! (cd "$rc_tmp" && echo "$rc_sum  $rc_zip" | sha256sum -c - >/dev/null 2>&1); then
    rm -rf "$rc_tmp"
    log "ERROR off-host: sha256 mismatch on $rc_zip, refusing to run it"
    return 1
  fi

  if ! unzip -p "$rc_tmp/$rc_zip" "rclone-v$RCLONE_VERSION-linux-$rc_arch/rclone" >"$rc_tmp/rclone"; then
    rm -rf "$rc_tmp"
    log "ERROR off-host: could not unpack rclone from $rc_zip"
    return 1
  fi

  chmod 0755 "$rc_tmp/rclone"
  # Rename into place, same discipline as the archives: a half-written binary is never at the
  # path the next cycle checks with -x.
  mv "$rc_tmp/rclone" "$cached"
  rm -rf "$rc_tmp"
  RCLONE_BIN="$cached"
  link_rclone
  log "off-host: rclone v$RCLONE_VERSION ready"
}

# Keep the newest BACKUP_KEEP remote archives of one series, delete the rest. Deliberately the
# same name-sort as prune_pattern() rather than `rclone delete --min-age`: the sort can only ever
# reach files that already have BACKUP_KEEP newer siblings, so the archive uploaded seconds ago
# is unreachable by construction. An age rule would decide by mtime, which for a re-uploaded or
# clock-skewed archive can be older than the file itself, i.e. it can delete what was just put
# there.
#
# shellcheck disable=SC2086 # $RCLONE_CONFIG_ARG is one optional flag or nothing, never a word
prune_remote_pattern() {
  "$RCLONE_BIN" $RCLONE_CONFIG_ARG lsf --files-only --include "$1" "$BACKUP_REMOTE" 2>/dev/null |
    sort -r | tail -n "+$((BACKUP_KEEP + 1))" |
    while IFS= read -r old; do
      if "$RCLONE_BIN" $RCLONE_CONFIG_ARG deletefile "$BACKUP_REMOTE/$old" >/dev/null 2>&1; then
        log "off-host: pruned $BACKUP_REMOTE/$old"
      else
        log "ERROR off-host: could not prune $BACKUP_REMOTE/$old"
      fi
    done
}

# Push this cycle's archives, then prune the remote, then stamp. Called after the local half has
# finished, so a failure here can never cost a local archive: nothing in this function deletes
# anything under BACKUP_DIR, and the local prune has already run against files that are on disk
# whatever the network did.
#
# shellcheck disable=SC2086 # $RCLONE_CONFIG_ARG is one optional flag or nothing, never a word
push_remote() {
  [ -n "$BACKUP_REMOTE" ] || return 0
  ensure_rclone || return 1

  pushed=0
  failed=0
  for name in "kurul-$1.dump" "kurul-$1-files.tar.gz"; do
    src="$BACKUP_DIR/$name"
    # A missing half is not a failure here; take_dump/take_files already logged why it is
    # missing (a failed dump, or ATTACHMENT_DIR unset), and this function does not repeat it.
    [ -f "$src" ] || continue

    if "$RCLONE_BIN" $RCLONE_CONFIG_ARG copyto --retries 3 --low-level-retries 5 "$src" "$BACKUP_REMOTE/$name"; then
      log "off-host: pushed $name to $BACKUP_REMOTE"
      pushed=$((pushed + 1))
    else
      log "ERROR off-host: rclone failed to push $name to $BACKUP_REMOTE (the local archive is untouched, the OFF-HOST COPY IS NOW STALE)"
      failed=$((failed + 1))
    fi
  done

  if [ "$failed" -ne 0 ] || [ "$pushed" -eq 0 ]; then
    # No stamp. The healthcheck below turns this into an unhealthy container once the newest
    # off-host copy passes 2×BACKUP_INTERVAL, which is the whole point of having a stamp rather
    # than trusting the log nobody reads.
    [ "$pushed" -eq 0 ] && [ "$failed" -eq 0 ] &&
      log "ERROR off-host: cycle $1 produced no archive to push"
    return 1
  fi

  prune_remote_pattern "kurul-*.dump"
  prune_remote_pattern "kurul-*-files.tar.gz"

  # Last, and only on success: the stamp is a claim that a complete cycle is off-host. Same
  # shape as the `demo-reset` sidecar's /tmp/kurul-demo-reset.stamp in docker-compose.yml, which
  # is also touched only on a successful run and also read back by a `find -mmin` healthcheck.
  touch "$REMOTE_STAMP"
}

mkdir -p "$BACKUP_DIR"

if [ "${1:-}" = "once" ]; then
  cycle_stamp=$(next_stamp)
  take_dump "$cycle_stamp"
  take_files "$cycle_stamp"
  prune
  # No `|| true` here, unlike the loop below: a hand-run backup that never reached the remote
  # exits non-zero so the operator taking a pre-upgrade recovery point finds out now.
  push_remote "$cycle_stamp"
  exit 0
fi

log "starting: every ${BACKUP_INTERVAL}s, keeping ${BACKUP_KEEP} archives of each series in $BACKUP_DIR${ATTACHMENT_DIR:+ (files from $ATTACHMENT_DIR)}${BACKUP_REMOTE:+, mirrored to $BACKUP_REMOTE}"

# Exit promptly on `docker compose stop` instead of sitting out the rest of the sleep: the
# sleep runs in the background and `wait` is interruptible by a trapped signal.
trap 'log "stopping"; exit 0' INT TERM

# A container start is not a backup cycle. Every host reboot, `docker compose down`/`up`,
# `restart` and image pull starts this sidecar afresh, and the loop below used to take a pair on
# entry every time. Retention is a COUNT (prune() keeps the newest BACKUP_KEEP by name, with no
# age check), so each of those pairs pushed the oldest one out: a day of restarts left a week's
# worth of slots holding dumps of the same day and no yesterday. So when a dump younger than
# half an interval already exists the first pass is skipped, and the sleep before the next one
# is only what is left of the interval, which keeps the cadence, the RPO the docs promise and the
# API's BACKUP_KEEP × BACKUP_INTERVAL orphan-sweep window exactly what they were before the
# restart. Half, not a whole interval: a dump older than that is nearer the next scheduled one
# than the last, and taking it now buys a fresher recovery point for the slot it costs. The
# `once` mode above is unconditional on purpose, see its usage note.
#
# A very first boot has no dump and takes one immediately, which is the case the backup
# healthcheck's `start_period` in docker-compose.yml is sized for.
age=$(newest_dump_age) || age=""
if [ -n "$age" ] && [ "$age" -ge 0 ] && [ "$age" -lt $((BACKUP_INTERVAL / 2)) ]; then
  log "skipping the boot-time cycle: the newest dump is ${age}s old, next cycle in $((BACKUP_INTERVAL - age))s"
  sleep "$((BACKUP_INTERVAL - age))" &
  wait $!
fi

while true; do
  cycle_stamp=$(next_stamp)
  # `|| true` on both: one failing half must not take the sidecar down, and must not stop the
  # other half from producing a recovery point either. The ERROR line says which one it was.
  take_dump "$cycle_stamp" || true
  take_files "$cycle_stamp" || true
  prune
  # Same `|| true` reasoning as the two halves above, and one more: a network that is down must
  # not stop the LOCAL recovery points from being taken. The missing stamp is what escalates a
  # run of failed pushes, not this exit code.
  push_remote "$cycle_stamp" || true
  sleep "$BACKUP_INTERVAL" &
  wait $!
done
