# proxy-service

Public entrypoint of the platform. Terminates HTTP from clients and forwards
requests to internal services over gRPC.

**Status:** scaffolded — `GET /healthz` only. Add routes under
`internal/api`, one file per endpoint, as real features land. See
"Layering (inside internal/)" in [GO_STANDARDS.md](../../GO_STANDARDS.md).

## Responsibilities

- Terminate public HTTP, translate to internal gRPC calls.
- The only service the frontend talks to directly.

## HTTP status codes

proxy-service returns exactly one of these six statuses — nothing else.
`internal/api` translates gRPC codes returned by `backend/shared/clients`
calls into this set:

| gRPC code | HTTP status |
|---|---|
| `codes.OK` | 200 |
| `codes.NotFound` | 404 |
| `codes.InvalidArgument`, `codes.FailedPrecondition` | 400 |
| `codes.PermissionDenied`, `codes.Unauthenticated` | 403 |
| `codes.AlreadyExists` | 409 |
| everything else (`Internal`, `Unavailable`, `DeadlineExceeded`, `Unknown`, ...) | 500 |

Success is always 200, regardless of HTTP verb — no 201/204. 409 exists
specifically so a resource conflict (`ErrConflict` → `codes.AlreadyExists`,
see GO_STANDARDS.md's Errors section) stays distinguishable from a genuine
internal failure.

## Configuration

Environment variables, read once at startup in `main.go`:

- `HTTP_ADDR` — HTTP listen address, defaults to `:8080`.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) and
[GO_STANDARDS.md](../../GO_STANDARDS.md).
