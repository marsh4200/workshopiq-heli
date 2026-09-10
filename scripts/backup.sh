#!/usr/bin/env bash
#
# WorkshopIQ backup — dumps the database and archives uploads.
# Output: backups/workshopiq-backup-YYYYmmdd-HHMMSS.tar.gz
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

# Load env
set -a
[ -f .env ] && . ./.env
set +a
PGUSER="${POSTGRES_USER:-workshopiq}"
PGDB="${POSTGRES_DB:-workshopiq}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${ROOT_DIR}/backups"
WORK="${BACKUP_DIR}/tmp-${TS}"
mkdir -p "$WORK"

echo "==> Dumping database…"
$COMPOSE exec -T db pg_dump -U "$PGUSER" "$PGDB" > "${WORK}/database.sql"

echo "==> Archiving uploads…"
docker run --rm \
  -v workshopiq_uploads_data:/data:ro \
  -v "${WORK}:/backup" \
  alpine sh -c "tar czf /backup/uploads.tar.gz -C /data . || true"

OUT="${BACKUP_DIR}/workshopiq-backup-${TS}.tar.gz"
tar czf "$OUT" -C "$WORK" database.sql uploads.tar.gz
rm -rf "$WORK"

echo "==> Backup written to: $OUT"

# --- Retention -------------------------------------------------------------
# Keep only the newest BACKUP_KEEP archives so update backups don't pile up
# forever and eat disk. Set BACKUP_KEEP=0 to disable pruning (keep everything).
KEEP="${BACKUP_KEEP:-2}"
if [ "$KEEP" -gt 0 ] 2>/dev/null; then
  OLD="$(ls -1t "${BACKUP_DIR}"/workshopiq-backup-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" || true)"
  if [ -n "$OLD" ]; then
    echo "==> Pruning old backups (keeping newest ${KEEP}):"
    echo "$OLD" | while IFS= read -r f; do
      [ -n "$f" ] && rm -f "$f" && echo "    removed $(basename "$f")"
    done
  fi
fi
