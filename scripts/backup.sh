#!/bin/sh
#
# Scheduled logical backups for the Kurultay database.
#
# Runs as the `backup` sidecar in docker-compose.yml (image: postgres:18-alpine, so pg_dump
# always matches the server major). Every BACKUP_INTERVAL seconds it writes one
# `pg_dump -Fc` archive into BACKUP_DIR and prunes the directory down to BACKUP_KEEP
# archives, newest kept.
#
# Usage:
#   backup.sh          # loop forever: dump, prune, sleep BACKUP_INTERVAL, repeat
#   backup.sh once     # take exactly one dump, prune, exit (manual/ad-hoc backup, and what
#                      # the restore drill in docs/development.md uses)
#
# Configuration (all optional except the password):
#   PGHOST           postgres        # in-network address of the database server
#   PGPORT           5432
#   PGUSER           kurultay
#   PGDATABASE       kurultay
#   PGPASSWORD       -               # required; passed by compose, read by pg_dump directly
#   BACKUP_DIR       /backups        # the backup_data named volume
#   BACKUP_INTERVAL  86400           # seconds between dumps (86400 = daily -> RPO <= 24h)
#   BACKUP_KEEP      7               # how many archives to retain
#
# Restore is `pg_restore`, not `psql` — see docs/development.md#upgrading-and-backups for
# the full, rehearsed procedure.

set -eu

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-kurultay}"
PGDATABASE="${PGDATABASE:-kurultay}"
export PGHOST PGPORT PGUSER PGDATABASE

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-86400}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"

log() {
  # Same shape as the API's access log: UTC, one line, greppable.
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"
}

# Write to a .part file first and rename only on success. A dump interrupted by a container
# stop therefore never looks like a finished archive, and never survives rotation as one.
take_dump() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  target="$BACKUP_DIR/kurultay-$stamp.dump"

  # Two dumps inside the same second (a rotation test, back-to-back manual runs) would
  # collide on the name. Wait for the next second rather than disambiguating with a suffix:
  # that keeps every archive name strictly increasing, which is what makes the name sort in
  # prune() a chronological sort. Time only moves forward, so this cannot spin.
  while [ -e "$target" ]; do
    sleep 1
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    target="$BACKUP_DIR/kurultay-$stamp.dump"
  done

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

# Keep the newest BACKUP_KEEP archives, delete the rest. Names are ISO-8601 basic UTC, so a
# reverse lexicographic sort is a reverse chronological sort. `.part` files are not matched.
prune() {
  ls -1 "$BACKUP_DIR"/kurultay-*.dump 2>/dev/null | sort -r | tail -n "+$((BACKUP_KEEP + 1))" |
    while IFS= read -r old; do
      rm -f "$old"
      log "pruned $old"
    done
}

mkdir -p "$BACKUP_DIR"

if [ "${1:-}" = "once" ]; then
  take_dump
  prune
  exit 0
fi

log "starting: every ${BACKUP_INTERVAL}s, keeping ${BACKUP_KEEP} archives in $BACKUP_DIR"

# Exit promptly on `docker compose stop` instead of sitting out the rest of the sleep: the
# sleep runs in the background and `wait` is interruptible by a trapped signal.
trap 'log "stopping"; exit 0' INT TERM

while true; do
  take_dump || true
  prune
  sleep "$BACKUP_INTERVAL" &
  wait $!
done
