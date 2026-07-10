# proxy-service

Public entrypoint of the platform. Terminates HTTP from clients and forwards
requests to internal services over gRPC.

**Status:** scaffolded — `GET /healthz` only. Add routes under
`internal/httpapi` and a caller resolver under `internal/identity` as real
features land.

## Responsibilities

- Terminate public HTTP, translate to internal gRPC calls.
- The only service the frontend talks to directly.

## Configuration

Environment variables, read once at startup in `main.go`:

- `HTTP_ADDR` — HTTP listen address, defaults to `:8080`.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) and
[GO_STANDARDS.md](../../GO_STANDARDS.md).
