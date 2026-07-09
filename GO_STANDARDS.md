# Go Standards

Rules every backend service in this repo follows. Principles, not code — code
examples live in the services once they exist. (Frontend conventions live in
`FRONTEND_STANDARDS.md`.)

## Go version

Every service pins the latest stable Go release in its `go.mod` (`go 1.26.4`
as of this writing) and builds against a matching `golang:1.26.4-alpine`
Dockerfile base image. Bump both together when a new Go version ships.

## Project layout (per service)

```
backend/<service>/
├── cmd/<service>/main.go   # entrypoint only: wire dependencies, start server
├── internal/               # all business logic; nothing imports across services
├── Dockerfile
├── go.mod                  # each service is its own Go module
└── README.md
```

- `main.go` stays thin: config loading, dependency wiring, graceful shutdown.
- Everything else goes under `internal/` so it cannot be imported by other services. Cross-service reuse goes through `backend/shared/` deliberately, never by reaching into another service.

## Errors

- Wrap with context: `fmt.Errorf("loading user %s: %w", id, err)`.
- Handle errors once — either log it or return it, never both.
- Sentinel errors and typed errors live in the package that produces them.

## Logging

- Structured logging with `log/slog` (stdlib).
- Log at the edges (handlers, consumers), not deep inside business logic.
- No `fmt.Println` outside `main.go` bootstrap failures.

## Configuration

- Config via environment variables only, read once at startup in `main.go`.
- Fail fast: missing required config kills the process at boot with a clear message.

## Testing

- Table-driven tests with the stdlib `testing` package.
- Test behavior through exported APIs; don't test private functions directly.
- Every non-trivial package ships with tests before its first commit merges.

## Tooling

- Format: `gofmt` (enforced, no exceptions).
- Lint: `golangci-lint run ./...`, run from inside each service's module directory, using the repo-root `.golangci.yml`. Part of the green gate for every PR — must be clean before requesting review.
- Vendoring decision deferred until first service.

## gRPC & Kafka conventions

- Proto files live with the owning service; generated code is committed.
- Kafka topic names: `<domain>.<event>` lowercase, e.g. `user.created`.
- Every consumer must be idempotent — events can be redelivered.
