#!/usr/bin/env bash
#
# check-engine-sync.sh — fail the build if the app's port of the screen
# engine has drifted from the sandbox source of truth.
#
# Discipline: any engine change lands in BOTH repos in the same commit.
# This script enforces that by diffing the two trees and exiting non-zero
# on any difference.
#
# Usage:
#   ./scripts/check-engine-sync.sh
#
# Assumes the sandbox repo is checked out as a sibling at:
#   ../../CaseLoadScreen_2.0_2026-05-03/
# relative to this script (i.e. both repos live under
# D:\00_Work\01_CaseLoad_Select\ in the canonical layout).
#
# Override via env var if your layout differs:
#   SANDBOX_REPO=/path/to/CaseLoadScreen_2.0_2026-05-03 ./scripts/check-engine-sync.sh
#
# CI invocation example:
#   - name: Verify engine sync
#     run: bash scripts/check-engine-sync.sh

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_REPO="$( cd "$SCRIPT_DIR/.." && pwd )"

# Default to sibling layout: D:\00_Work\01_CaseLoad_Select\
# - 05_Product\caseload-select-app\ (this app, where the script lives)
# - CaseLoadScreen_2.0_2026-05-03\ (sandbox, source of truth)
DEFAULT_SANDBOX="$APP_REPO/../../CaseLoadScreen_2.0_2026-05-03"
SANDBOX_REPO="${SANDBOX_REPO:-$DEFAULT_SANDBOX}"

APP_ENGINE="$APP_REPO/src/lib/screen-engine"
SANDBOX_ENGINE="$SANDBOX_REPO/src/engine"

if [ ! -d "$SANDBOX_ENGINE" ]; then
  echo "ERROR: sandbox engine not found at: $SANDBOX_ENGINE"
  echo "Override the path with: SANDBOX_REPO=/path/to/sandbox ./scripts/check-engine-sync.sh"
  exit 2
fi

if [ ! -d "$APP_ENGINE" ]; then
  echo "ERROR: app engine port not found at: $APP_ENGINE"
  exit 2
fi

echo "Comparing:"
echo "  app:     $APP_ENGINE"
echo "  sandbox: $SANDBOX_ENGINE"
echo

# Files with legitimate per-repo divergence — excluded from byte-for-byte check.
# Add a file here only when the divergence is structural (different
# responsibilities) and explicitly documented. Do NOT add files just because
# they happen to differ — port them instead.
#
#   persist.ts: sandbox POSTs to /api/intake-v2 (web widget SPA); app inserts
#               directly to Supabase. Different runtime targets, different
#               code. See sandbox CLAUDE.md ("persist.ts — /api/intake-v2
#               POST (web only; sims don't persist)").
EXCLUDED_FILES=(
  "persist.ts"
)

# Build an exclude expression for find. We compare each non-excluded file
# manually so we can use --strip-trailing-cr (ignore LF vs CRLF drift).
# Line-ending drift is cosmetic — both files compile and run identically.
# The byte-for-byte intent is about logical content, not line terminators.
EXCLUDE_PATTERN=""
for f in "${EXCLUDED_FILES[@]}"; do
  EXCLUDE_PATTERN+=" -not -name $f"
done

set +e
DRIFT=()
while IFS= read -r -d '' app_file; do
  rel="${app_file#$APP_ENGINE/}"
  sb_file="$SANDBOX_ENGINE/$rel"
  if [ ! -f "$sb_file" ]; then
    DRIFT+=("MISSING IN SANDBOX: $rel")
    continue
  fi
  # --strip-trailing-cr makes diff ignore CRLF vs LF.
  if ! diff -q --strip-trailing-cr "$app_file" "$sb_file" > /dev/null 2>&1; then
    DRIFT+=("CONTENT DIFFERS: $rel")
  fi
done < <(find "$APP_ENGINE" -type f \( -name "*.ts" -o -name "*.json" \) -not -path "*/__tests__/*" $EXCLUDE_PATTERN -print0)

# Also flag files in sandbox that don't exist in app.
while IFS= read -r -d '' sb_file; do
  rel="${sb_file#$SANDBOX_ENGINE/}"
  app_file="$APP_ENGINE/$rel"
  if [ ! -f "$app_file" ]; then
    DRIFT+=("MISSING IN APP: $rel")
  fi
done < <(find "$SANDBOX_ENGINE" -type f \( -name "*.ts" -o -name "*.json" \) -not -path "*/__tests__/*" $EXCLUDE_PATTERN -print0)
set -e

if [ ${#DRIFT[@]} -eq 0 ]; then
  echo "OK: app/src/lib/screen-engine/ matches sandbox/src/engine/ (content; line endings ignored; persist.ts excluded by design)."
  exit 0
fi

echo "FAIL: engine port has drifted from the sandbox source of truth."
echo
printf '  %s\n' "${DRIFT[@]}"
echo
echo "Discipline: engine changes must land in BOTH repos in the same commit."
echo "  sandbox: $SANDBOX_ENGINE"
echo "  app:     $APP_ENGINE"
echo
echo "Note: line-ending drift (LF vs CRLF) is ignored. persist.ts is excluded by design."
echo
echo "Fix: re-port the sandbox engine into the app, then re-run this script:"
echo "  cp -r \"$SANDBOX_ENGINE/\".  \"$APP_ENGINE/\""
echo
exit 1
