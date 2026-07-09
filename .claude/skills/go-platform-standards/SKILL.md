---
name: go-platform-standards
description: Use when writing, reviewing, or designing any Go code or service architecture in this repo — enforces the platform's Go conventions and architecture rules
---

# Go Platform Standards

Before writing Go code in this repo, apply these rules (full text in `GO_STANDARDS.md` and `ARCHITECTURE.md` at repo root — read them if anything here is unclear).

## Architecture rules

- Monorepo, one folder per service. Services are independent Go modules.
- gRPC for synchronous service-to-service calls; Kafka for async events; HTTP only in `proxy`.
- Services never share a database and never import another service's `internal/`.
- Shared code lives in `shared/`, added only when a second service needs it.

## Code rules

- Layout per service: `cmd/<service>/main.go` (wiring only) + `internal/` (all logic) + `Dockerfile` + `go.mod`.
- Errors: wrap with `%w` and context; handle once (log or return, not both).
- Logging: `log/slog`, structured, at the edges only.
- Config: env vars, read once at startup, fail fast on missing values.
- Tests: table-driven, stdlib `testing`, through exported APIs.
- Kafka topics: `<domain>.<event>` lowercase; consumers must be idempotent.

## Checklist before committing Go code

1. `gofmt` clean
2. Tests exist and pass for non-trivial packages
3. No cross-service `internal/` imports
4. Errors wrapped with context
