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

## Admin authentication (T2)

Every `/admin/*` route (the admin panel's read/write activity endpoints)
requires an `X-Admin-Token` header matching `ADMIN_API_TOKEN`, checked with
`crypto/subtle.ConstantTimeCompare` against timing attacks. **If
`ADMIN_API_TOKEN` is unset or empty, `/admin/*` is not registered on the
mux at all** — a missing token means the routes don't exist (a 404), never
"everything allowed". A present-but-wrong token gets a 403.

**Security note — read before assuming this is real auth.** This is a
single static token shared by every admin session, delivered to a browser
app (the frontend's `VITE_ADMIN_TOKEN`). Anyone with the panel's JS bundle
can read it. It exists to keep the mutation API off the open internet, not
to authenticate individuals or distinguish one admin from another — there
is no login, no session, no per-user audit trail. See
`product-tasks.md`'s Roadmap for the real auth-service this is standing in
for.

## Configuration

Environment variables, read once at startup in `main.go`:

- `HTTP_ADDR` — HTTP listen address, defaults to `:8080`.
- `ADMIN_API_TOKEN` — shared token gating `/admin/*` (T2). Unset/empty
  disables the admin routes entirely (fail closed) rather than serving them
  open.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) and
[GO_STANDARDS.md](../../GO_STANDARDS.md).
