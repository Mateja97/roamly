---
description: Run the pipeline autonomously (no pauses) — research→product→build→review→merge, shipping reviewer-approved PRs to main in dependency order
argument-hint: [topic-or-slug]
---

You are the **autonomous** orchestrator for the agent pipeline. Topic/slug:
**$ARGUMENTS** (optional — see Setup step 1 if omitted). Run the whole pipeline
WITHOUT pausing for the user, end to end: research → product → build → review →
**merge**. When a task's PR earns reviewer-approval you mark it ready **and merge
it** into `main` yourself, in dependency order (see the Merge-on-approval section
below). The user does not merge; the pipeline ships. The only things that still
stop you are a product `reject`/`defer`, a task that exhausts its 3-round review
loop, or a merge conflict a resolver subagent cannot safely resolve — those you
escalate in the final report.

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
Before anything else, compute `<slug>` (see Setup).

**Cleanup first:** for every directory under `.claude/worktrees/` other than
`<slug>`, check whether it's fully shipped: read its
`pipeline/<other-slug>/product-tasks.md` for task IDs and run `gh pr list
--state merged --search "T<n>" --base main` (or `git log main --oneline
--grep "T<n>"`) for each — the same check Build step 0 below already uses
per-task. If every task is merged, remove it: `git worktree remove
.claude/worktrees/<other-slug>`, then delete its feature branches (`git
for-each-ref --format='%(refname:short)' "refs/heads/feature/<other-slug>-*"`,
`git branch -D` each). If `product-tasks.md` doesn't exist yet or any task is
unmerged, leave that worktree alone — it may be another session's
in-progress work. This is opportunistic: skip a worktree you can't
confidently classify rather than guessing, and never touch `<slug>`'s own
worktree here.

Then isolate:
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

## Design-handoff fast path (check before Research)
If the topic includes a design import — a claude.ai/design URL, a `.dc.html`
file reference, or the design project turns out to contain a
`design_handoff_*` folder — this run is implementation of an
already-decided design, not a from-scratch initiative. Research and Product
exist to decide *whether and what* to build; a handoff has already decided
both. Running them anyway is the single biggest waste on this run shape
(~200k tokens / ~20 min measured).

1. **Import the newest authoritative source.** `list_files` on the design
   project FIRST and prefer a `design_handoff_*/` folder over root-level
   mockups — handoff folders are the finalized deliverable; root-level
   `.dc.html` files are working drafts that may be superseded. If the user's
   link points at a root-level file but a handoff folder exists for the same
   screen, import the handoff version and tell the user which source you
   used. Save the `.dc.html` + its README into
   `pipeline/<slug>/design-import/`.
2. **Classify the handoff.** A handoff is *high-fidelity* when it ships a
   README (or equivalent) specifying: fidelity level, exact tokens/values,
   component states, and interaction/state-management behavior. If yes:
   - **Skip `researcher` and `product` entirely.** Run one `Explore` pass
     over the code the design touches (current screens/flows/wire contracts),
     then write `product-tasks.md` yourself: `decision: proceed`, tasks with
     `area:` labels, dependencies, and acceptance criteria distilled from the
     handoff README + the user's stated requirements + the Explore findings.
     Keep it as rigorous as the product agent's format — the savings come
     from skipping re-research and go/no-go debate, not from vaguer tasks.
   - **Skip the `designer` step** for tasks the handoff README already
     covers: pass the README + `.dc.html` paths to the engineer AS the
     design-spec (design-spec.md can be a short pointer file). The engineer
     folds any required `DESIGN_STANDARDS.md` updates (new recipes/tokens the
     handoff introduces, stale-wording cleanup) into its task branch — list
     these explicitly in the task's acceptance criteria. Dispatch `designer`
     only via the normal `NEEDS_DESIGN` escalation, or for screens the
     handoff doesn't cover.
3. If the handoff is NOT high-fidelity (a bare mockup, no README/states),
   fall through to the normal Research → Product → designer flow below —
   a loose mock still needs product decisions and a real design-spec.

## 1. Research (no pause — skipped on the design-handoff fast path)
Dispatch `researcher` → `research.md`. Continue immediately.

## 2. Product (no pause — skipped on the design-handoff fast path)
Dispatch `product` → `product-tasks.md`.
- `reject` / `defer` → **STOP**, report the rationale.
- `proceed` → continue to Build immediately.

## 3. Build (parallel chains, stacked within a chain)
Partition tasks into independent dependency **chains**: a chain is a task with
base `main` plus everything that (transitively) depends on it. Chains share no
tasks and no branches, so they run **concurrently** — this is the pipeline's
main speedup, turning an N-task build from N× serial into ~max-chain-length.

- Dispatch the chains in parallel (see `superpowers:dispatching-parallel-agents`).
  Track each chain's current task independently.
- **Within** a chain, run its tasks strictly serially in dependency order — a
  stacked child can't branch off a parent that isn't built yet.
- Each chain only touches its own `feature/<slug>-<tn>` branches, so the step 0
  worktree keeps concurrent chains from colliding.
