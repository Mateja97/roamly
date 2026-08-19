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
# AUDIT_CRON_LOG is set only by the self-update re-exec below, so one run
# keeps one log file instead of opening a second one under a new timestamp.
LOG="${AUDIT_CRON_LOG:-$LOG_DIR/$(date +%Y-%m-%d-%H%M).log}"
CLAUDE="${CLAUDE_BIN:-claude}"
RUN_TIMEOUT_SECS=14400  # 4h

mkdir -p "$LOG_DIR"
exec >>"$LOG" 2>&1 || exit 1
echo "=== audit-cron $(date -Iseconds) ==="

# cron's PATH is minimal (often just /usr/bin:/bin) and has neither docker
# nor claude; without this, "docker: command not found" was silently read as
# "stack is not running" and the run exited 0 every week. Deliberately
# prepended, not appended: this pins a known, deterministic docker/claude for
# every run regardless of what a minimal cron PATH would otherwise resolve
# first — this box has two docker binaries (/usr/local/bin and
# /opt/homebrew/bin), and cron must always get the same one, every run.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
# $HOME isn't guaranteed set in every cron environment; only add ~/.local/bin
# when it is, rather than fail on `set -u` or build a bogus "/.local/bin".
if [ -n "${HOME:-}" ]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: docker not found on PATH ($PATH)"
  exit 1
fi
if ! command -v "$CLAUDE" >/dev/null 2>&1; then
  echo "FAIL: $CLAUDE not found on PATH ($PATH) — set CLAUDE_BIN to an absolute path"
  exit 1
fi

# Keep the pipeline's own definition current. Phase 4 already fetches and cuts
# every branch from origin/main, so the *code* a run fixes is always current —
# but .claude/commands/run-audit-auto.md and .claude/agents/* are read from
# this checkout, so without this a scheduled run executes whatever definition
# was on disk the day the checkout was made, forever.
#
# --ff-only is the safety: it refuses rather than merges if this checkout has
# local commits or dirty files that would be clobbered. Every failure here is
# a WARN, never an exit — a network blip must degrade to "run last week's
# definition", not "skip this week's audit".
#
# The re-exec is not optional. Bash reads a script incrementally as it runs,
# so a fast-forward that rewrites this file mid-flight would leave the shell
# reading from a changed offset and executing garbage. Re-exec only when HEAD
# actually moved (an unchanged file is safe to keep reading), and guard it so
# the new process cannot update-and-exec again. This runs before the lock is
# taken: exec keeps the same pid but skips the EXIT trap, so re-execing while
# holding the lock would leave the new process deadlocked against its own
# still-held lock.
if [ -z "${AUDIT_CRON_SELF_UPDATED:-}" ]; then
  export AUDIT_CRON_SELF_UPDATED=1
  before="$(git rev-parse HEAD 2>/dev/null || true)"
  if [ -n "$before" ] && git fetch --quiet origin main 2>/dev/null &&
     git merge --ff-only --quiet FETCH_HEAD 2>/dev/null; then
    after="$(git rev-parse HEAD 2>/dev/null || true)"
    if [ -n "$after" ] && [ "$before" != "$after" ]; then
      echo "INFO: self-updated ${before:0:7} -> ${after:0:7}, re-execing"
      # Carry the log forward so one run stays one log file, even though the
      # re-exec recomputes LOG's timestamp.
      export AUDIT_CRON_LOG="$LOG"
      exec "$REPO/scripts/audit-cron.sh"
    fi
  else
    echo "WARN: self-update skipped (fetch or ff-only merge failed) — running the definition at ${before:-unknown}"
  fi
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
# dependency. What's new: the lock records its owner's pid, and this is a
# liveness check (kill -0), not a pid+start-time identity scheme — a lock is
# reclaimed only when its owner is confirmed dead (a SIGKILL skips the EXIT
# trap that would otherwise clean up, so nothing else ever would). An alive
# owner is NEVER preempted, no matter how old the lock: reclaiming a live
# owner would mean two audits running at once, which is worse than staying
# locked. If a run somehow outlives RUN_TIMEOUT_SECS + its kill grace below
# and is still alive, that's a stuck process needing a human, not a second
# run racing it. Reclaim is always logged loudly — a silent reclaim would
# hide a crash.
acquire_lock() {
  if mkdir "$LOCK" 2>/dev/null; then
    echo "$$" >"$LOCK/pid"
    return 0
  fi

  local pid
  pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return 1
  fi

  echo "WARN: reclaiming stale lock $LOCK (owner pid=${pid:-unknown} is not running)"
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || return 1
  echo "$$" >"$LOCK/pid"
  return 0
}

if ! acquire_lock; then
  echo "SKIP: a previous run still holds $LOCK"
  exit 0
fi
trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

st="$(git status --porcelain)" || { echo "FAIL: git status"; exit 1; }
if [ -n "$st" ]; then
  # run-audit-auto.md Phase 0 step 5: any unmerged status code (UU/AA/DD/
  # AU/UA/DU/UD), for ANY path, is a mid-merge conflict — STOP, never
  # self-heal. Must run before the CHANGELOG.md-only check below: reducing
  # "UU CHANGELOG.md" to just its path would otherwise match that exemption
  # and wave a real conflict through as ordinary Phase-0 debris.
  if printf '%s\n' "$st" | awk '{print $1}' | grep -qE '^(UU|AA|DD|AU|UA|DU|UD)$'; then
    echo "SKIP: working tree has an unmerged/conflicted path — never self-heal a conflict:"
    printf '%s\n' "$st" | sed 's/^/      /'
    exit 0
  fi

  # Phase 0 also self-heals a CHANGELOG.md-only tree (a crashed changelog
  # phase) so that one bad crash there can't silently STOP every future
  # scheduled run — mirror that here instead of being stricter than the run
  # itself. Anything else, or dirt alongside CHANGELOG.md, is someone's real
  # work: skip and leave it alone.
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
# Polls kill -0 every 30s instead of one long sleep: if this script itself
# gets killed, the watcher subshell is orphaned but keeps running — a single
# `sleep $RUN_TIMEOUT_SECS` would then fire hours later against whatever
# process the kernel has since handed that pid to, having long outlived the
# child it was meant to guard. Polling bounds that to one 30s interval and
# self-exits the moment the child is gone, orphaned watcher or not.
"$CLAUDE" -p "/run-audit-auto" --model sonnet &
claude_pid=$!
(
  elapsed=0
  while kill -0 "$claude_pid" 2>/dev/null; do
    if [ "$elapsed" -ge "$RUN_TIMEOUT_SECS" ]; then
      kill -TERM "$claude_pid" 2>/dev/null
      sleep 30
      kill -KILL "$claude_pid" 2>/dev/null
      break
    fi
    sleep 30
    elapsed=$((elapsed + 30))
  done
) &
watcher_pid=$!
wait "$claude_pid"
rc=$?
kill "$watcher_pid" 2>/dev/null
wait "$watcher_pid" 2>/dev/null

echo "=== exit $rc at $(date -Iseconds) ==="
exit $rc
