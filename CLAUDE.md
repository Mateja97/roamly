# claude-workspace-template

Full-stack platform template: a minimal scaffold for a new project. Monorepo
split into `backend/` (Go microservices: `proxy-service/`, `auth-service/`,
`users-service/`, and the `shared` library), `frontend/` (React + TypeScript
web client), and `app/` (React Native + Expo, iOS/Android).

## Key docs

- `ARCHITECTURE.md` — gRPC for sync calls, Kafka for async events, proxy-service is the only HTTP edge, the React frontend and the React Native app talk only to proxy-service. Read before designing anything cross-service.
- `GO_STANDARDS.md` — mandatory Go conventions for `backend/` (layout, errors, logging, config, testing). Read before writing any Go code.
- `FRONTEND_STANDARDS.md` — React/TypeScript conventions for `frontend/`. Read before writing any frontend code.
- `APP_STANDARDS.md` — React Native/Expo conventions for `app/`. Read before writing any mobile code.
- `DESIGN_STANDARDS.md` — the visual design system shared by `frontend/` and `app/` (deep-wine background, gold accents, cream text — a premium palette). Read before writing any frontend or mobile UI.
- `BUSINESS_STANDARDS.md` — domain rules: the activity category taxonomy and Nearby/Anywhere search-scope behavior. Read before touching activity categories, search-scope logic, or filters in any of `backend/`, `frontend/`, or `app/`.

## Claude Design project

Roamly's page/flow designs live in the claude.ai/design project **"Roamly"**,
id `e93d4e9b-8c28-4bef-971e-aaa37462d1ec`. This is the default design source:
when a task or pipeline run names a design file (e.g. `Implement: <name>.dc.html`)
without a project URL, import it from this project. Read/write it with the
built-in `DesignSync` tool (auth via `/design-login` if needed) — never
configure a `claude_design` MCP server for it. The project's
`uploads/DESIGN_STANDARDS.md` is a mirror of the repo's `DESIGN_STANDARDS.md`.

## Model policy

- Brainstorming and planning phases: use **Opus 4.8**.
- Implementation work: use **Sonnet 5**.
- Pipeline orchestration (`/run-pipeline`, `/run-pipeline-auto`): use **Sonnet 5**.
  Orchestrator sessions run hundreds of turns; on Opus they burn 2.5–5× the quota.
- This is a standing preference; whoever starts a brainstorm/plan session should select the model accordingly.

## Working rules

- No Go code lands without following `GO_STANDARDS.md`; no frontend code without `FRONTEND_STANDARDS.md`; no mobile code without `APP_STANDARDS.md`.
- Backend services never import each other's `internal/`; shared code goes through `backend/shared/`.
- The frontend and the app talk to the backend only through `proxy-service`'s public HTTP API.
- The whole stack runs from a single root `docker-compose.yaml` (`docker compose up`); every runnable component registers itself there.
- Don't push to origin unless explicitly asked.
- **Nothing is pushed while the branch is red.** Before any `git push` — first push,
  force-push, or a resolve-pass update to an open PR — the whole branch must build,
  its tests must pass, and lint must be clean, for every module or package the branch
  touches. Not just the files in the last commit: a change that compiles alone can
  still break a sibling package. Run the gates the area actually uses (`go build ./...`,
  `go vet ./...`, `go test ./...` per Go module; `npx tsc --noEmit`, `npm run lint`,
  `npm test` for `frontend/` and `app/`) and read the real exit status — a command
  piped into `tail` reports the exit status of `tail`, not of the gate.
- If a gate cannot be run (no toolchain, a suite that needs a service that isn't up),
  say so explicitly in the PR and in the report rather than pushing on the assumption
  it would have passed. CI is the backstop, not the gate: `backend/` and `frontend/`
  are covered, but `.claude/` and `docs/` changes match no workflow, so for those the
  branch's own gates are the only check there is.
- When bumping a pinned dependency/runtime version, update every place that pins it (package.json across `frontend/`/`app/`, lockfiles, Dockerfiles, CI config) in the same change — a version bumped in only one place is a skew that `npm install`/local dev can mask but `npm ci`/Docker builds will hard-fail on.
- **Every session works in its own git worktree, cut from `origin/main`.** Never work
  directly in the primary checkout, and never work on a branch another worktree already
  holds — two sessions sharing one working directory is the collision this rule exists
  to prevent, and it is silent: one session's `git add` sweeps the other's uncommitted
  edits into its commit, and a `git checkout` in one flips HEAD under the other.
  `git fetch origin && git worktree add -b <branch> .claude/worktrees/<name> origin/main`.
  Cut from `origin/main`, not local `main` — `gh pr merge` never advances local `main`,
  so it goes stale the moment anything merges.
- Inside a linked worktree, do NOT run `git checkout main` first: `main` is usually
  checked out elsewhere and the command fails with `fatal: 'main' is already used by
  worktree at ...`. Create the branch directly with `git checkout -b <branch>`. This
  supersedes the older `git checkout main && git pull && git checkout -b ...` recipe for
  any session working in a worktree. Never branch off another feature branch.
- A subagent dispatched into a worktree is given that worktree's **absolute** path and
  works only there. It must never write to, or run a state-changing git command against,
  any other checkout — including the primary one. Gitignored files the work needs
  (`.env`, `app/.env`, `node_modules`) do not come with `git worktree add`; copy or
  install them as part of setting the worktree up, or the stack comes up misconfigured
  in ways that fail silently rather than loudly.
- If `main` has moved before merging back, resolve conflicts on the feature branch first (`git fetch origin && git merge origin/main`, or rebase), then merge/PR into `main`. `main` should only ever receive clean merges — never a conflict resolution done directly on it.
