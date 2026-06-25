#!/usr/bin/env bash
#
# gen-engine-manifest.sh — write a content fingerprint of the app's screen
# engine port to scripts/engine-sync.manifest.
#
# This manifest is the CI-visible proxy for the sandbox source of truth.
# GitHub Actions can't see the sandbox (it lives on disk, not in git), so
# check-engine-manifest.sh diffs the live engine against this committed
# fingerprint instead. The fingerprint is only ever refreshed by
# check-engine-sync.sh on success (i.e. once app == sandbox is verified
# locally), so a current manifest means "this content matched the sandbox".
#
# DR-058 (engine-sync CI gate). Single source of truth for the manifest
# format — both the bash and PowerShell sync scripts call this one.
#
# Usage:
#   bash scripts/gen-engine-manifest.sh            # writes the committed manifest
#   bash scripts/gen-engine-manifest.sh /tmp/out   # writes elsewhere (used by the checker)
#
# Format: one line per engine file, "<sha256>  <relpath>", sorted by
# relpath (LC_ALL=C), LF terminated. Hash is over the file content with
# CR stripped, so LF vs CRLF drift is ignored (matches check-engine-sync).

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_ENGINE="$( cd "$SCRIPT_DIR/.." && pwd )/src/lib/screen-engine"

# Resolve the output path to absolute BEFORE we cd into the engine dir.
if [ "$#" -ge 1 ]; then
  OUT_DIR="$( cd "$( dirname "$1" )" && pwd )"
  OUT="$OUT_DIR/$( basename "$1" )"
else
  OUT="$SCRIPT_DIR/engine-sync.manifest"
fi

if [ ! -d "$APP_ENGINE" ]; then
  echo "ERROR: engine dir missing: $APP_ENGINE" >&2
  exit 2
fi

cd "$APP_ENGINE"

# Same selection as check-engine-sync.sh: *.ts / *.json under the engine,
# excluding __tests__ fixtures and persist.ts (legitimate per-repo divergence).
find . -type f \( -name '*.ts' -o -name '*.json' \) -not -path '*/__tests__/*' -not -name 'persist.ts' -print0 \
  | while IFS= read -r -d '' f; do printf '%s\n' "${f#./}"; done \
  | LC_ALL=C sort \
  | while IFS= read -r rel; do
      hash="$( tr -d '\r' < "$rel" | sha256sum | cut -d' ' -f1 )"
      printf '%s  %s\n' "$hash" "$rel"
    done > "$OUT"
