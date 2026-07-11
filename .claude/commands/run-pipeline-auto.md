---
description: Run the pipeline autonomously (no pauses) — research→product→build→review, leaving reviewer-approved PRs ready for YOU to merge
argument-hint: [topic-or-slug]
---

You are the **autonomous** orchestrator for the agent pipeline. Topic/slug:
**$ARGUMENTS** (optional — see Setup step 1 if omitted). Run the whole pipeline
WITHOUT pausing for the user. The single human gate is merging: you open PRs,
drive them to reviewer-approval, and mark them ready — but you **never merge**.
The user merges.

Dispatch each worker as a subagent via the Agent tool, passing explicit absolute
paths. You own the slug and paths.

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

## 0. Isolate (worktree)
Autopilot builds must never share a working tree with another session — parallel
sessions collide (`git add -A` in one sweeps another's uncommitted edits).
Before anything else, compute `<slug>` (see Setup) and isolate:
- If `.claude/worktrees/<slug>` already exists (resuming a prior run), call
  `EnterWorktree` with `path: .claude/worktrees/<slug>`.
- Otherwise call `EnterWorktree` with `name: <slug>` to create a fresh worktree
  and switch into it.

Everything below — Setup, Research, Product, Build — runs inside this worktree.

## Setup
1. **Resolve `<slug>`:**
   - `$ARGUMENTS` given → `<slug>` = kebab-case of it (or used directly if
     already a slug).
   - `$ARGUMENTS` omitted → glob `pipeline/*/product-tasks.md` for one with
     `decision: proceed` that still has an unbuilt task (see Build step 0 for
     "unbuilt"). Exactly one match → use its slug. Zero matches → **STOP**,
     tell the user there's no pending backlog and they need to pass a topic
     (e.g. one of the bullets in that pipeline's "Roadmap (future slices)"
     section, if one exists). More than one match → **STOP**, list the slugs
     and ask which to resume.
2. `pipeline/<slug>/` holds `research.md`, `product-tasks.md`,
   `design-spec.md`, `task-plan.md`, `engineering-notes.md`,
   `review-log.md`.
3. **Resume check:** if `pipeline/<slug>/product-tasks.md` already exists with
   `decision: proceed`, SKIP steps 1–2 (of Research/Product below) and go
   straight to Build.

## 1. Research (no pause)
Dispatch `researcher` → `research.md`. Continue immediately.

## 2. Product (no pause)
Dispatch `product` → `product-tasks.md`.
- `reject` / `defer` → **STOP**, report the rationale.
- `proceed` → continue to Build immediately.

## 3. Build (dependency order, stacked)
Order tasks by dependency. For each task `Tn`:
0. **Skip already-shipped tasks:** check `gh pr list --state merged --search "T<n>" --base main`
   (or `git log main --oneline --grep "T<n>"`) for a PR/commit that already
   shipped `Tn` into `main`. If found, skip straight to the next task — do not
   re-dispatch. A task is "unbuilt" (for the Setup slug-resolution step above)
   if this check finds nothing.
1. **Base branch:** if `Tn` depends on `Tm`, base = `Tm`'s branch
   (`feature/<slug>-<tm>`); otherwise base = `main`. This **stacks** dependent
   PRs so the whole chain builds before any merge.
2. **`area: frontend` only — design (no pause):** dispatch the `designer`
   agent with the `product-tasks.md` path, the task id `Tn`,
   `DESIGN_STANDARDS.md`, and the `design-spec.md` path (append its
   section). Standard additions auto-apply — the designer edits
   `DESIGN_STANDARDS.md` itself; there is no checkpoint. Record every
   addition it reports for the final run report (the PR merge gate is the
   human approval). `area: backend` tasks skip this step.
3. Dispatch the area's engineer (`backend-engineer` | `frontend-engineer`) with
   the `product-tasks.md` path, the task id, `task-type: feature`, the
   `task-plan.md` path, the `engineering-notes.md` path, the base branch to
   use, AND — for `area: frontend` — the `design-spec.md` path and the
   screenshots directory `pipeline/<slug>/screenshots/<Tn>/`.
   - **`area: frontend` only (no pause):** if `frontend-engineer` reports
     `NEEDS_DESIGN`, re-dispatch `designer` with the task id, the
     `design-spec.md` path, and the reported gap to append an addendum.
     Standard additions auto-apply, same as step 2 above. Record the
     addendum in the final run report. Then re-dispatch `frontend-engineer`
     to resume the same task. This does not count toward the review loop's
     3-round cap below.
4. Review loop (max **3** rounds):
   - Dispatch `reviewer` with the PR, `product-tasks.md`, the task id,
     `task-type: feature`, the `task-plan.md` path, `engineering-notes.md`,
     `review-log.md`, and — for `area: frontend` — the `design-spec.md`
     path and the screenshots directory `pipeline/<slug>/screenshots/<Tn>/`.
   - `changes-requested` → re-dispatch the same area engineer (resolve mode,
     `review-log.md` path) → re-review.
   - `approved` → `gh pr ready` (mark ready). **Do NOT merge.**
   - 3 rounds still unapproved → record an escalation, **skip** any tasks that
     depend on `Tn`, and continue with independent tasks.

## Done
Report a single summary: every PR in **merge order** (base → dependents), each
tagged `ready` or `escalated`, plus every `DESIGN_STANDARDS.md` standard
addition the designer applied during the run (or "standard additions: none")
— they auto-applied without a checkpoint, so this is where the user learns
about them. Tell the user to merge in dependency order:
**merge the base PR first**, then — before merging each child — **rebase it onto
the updated `main`** (GitHub's "Update branch" button, or
`git fetch origin && git rebase origin/main` then force-push). GitHub retargets a
child PR's base to `main` when its parent merges, but the branch still needs the
rebase to drop the parent's now-merged commits. **Merge nothing yourself.**

Leave the worktree in place — do not call `ExitWorktree` unless the user asks.
Mention its path (`.claude/worktrees/<slug>`) so the user can resume or clean it
up themselves once everything is merged.
