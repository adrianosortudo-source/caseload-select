#!/usr/bin/env bash
#
# backup-supabase.sh — Manual weekly backup discipline for the Supabase
# production project. Free-tier Supabase does not include automated
# backups, so this script fills the gap.
#
# What it does
#   * Dumps the `public` + `cron_internal` schemas of the production
#     project (DDL + data, --no-owner --no-privileges).
#   * Writes the dump to ./backups/supabase-{YYYY-MM-DD-HHMM}.sql
#   * Rotates the directory: keeps the 8 most recent dumps.
#
# What it does NOT do
#   * Migrate Auth users (not in use; 0 rows at time of writing)
#   * Migrate Vault secrets (extension-managed, opaque)
#   * Migrate Storage objects (S3-backed, not in pg_dump output)
#   * Push to remote storage (consider piping to S3 / Backblaze later)
#
# Usage
#   ./scripts/backup-supabase.sh
#
#   Requires SUPABASE_DB_URL in env. Recommended source:
#     export SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-N-region.pooler.supabase.com:5432/postgres"
#
#   The session pooler URL is in Supabase Dashboard → Connect → Session pooler.
#   The DB password is set in Settings → Database → Reset password.
#
# Recommended cadence
#   Weekly via Windows Task Scheduler (or cron on a Linux box):
#     0 3 * * 1  /path/to/scripts/backup-supabase.sh >> /path/to/backups/backup.log 2>&1
#
# Safety
#   The dump file contains sensitive customer data. Backups directory is
#   gitignored. Encrypt at rest if you ever move the directory off your
#   primary workstation (e.g., to external drive or cloud sync).

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
KEEP_COUNT="${KEEP_COUNT:-8}"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL is not set." >&2
  echo "" >&2
  echo "Set it via:" >&2
  echo '  export SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-N-region.pooler.supabase.com:5432/postgres"' >&2
  echo "" >&2
  echo "The session pooler URL is in Supabase Dashboard → Connect → Session pooler." >&2
  exit 2
fi

# ── Verify pg_dump is available ──────────────────────────────────────────────
if ! command -v pg_dump > /dev/null 2>&1; then
  # Common Windows install location after `winget install PostgreSQL.PostgreSQL.17`
  if [ -x "/c/Program Files/PostgreSQL/17/bin/pg_dump" ]; then
    export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
  elif [ -x "/c/Program Files/PostgreSQL/16/bin/pg_dump" ]; then
    export PATH="/c/Program Files/PostgreSQL/16/bin:$PATH"
  else
    echo "ERROR: pg_dump not found on PATH." >&2
    echo "Install via 'winget install PostgreSQL.PostgreSQL.17' (Windows) or 'apt install postgresql-client-17' (Linux)." >&2
    exit 2
  fi
fi

# ── Run the dump ─────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y-%m-%d-%H%M)"
OUT_FILE="$BACKUP_DIR/supabase-${TIMESTAMP}.sql"

echo "Backing up Supabase project → $OUT_FILE"

pg_dump "$SUPABASE_DB_URL" \
  --schema=public \
  --schema=cron_internal \
  --no-owner --no-privileges \
  --no-publications --no-subscriptions \
  -f "$OUT_FILE"

SIZE="$(wc -c < "$OUT_FILE" | tr -d ' ')"
LINES="$(wc -l < "$OUT_FILE" | tr -d ' ')"
echo "  wrote $SIZE bytes, $LINES lines"

# ── Rotate: keep most recent KEEP_COUNT ──────────────────────────────────────
cd "$BACKUP_DIR"
COUNT=$(ls -1 supabase-*.sql 2>/dev/null | wc -l | tr -d ' ')
if [ "$COUNT" -gt "$KEEP_COUNT" ]; then
  TO_DELETE=$((COUNT - KEEP_COUNT))
  echo "Rotating: $COUNT backups present, keeping $KEEP_COUNT (deleting oldest $TO_DELETE)"
  ls -1t supabase-*.sql | tail -n "$TO_DELETE" | while read -r old; do
    echo "  rm $old"
    rm -- "$old"
  done
fi

echo "OK. $(ls -1 supabase-*.sql 2>/dev/null | wc -l | tr -d ' ') backups in $BACKUP_DIR."
