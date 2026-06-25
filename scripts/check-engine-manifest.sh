#!/usr/bin/env bash
#
# check-engine-manifest.sh — CI-safe engine-sync gate (DR-058).
#
# GitHub Actions cannot run check-engine-sync.sh because the sandbox source
# of truth lives on disk and is not in version control. This script is the
# CI substitute: it recomputes the engine fingerprint and compares it to the
# committed scripts/engine-sync.manifest. No sandbox required.
#
# A mismatch means an engine file under src/lib/screen-engine/ was changed
# without the sync ritual (which refreshes the manifest). The fix is to run
# the real check locally:
#   npm run check:engine-sync   # verifies app == sandbox AND refreshes the manifest
# then commit the updated scripts/engine-sync.manifest alongside the engine change.
#
# Exit codes: 0 = in sync, 1 = drift, 2 = env/layout problem.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_ENGINE="$( cd "$SCRIPT_DIR/.." && pwd )/src/lib/screen-engine"
MANIFEST="$SCRIPT_DIR/engine-sync.manifest"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: manifest missing: $MANIFEST"
  echo "Generate it with: bash scripts/gen-engine-manifest.sh"
  exit 2
fi
if [ ! -d "$APP_ENGINE" ]; then
  echo "ERROR: engine dir missing: $APP_ENGINE"
  exit 2
fi

# Recompute into a temp file using the single shared generator, so the
# format can never drift between generation and verification.
TMP="$( mktemp )"
trap 'rm -f "$TMP"' EXIT
bash "$SCRIPT_DIR/gen-engine-manifest.sh" "$TMP"

# Strip CR on read so a CRLF-checked-out manifest still compares clean.
COMMITTED="$( tr -d '\r' < "$MANIFEST" )"
CURRENT="$( cat "$TMP" )"

if [ "$COMMITTED" = "$CURRENT" ]; then
  echo "OK: src/lib/screen-engine matches scripts/engine-sync.manifest ($( wc -l < "$MANIFEST" | tr -d ' ' ) files)."
  exit 0
fi

echo "FAIL: src/lib/screen-engine has changed but scripts/engine-sync.manifest was not regenerated."
echo
diff <( printf '%s\n' "$COMMITTED" ) <( printf '%s\n' "$CURRENT" ) || true
echo
echo "An engine file changed without the sync ritual. Locally run:"
echo "  npm run check:engine-sync   # verifies app == sandbox AND refreshes the manifest"
echo "then commit the updated scripts/engine-sync.manifest with your engine change."
echo "(If this was an intentional engine edit, the same ritual regenerates the manifest.)"
exit 1
