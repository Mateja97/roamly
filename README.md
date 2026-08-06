# claude-workspace-template

A full-stack platform scaffold: Go microservices backend and a React
frontend, built around a research → product → engineer → reviewer agent
pipeline. Clone this to start a new project — see
[docs/agent-pipeline.md](docs/agent-pipeline.md) to run your first feature
through the pipeline.

## Backend (`backend/`)

Go microservices.

| Service | Purpose | Status |
|---|---|---|
| [proxy-service](backend/proxy-service/README.md) | Public entrypoint, HTTP→gRPC edge | scaffolded — `/healthz` only |
| [auth-service](backend/auth-service/README.md) | Authentication, JWT issue/refresh | planned |
| [users-service](backend/users-service/README.md) | User profile and account data | planned |
| [shared](backend/shared/README.md) | Common Go library (proto contracts, logging, kafka, config, errors) | planned |

## Frontend (`frontend/`)

React + TypeScript (Vite). See [frontend/README.md](frontend/README.md).

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces are laid out and talk to each other
- [GO_STANDARDS.md](GO_STANDARDS.md) — Go conventions every backend service must follow
- [FRONTEND_STANDARDS.md](FRONTEND_STANDARDS.md) — React/TypeScript conventions for the frontend
- [DESIGN_STANDARDS.md](DESIGN_STANDARDS.md) — the visual design system for the frontend
- [docs/agent-pipeline.md](docs/agent-pipeline.md) — the research→product→engineer→reviewer agent pipeline
- [docs/auto-agent-mode.md](docs/auto-agent-mode.md) — running the pipeline hands-off (supervised autopilot)

## Getting started

1. Create a root `.env` (gitignored) with `ADMIN_API_TOKEN`,
   `TRIPADVISOR_API_KEY`, `GOOGLE_MAPS_API_KEY`, and `FIRECRAWL_API_KEY`.
   `docker-compose.yaml` passes each straight through under its own name to
   the service that needs it — **except** the Google Maps key: the frontend
   and app builds read it under separate build-arg names
   (`VITE_GOOGLE_MAPS_API_KEY`, `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`), so `.env`
   needs all three set to the same value, or the frontend/app build args
   resolve empty and the Edit activity screen's map preview 403s from Google.
   Optionally add `EXPO_PUBLIC_GYG_PARTNER_ID` (your GetYourGuide partner
   ID, from the partner portal's Tools → Links builder) — unset, the app's
   Tours & Experiences referral card omits itself rather than shipping an
   untracked affiliate link.
2. `docker compose up` — brings up postgres + proxy-service + frontend;
   visit `http://localhost:4173`, which calls proxy-service's `/healthz`
   through to confirm the wiring works end to end.
3. Run `/run-pipeline <topic>` from a fresh Claude Code session to research,
   scope, and build your first real feature.
