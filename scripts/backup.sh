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
#   backup.sh          # loop forever: dump, archive, prune, sleep BACKUP_INTERVAL, repeat
#   backup.sh once     # take exactly one of each, prune, exit (manual/ad-hoc backup, and what
#                      # the restore drill in docs/development.md uses)
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

mkdir -p "$BACKUP_DIR"

if [ "${1:-}" = "once" ]; then
  cycle_stamp=$(next_stamp)
  take_dump "$cycle_stamp"
  take_files "$cycle_stamp"
  prune
  exit 0
fi

log "starting: every ${BACKUP_INTERVAL}s, keeping ${BACKUP_KEEP} archives of each series in $BACKUP_DIR${ATTACHMENT_DIR:+ (files from $ATTACHMENT_DIR)}"

# Exit promptly on `docker compose stop` instead of sitting out the rest of the sleep: the
# sleep runs in the background and `wait` is interruptible by a trapped signal.
trap 'log "stopping"; exit 0' INT TERM

while true; do
  cycle_stamp=$(next_stamp)
  # `|| true` on both: one failing half must not take the sidecar down, and must not stop the
  # other half from producing a recovery point either. The ERROR line says which one it was.
  take_dump "$cycle_stamp" || true
  take_files "$cycle_stamp" || true
  prune
  sleep "$BACKUP_INTERVAL" &
  wait $!
done
