# .claude/worktrees/

Per-session isolated git worktrees, used so parallel/autopilot Claude sessions
never share a working tree (a shared tree lets one session's `git add -A`
sweep another's uncommitted edits). Contents are ephemeral checkouts,
gitignored — see [docs/auto-agent-mode.md](../../docs/auto-agent-mode.md) for
the convention.
