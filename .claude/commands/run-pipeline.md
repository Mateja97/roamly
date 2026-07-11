---
description: Run the research → product → engineer → reviewer pipeline for a topic
argument-hint: <topic>
---

You are the orchestrator for the agent pipeline. Topic: **$ARGUMENTS**

Dispatch each worker as a subagent via the Agent/Task tool, passing explicit
absolute paths. You own the slug and the paths — workers never derive them.
Relay each agent's caveman report to the user in plain language at the
checkpoints.

## Model check (before anything)
Pipeline orchestration runs on **Sonnet**. If this session is running on an
Opus or Fable model, stop and ask the user to switch the session to Sonnet
(`/model`) before continuing — orchestrator sessions are long, and heavier
models multiply their quota cost.

## Token discipline
- Run the pipeline in a **fresh session** — don't append a run to a long
  interactive session; every dispatch turn re-reads the whole history.
- **Dispatch and track; don't do.** The orchestrator never Reads/Edits
  source, debugs, or verifies builds inline — route hands-on work to a
  subagent: the area engineer in resolve mode for fixes, `general-purpose`
  for one-off verification or investigation. The only exceptions are the
  one-command checks this flow already requires (e.g. `gh pr list`,
  `gh pr ready`).

## Setup
1. Compute `<slug>` = kebab-case of the topic.
2. Create `pipeline/<slug>/` at the repo root.
3. The six artifact paths are `research.md`, `product-tasks.md`,
   `design-spec.md`, `task-plan.md`, `engineering-notes.md`, `review-log.md`
   under `pipeline/<slug>/`.

## 1. Research
Dispatch the `researcher` agent with the topic and the `research.md` path.
**CHECKPOINT:** show the user the research and wait for confirmation before
continuing.

## 2. Product
Dispatch the `product` agent with the `research.md` path and the
`product-tasks.md` path.
- If the decision is `reject` or `defer`: **STOP.** Report the rationale. The
  pipeline ends here.
- If `proceed`: **CHECKPOINT** — show the user the decision + tasks and wait for
  confirmation.

## 3. Per task (in priority / dependency order)
Each task carries an `area: backend | frontend` tag. Dispatch the matching
engineer: `backend-engineer` for `area: backend`, `frontend-engineer` for
`area: frontend`. The reviewer uses the tag to pick the right standards. Respect
`depends` (a frontend task often waits on its backend task).

For each task `Tn`:
1. **`area: frontend` only:** dispatch the `designer` agent with the
   `product-tasks.md` path, the task id `Tn`, `DESIGN_STANDARDS.md`, and the
   `design-spec.md` path (append its section).
   **CHECKPOINT:** show the user the task's new `design-spec.md` section and
   wait for confirmation before building. If its `**Standard additions:**`
   line is not "none", call each addition out explicitly — the designer has
   already edited `DESIGN_STANDARDS.md`; on rejection, re-dispatch the
   designer to remove or redo the rejected addition before building.
   `area: backend` tasks skip this step entirely — go straight to step 2.
2. Dispatch the area's engineer (`backend-engineer` or `frontend-engineer`) with
   the `product-tasks.md` path, the task id `Tn`, `task-type: feature`
   (every task `/run-pipeline` produces is a feature task), the
   `task-plan.md` path, the `engineering-notes.md` path, and — for
   `area: frontend` — the `design-spec.md` path and the screenshots directory
   `pipeline/<slug>/screenshots/<Tn>/`.
   - **`area: frontend` only:** if `frontend-engineer` reports
     `NEEDS_DESIGN`, re-dispatch the `designer` agent with the task id, the
     `design-spec.md` path, and the reported gap (screen + status code +
     what's missing) so it appends an addendum rather than redoing the
     whole task's design. **CHECKPOINT:** show the user the addendum and
     wait for confirmation (same `**Standard additions:**` handling as the
     design checkpoint in step 1 above). Then re-dispatch
     `frontend-engineer` to resume the same task. This does not count
     toward the review loop's 3-round cap below.
3. Review loop (max **3** rounds):
   - Dispatch the `reviewer` agent with the PR, the `product-tasks.md` path, the
     task id, `task-type: feature`, the `task-plan.md` path, the
     `engineering-notes.md` path, the `review-log.md` path, and — for
     `area: frontend` — the `design-spec.md` path and the screenshots directory
     `pipeline/<slug>/screenshots/<Tn>/`.
   - `changes-requested` → re-dispatch the same area engineer in resolve mode
     with the `review-log.md` path, then re-review.
   - `approved` with unresolved Minor findings still listed → re-dispatch the
     same area engineer in resolve mode to close them out (counts toward the
     3-round cap); no re-review needed after — spot-check the fix with a
     single `gh pr diff` (a one-command check, within Token discipline), then
     mark ready. Do not fix Minor findings yourself as the orchestrator —
     route them to the engineer like any other comment.
   - `approved` with zero unresolved findings of any severity → mark the PR
     ready with `gh pr ready`, report the PR link.
   - After 3 rounds still not approved → **STOP** this task's loop and escalate
     to the user.
4. **CHECKPOINT:** tell the user the PR is approved and ready; they merge it.
   Wait before starting the next task.

## Done
Report: tasks shipped, PRs open/ready, anything escalated.

Agents declare their own models (researcher=sonnet, product=opus,
backend-engineer=sonnet, frontend-engineer=sonnet, reviewer=sonnet); no need to
override.
