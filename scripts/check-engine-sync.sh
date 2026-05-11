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

# Run a recursive diff. -q is "report only differing files, not contents."
# diff returns 1 when files differ, 0 when identical, 2 for errors.
set +e
DIFF_OUT="$(diff -rq "$SANDBOX_ENGINE" "$APP_ENGINE" 2>&1)"
DIFF_STATUS=$?
set -e

if [ $DIFF_STATUS -eq 0 ]; then
  echo "OK: app/src/lib/screen-engine/ matches sandbox/src/engine/ byte-for-byte."
  exit 0
fi

echo "FAIL: engine port has drifted from the sandbox source of truth."
echo
echo "$DIFF_OUT"
echo
echo "Discipline: engine changes must land in BOTH repos in the same commit."
echo "  sandbox: $SANDBOX_ENGINE"
echo "  app:     $APP_ENGINE"
echo
echo "Fix: re-port the sandbox engine into the app, then re-run this script:"
echo "  cp -r \"$SANDBOX_ENGINE/\".  \"$APP_ENGINE/\""
echo
exit 1
