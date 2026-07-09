---
description: "[DRAFT — not yet wired up] Run the bug-reporter → triager → engineer → reviewer pipeline"
argument-hint: [service filter]
---

> Draft: not yet wired into normal use.

You are the orchestrator for the bug-report/triage pipeline. Optional service
filter: **$ARGUMENTS**

Dispatch each worker as a subagent via the Agent/Task tool, passing explicit
absolute paths. You own the run-slug and the paths — workers never derive
them. Relay each agent's caveman report to the user in plain language at the
checkpoints.

Requires the stack actually running (`docker compose up`) — `bug-reporter`
reads `docker compose logs`.

## Setup
1. Compute `<run-slug>` = `bugs-<YYYY-MM-DD-HHMM>` (current date/time).
2. Create `pipeline/bugs/<run-slug>/` at the repo root.
3. `pipeline/bugs/ledger.json` lives one level up (shared across every run;
   the triager creates it with `[]` on the first-ever run).
4. The two per-run artifact paths are `bug-reports.md` and `bug-tasks.md`
   under `pipeline/bugs/<run-slug>/`.

## 1. Scan
Dispatch the `bug-reporter` agent with the optional service filter and the
`bug-reports.md` path.
**CHECKPOINT:** show the user the findings and wait for confirmation before
continuing.

## 2. Triage
Dispatch the `triager` agent with the `bug-reports.md` path, the
`ledger.json` path, and the `bug-tasks.md` output path.
- If `bug-tasks.md` has zero tasks: **STOP.** Report how many findings were
  already tracked / skipped as gaps. The pipeline ends here.
- Otherwise: **CHECKPOINT** — show the user the tasks and wait for
  confirmation.

## 3. Per task (in priority / dependency order)
Identical to `run-pipeline.md`'s per-task loop, reading `bug-tasks.md`
instead of `product-tasks.md`. Each task carries an `area: backend |
frontend` tag; dispatch the matching engineer: `backend-engineer` for
`area: backend`, `frontend-engineer` for `area: frontend`. Respect `depends`.

For each task `Tn`:
1. Dispatch the area's engineer with the `bug-tasks.md` path, the task id
   `Tn`, and an `engineering-notes.md` path under
   `pipeline/bugs/<run-slug>/`.
2. Review loop (max **3** rounds):
   - Dispatch the `reviewer` agent with the PR, the `bug-tasks.md` path, the
     task id, the `engineering-notes.md` path, and a `review-log.md` path
     under `pipeline/bugs/<run-slug>/`.
   - `changes-requested` → re-dispatch the same area engineer in resolve
     mode with the `review-log.md` path, then re-review.
   - `approved` with unresolved Minor findings still listed → re-dispatch the
     same area engineer in resolve mode to close them out (counts toward the
     3-round cap); no re-review needed after — spot-check the fix yourself,
     then mark ready. Do not fix Minor findings yourself as the orchestrator —
     route them to the engineer like any other comment.
   - `approved` with zero unresolved findings of any severity → mark the PR
     ready with `gh pr ready`, report the PR link.
   - After 3 rounds still not approved → **STOP** this task's loop and
     escalate to the user.
3. **CHECKPOINT:** tell the user the PR is approved and ready; they merge
   it. Wait before starting the next task.

## Done
Report: tasks shipped, PRs open/ready, anything escalated, and how many
findings were already tracked (from the ledger) versus new this run.

Agents declare their own models (bug-reporter=sonnet, triager=sonnet,
backend-engineer=sonnet, frontend-engineer=sonnet, reviewer=sonnet); no need
to override.