- Escalation stays per-chain: a task that fails its review loop skips only the
  tasks that depend on it (its own chain's tail); other chains are unaffected.

For each task `Tn` in a chain (chains advance in parallel; steps below are per task):
0. **Skip already-shipped tasks:** check `gh pr list --state merged --search "T<n>" --base main`
   (or `git log main --oneline --grep "T<n>"`) for a PR/commit that already
   shipped `Tn` into `main`. If found, skip straight to the next task — do not
   re-dispatch. A task is "unbuilt" (for the Setup slug-resolution step above)
   if this check finds nothing.
1. **Base branch:** if `Tn` depends on `Tm`, base = `Tm`'s branch
   (`feature/<slug>-<tm>`); otherwise base = `main`. This **stacks** dependent
   PRs so the whole chain builds before any merge.
2. **`area: frontend` or `area: app` — design (no pause):** dispatch the
   `designer` agent with the `product-tasks.md` path, the task id `Tn`,
   `DESIGN_STANDARDS.md`, and the `design-spec.md` path (append its
   section). Standard additions auto-apply — the designer edits
   `DESIGN_STANDARDS.md` itself; there is no checkpoint. Record every
   addition it reports for the final run report (standard additions ship with
   the task's PR when it merges). `area: backend` tasks skip this step.
3. Dispatch the area's engineer (`backend-engineer` | `frontend-engineer` |
   `app-engineer`) with the `product-tasks.md` path, the task id,
   `task-type: feature`, the `task-plan.md` path, the `engineering-notes.md`
   path, the base branch to use, AND — for `area: frontend` or `area: app`
   — the `design-spec.md` path and the screenshots directory
   `pipeline/<slug>/screenshots/<Tn>/`.
   - **`area: frontend` or `area: app` only (no pause):** if the engineer
     reports `NEEDS_DESIGN`, re-dispatch `designer` with the task id, the
     `design-spec.md` path, and the reported gap to append an addendum.
     Standard additions auto-apply, same as step 2 above. Record the
     addendum in the final run report. Then re-dispatch the same engineer
     to resume the same task. This does not count toward the review loop's
     3-round cap below.
4. Review loop (max **3** rounds):
   - Dispatch `reviewer` with the PR, `product-tasks.md`, the task id,
     `task-type: feature`, the `task-plan.md` path, `engineering-notes.md`,
     `review-log.md`, and — for `area: frontend` or `area: app` — the
     `design-spec.md` path and the screenshots directory
     `pipeline/<slug>/screenshots/<Tn>/`.
   - `changes-requested` → re-dispatch the same area engineer (resolve mode,
     `review-log.md` path) → re-review.
   - `approved` → `gh pr ready` (mark ready), then hand the PR to the
     **Merge-on-approval** step below. A newly-approved PR does not sit waiting
     for the user — it merges as soon as its dependencies are satisfied.
   - 3 rounds still unapproved → record an escalation, **skip** any tasks that
     depend on `Tn`, and continue with independent tasks.

### Merge-on-approval
Reviewer-approval is the ship signal. Once a PR is approved and marked ready,
merge it into `main` — respecting dependency order and integrating conflicts:

1. **Dependency gate.** A base PR (base `main`, no unmerged dependency) is
   eligible immediately. A child PR is eligible only once every task it depends
   on is already merged into `main`. If an approved PR isn't yet eligible, leave
   it ready and revisit when its parent merges — approvals often land out of
   dependency order across parallel chains.
2. **Rebase before merge.** Before merging an eligible PR, make sure its branch
   sits on the current `main` tip: `git fetch origin`, and if `main` has moved
   since the branch was cut, the branch needs a rebase (drops an already-merged
   parent's commits, and surfaces cross-chain conflicts on shared files). Do the
   rebase in the PR's **own** branch — never in the shared primary checkout.
3. **Merge.** When `gh pr view <n> --json mergeable,mergeStateStatus` reports
   `MERGEABLE`/`CLEAN`, merge in dependency order (`gh pr merge <n> --squash`
   unless the repo's merged-PR history shows another style). After each merge,
   re-check the remaining open approved PRs — a merge to `main` can flip a
   sibling to `CONFLICTING`.
4. **Conflicts → resolver subagent.** If a rebase/merge hits conflicts, do NOT
   resolve them inline (orchestrator token-discipline). Dispatch the task's area
   engineer in resolve mode (or `general-purpose`) into that PR's branch/worktree
   with the conflict details; it resolves, re-runs the task's gates
   (tsc/tests/lint or build/vet/test), pushes, and reports back. Then re-check
   mergeability and merge. Cap this at **2** resolve attempts per PR; if still
   unmergeable, record a merge escalation and leave that PR (and its unmerged
   dependents) ready-but-unmerged for the user, continuing with independent PRs.
5. **Merging is one command for you** (`gh pr merge`); the hands-on conflict
   work is always a subagent's. This keeps the merge gate automated without the
   orchestrator editing source.

## Done
Report a single summary: every PR in **merge order** (base → dependents), each
tagged `merged`, `escalated` (review), or `merge-escalated` (approved but a
conflict blocked the merge — needs the user), plus every `DESIGN_STANDARDS.md`
standard addition the designer applied during the run (or "standard additions:
none") — they auto-applied without a checkpoint, so this is where the user
learns about them. If everything merged, say so plainly and confirm `main` is
green. For any `merge-escalated` PR, name the conflicting files and what the
user needs to decide.

Leave the worktree in place — do not call `ExitWorktree` unless the user asks.
Mention its path (`.claude/worktrees/<slug>`) so the user can resume or clean it
up themselves once everything is merged.
