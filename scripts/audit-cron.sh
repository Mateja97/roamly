#!/usr/bin/env bash
# Scheduled entry point for /run-audit-auto (see docs/agent-pipeline.md).
#
# Runs headless and guards itself, because the failure modes of an unattended
# audit are all silent: a second run racing the first, a run that trips its own
# Phase 0 clean-tree gate forever, or one that probes a stack that isn't there.
# Guards below SKIP rather than force — a skipped week is recoverable, a
# corrupted checkout is not. Environment problems (missing binaries) FAIL
# loudly instead, because a FAIL that looks like a SKIP hides the real cause.
#
# ponytail: no `-e`. It wouldn't have caught either bug that mattered here:
# `cd ""` itself returns 0 (nothing to catch), and the original script never
# even looked at `git status`'s exit code, so a failed status (index.lock, an
# FDA denial) produced empty stdout that read as a clean tree regardless of
# `-e`. Every site that must not silently succeed gets its own explicit
# `|| exit` below instead.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1
[ -n "$REPO" ] || exit 1
cd "$REPO" || exit 1

LOG_DIR="$REPO/pipeline/bugs/cron"
LOCK="$LOG_DIR/.lock"
LOG="$LOG_DIR/$(date +%Y-%m-%d-%H%M).log"
CLAUDE="${CLAUDE_BIN:-claude}"
LOCK_CEILING=21600  # 6h — comfortably past RUN_TIMEOUT_SECS below
RUN_TIMEOUT_SECS=14400  # 4h

mkdir -p "$LOG_DIR"
exec >>"$LOG" 2>&1 || exit 1
echo "=== audit-cron $(date -Iseconds) ==="

# cron's PATH is minimal (often just /usr/bin:/bin) and has neither docker
# nor claude; without this, "docker: command not found" was silently read as
# "stack is not running" and the run exited 0 every week.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: docker not found on PATH ($PATH)"
  exit 1
fi
if ! command -v "$CLAUDE" >/dev/null 2>&1; then
  echo "FAIL: $CLAUDE not found on PATH ($PATH) — set CLAUDE_BIN to an absolute path"
  exit 1
fi

# The command only exists on branches that carry it; a checkout parked on an
# older branch would otherwise fail deep inside the run instead of here.
if [ ! -f .claude/commands/run-audit-auto.md ]; then
  echo "SKIP: .claude/commands/run-audit-auto.md not present on $(git branch --show-current)"
  exit 0
fi

# docker-compose.yaml pins `name: roamly` so this resolves to the same
# project from any checkout — without it, compose derives the project name
# from the cwd's basename, and a worktree (a different basename) would see
# zero containers for a stack that is actually up.
if [ -z "$(docker compose ps --status running --quiet)" ]; then
  echo "SKIP: stack is not running — not starting it unattended"
  exit 0
fi

# ponytail: mkdir is still the lock — atomic on every filesystem, no flock
# dependency. What's new: the lock now records its owner (pid + start time)
# so a dead owner (SIGKILL, since the EXIT trap can't run for that) or a
# hung one (belt-and-suspenders alongside the timeout below) gets reclaimed
# instead of blocking every future run forever. Reclaim is always logged —
# a silent reclaim would hide a crash.
acquire_lock() {
  if mkdir "$LOCK" 2>/dev/null; then
    echo "$$" >"$LOCK/pid"
    date +%s >"$LOCK/started"
    return 0
  fi

  local pid started now age alive=1
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  started="$(cat "$LOCK/started" 2>/dev/null || true)"
  now="$(date +%s)"
  started="${started:-$now}"
  age=$((now - started))
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    alive=0
  fi
  if [ "$alive" -eq 0 ] && [ "$age" -lt "$LOCK_CEILING" ]; then
    return 1
  fi

  echo "WARN: reclaiming stale lock $LOCK (owner pid=${pid:-unknown} alive=$([ "$alive" -eq 0 ] && echo yes || echo no) age=${age}s)"
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || return 1
  echo "$$" >"$LOCK/pid"
  date +%s >"$LOCK/started"
  return 0
}

if ! acquire_lock; then
  echo "SKIP: a previous run still holds $LOCK"
  exit 0
fi
trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

st="$(git status --porcelain)" || { echo "FAIL: git status"; exit 1; }
if [ -n "$st" ]; then
  # run-audit-auto.md's Phase 0 already self-heals a CHANGELOG.md-only tree
  # (a crashed changelog phase) so that one bad crash there can't silently
  # STOP every future scheduled run — mirror that here instead of being
  # stricter than the run itself. Anything else, or dirt alongside
  # CHANGELOG.md, is someone's real work: skip and leave it alone.
  dirty_paths="$(printf '%s\n' "$st" | awk '{print $NF}' | sort -u)"
  if [ "$dirty_paths" = "CHANGELOG.md" ]; then
    echo "INFO: only CHANGELOG.md is dirty — Phase 0 self-heals this, continuing"
  else
    echo "SKIP: working tree dirty — Phase 0 would stop anyway, and this run must not"
    echo "      touch someone's uncommitted work:"
    printf '%s\n' "$st" | sed 's/^/      /'
    exit 0
  fi
fi

echo "--- starting /run-audit-auto on $(git branch --show-current) @ $(git rev-parse --short HEAD)"

# ponytail: macOS ships no `timeout`(1) by default, so this is a hand-rolled
# TERM-then-KILL watcher on bash's own job control rather than a coreutils
# dependency. A hung `claude -p` would otherwise hold the lock forever.
"$CLAUDE" -p "/run-audit-auto" --model sonnet &
claude_pid=$!
(
  sleep "$RUN_TIMEOUT_SECS"
  kill -TERM "$claude_pid" 2>/dev/null
  sleep 30
  kill -KILL "$claude_pid" 2>/dev/null
) &
watcher_pid=$!
wait "$claude_pid"
rc=$?
kill "$watcher_pid" 2>/dev/null
wait "$watcher_pid" 2>/dev/null

echo "=== exit $rc at $(date -Iseconds) ==="
exit $rc
