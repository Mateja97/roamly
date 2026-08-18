# Auto Agent Mode (Supervised Autopilot)

How to run the agent pipeline hands-off — research → product → build → review
with no permission prompts and no mid-run pauses — while keeping the one gate
that matters: **you merge every PR.**

For the interactive, checkpoint-at-every-step version, see
[agent-pipeline.md](agent-pipeline.md). This doc is the autonomous variant.

## What it does

`/run-pipeline-auto <topic-or-slug>` runs the whole chain without stopping. The
engineers build on **stacked branches** and open draft PRs; the reviewer checks
each against its acceptance criteria; approved PRs are marked ready. Nothing is
merged — you merge, in dependency order, whenever you want.

## One-time setup

1. **GitHub CLI:** `gh auth login` (needs `repo` scope). Required — the
   engineer opens real PRs.
2. **Skill plugins** (optional depth the engineers pull in on demand):
   - `/plugin marketplace add samber/cc` then `/plugin install cc-skills-golang@samber`
   - `/plugin marketplace add jeffallan/claude-skills` then `/plugin install fullstack-dev-skills@fullstack-dev-skills`
3. **Permissions** — already configured in `.claude/settings.json`:
   - a command allowlist (`go`, `git`, `gh pr`, `npm`, `docker compose`)
   - `"defaultMode": "auto"` — routine commands run without prompting; genuinely
     destructive ones are still blocked. Auto mode shows a one-time opt-in the
     first time you use it.
   - To go fully silent (also drop the destructive-command guard), set
     `"defaultMode": "bypassPermissions"` — higher risk, nothing ever prompts.

## Run each build in its own worktree (important)

Never run an autopilot build in the same working directory as another Claude
session — they share one working tree and **will** collide (a real incident:
a build session's commit got mixed into an unrelated one). Give each build its
own git worktree, per `CLAUDE.md`'s worktree rule — cut from `origin/main`,
not local `main`, and under `.claude/worktrees/`:

```bash
git fetch origin
git worktree add .claude/worktrees/<topic> -b feat/<topic> origin/main
cd .claude/worktrees/<topic>
# start Claude Code here, then run the pipeline
```

When the work is merged and done:

```bash
git worktree remove .claude/worktrees/<topic>
```

## Running the pipeline

- **From a topic:** `/run-pipeline-auto rate-limiting` — runs research →
  product → build end to end.
- **Resume from approved tasks:** if `pipeline/<slug>/product-tasks.md` already
  exists with `decision: proceed`, it skips research/product and goes straight
  to build. e.g. `/run-pipeline-auto rate-limiting`.

## What you do

- **During the run:** nothing — no prompts, no pauses.
- **At the end:** you get the PRs listed in merge order. **Merge the base PR
  first**; stacked child PRs retarget to `main` as their parent merges.
- **Review each PR before merging** — that is the one human gate the autopilot
  keeps.

## Scheduling as a routine (optional)

To advance a pipeline on a schedule (a cron cloud agent / routine), wrap
`/run-pipeline-auto <slug>` in a scheduled task. Best for a "keep advancing"
cadence. A one-shot build is simpler run once, in a local worktree session.

## Interactive vs auto — which to use

| | `/run-pipeline` | `/run-pipeline-auto` |
|---|---|---|
| Research / product checkpoints | pauses for you | no pause |
| PRs | one at a time, merge between | stacked, merge at end |
| Permission prompts | normal | none (`auto` mode) |
| Use when | you want control | you want it hands-off |
