# claude-workspace-template

Full-stack platform template: a minimal scaffold for a new project. Monorepo
split into `backend/` (Go microservices: `proxy-service/`, `auth-service/`,
`users-service/`, and the `shared` library) and `frontend/` (React + TypeScript).

## Key docs

- `ARCHITECTURE.md` — gRPC for sync calls, Kafka for async events, proxy-service is the only HTTP edge, React frontend talks only to proxy-service. Read before designing anything cross-service.
- `GO_STANDARDS.md` — mandatory Go conventions for `backend/` (layout, errors, logging, config, testing). Read before writing any Go code.
- `FRONTEND_STANDARDS.md` — React/TypeScript conventions for `frontend/`. Read before writing any frontend code.
- `DESIGN_STANDARDS.md` — the visual design system for `frontend/` (dark, minimalist, olive-green, premium tokens). Read before writing any frontend UI.

## Model policy

- Brainstorming and planning phases: use **Opus 4.8**.
- Implementation work: use **Sonnet 5**.
- Pipeline orchestration (`/run-pipeline`, `/run-pipeline-auto`): use **Sonnet 5**.
  Orchestrator sessions run hundreds of turns; on Opus they burn 2.5–5× the quota.
- This is a standing preference; whoever starts a brainstorm/plan session should select the model accordingly.

## Working rules

- No Go code lands without following `GO_STANDARDS.md`; no frontend code without `FRONTEND_STANDARDS.md`.
- Backend services never import each other's `internal/`; shared code goes through `backend/shared/`.
- The frontend talks to the backend only through `proxy-service`'s public HTTP API.
- The whole stack runs from a single root `docker-compose.yaml` (`docker compose up`); every runnable component registers itself there.
- Don't push to origin unless explicitly asked.
