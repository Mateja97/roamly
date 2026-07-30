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
- `DESIGN_STANDARDS.md` — the visual design system shared by `frontend/` and `app/` (dark, minimalist, olive-green, premium tokens). Read before writing any frontend or mobile UI.
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
- When bumping a pinned dependency/runtime version, update every place that pins it (package.json across `frontend/`/`app/`, lockfiles, Dockerfiles, CI config) in the same change — a version bumped in only one place is a skew that `npm install`/local dev can mask but `npm ci`/Docker builds will hard-fail on.
