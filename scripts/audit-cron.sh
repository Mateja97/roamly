#!/usr/bin/env bash
# Scheduled entry point for /run-audit-auto (see docs/agent-pipeline.md).
#
# Runs headless and guards itself, because the failure modes of an unattended
# audit are all silent: a second run racing the first, a run that trips its own
# Phase 0 clean-tree gate forever, or one that probes a stack that isn't there.
# Every guard below SKIPS rather than forces — a skipped week is recoverable,
# a corrupted checkout is not.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO/pipeline/bugs/cron"
LOCK="$LOG_DIR/.lock"
LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M).log"
CLAUDE="${CLAUDE_BIN:-claude}"

mkdir -p "$LOG_DIR"
exec >>"$LOG" 2>&1
echo "=== audit-cron $(date -Iseconds) ==="

# ponytail: mkdir is the lock — atomic on every filesystem, no flock dependency.
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "SKIP: a previous run still holds $LOCK"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

cd "$REPO" || { echo "FAIL: cannot cd to $REPO"; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  echo "SKIP: working tree dirty — Phase 0 would stop anyway, and this run must not"
  echo "      touch someone's uncommitted work:"
  git status --porcelain | sed 's/^/      /'
  exit 0
fi

# The command only exists on branches that carry it; a checkout parked on an
# older branch would otherwise fail deep inside the run instead of here.
if [ ! -f .claude/commands/run-audit-auto.md ]; then
  echo "SKIP: .claude/commands/run-audit-auto.md not present on $(git branch --show-current)"
  exit 0
fi

if ! docker compose ps --status running --quiet | grep -q .; then
  echo "SKIP: stack is not running — not starting it unattended"
  exit 0
fi

echo "--- starting /run-audit-auto on $(git branch --show-current) @ $(git rev-parse --short HEAD)"
"$CLAUDE" -p "/run-audit-auto" --model sonnet
echo "=== exit $? at $(date -Iseconds) ==="
