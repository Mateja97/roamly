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

## Layering (inside internal/)

gRPC services (`auth-service`, `users-service`) use three layers, called in
one direction only — `api` never touches the db directly, `repository`
never calls back up into `service` or `api`:

```
internal/
├── api/          # gRPC handlers. One file per RPC method: create_user.go, get_user.go, ...
├── service/      # business logic. Grouped by entity/type, not one file per method.
└── repository/   # data access. Grouped by entity/type, not one file per method.
```

`proxy-service` uses two layers for now:

```
internal/
├── api/          # HTTP handlers. One file per endpoint: login.go, get_profile.go, ...
└── health/       # /healthz — infra, not a business endpoint, exempt from this layering
```

Proxy's `api` handlers call `backend/shared/clients` gRPC clients directly.
Add a `service` layer to proxy later, only once a handler actually needs to
orchestrate multiple gRPC calls or combine results — not speculatively.

**File-per-method applies to the `api` layer only**, in both proxy and the
gRPC services. `service` and `repository` layers group related methods by
entity/type in one file (e.g. `user.go` with `Create`, `Get`, `Update` for
the User entity).

## Errors

- Wrap with context: `fmt.Errorf("loading user %s: %w", id, err)`.
- Handle errors once — either log it or return it, never both.
- Sentinel errors and typed errors live in the package that produces them,
  **except** the shared db-error sentinels below, which live in
  `backend/shared/errors/` so every service's `api` layer maps them the
  same way:

  - `ErrNotFound`
  - `ErrConflict`
  - `ErrInvalidInput`
  - `ErrPermissionDenied`

- **`repository`** is the only layer that inspects raw `database/sql` /
  driver errors and translates them into the sentinels above (e.g.
  `sql.ErrNoRows` → `errors.ErrNotFound`, a unique-constraint violation →
  `errors.ErrConflict`).
- **`service`** passes sentinel errors through untouched — wrap with `%w`
  for context, never swallow or replace the underlying sentinel.
- **`api`** (gRPC) is the only layer that maps sentinels to gRPC status
  codes, and the only layer allowed to log the raw underlying error. Never
  put raw db error text (SQL, column/table names) into a gRPC status
  message returned to a caller:

  | sentinel | gRPC code |
  |---|---|
  | `ErrNotFound` | `codes.NotFound` |
  | `ErrConflict` | `codes.AlreadyExists` |
  | `ErrInvalidInput` | `codes.InvalidArgument` |
  | `ErrPermissionDenied` | `codes.PermissionDenied` / `codes.Unauthenticated` |
  | anything else / unwrapped error | `codes.Internal` |

## Logging

- Structured logging with `log/slog` (stdlib).
- Log at the edges (handlers, consumers), not deep inside business logic.
- No `fmt.Println` outside `main.go` bootstrap failures.

## Configuration

- Config via environment variables only, read once at startup in `main.go`.
- Fail fast: missing required config kills the process at boot with a clear message.

## Migrations

- Every `ADD COLUMN` in a forward SQL migration (`internal/repository/migrations/`)
  uses `ADD COLUMN IF NOT EXISTS`, and every `DROP COLUMN` uses `DROP COLUMN
  IF EXISTS`, even though the runner (`backend/shared/db`) tracks applied
  filenames in `schema_migrations` and normally never re-runs a file.
  `schema_migrations` and the live schema can still drift apart (e.g. a
  hand-edited database, a restored backup taken between the `ALTER TABLE` and
  the row insert) — on a plain `ADD COLUMN`/`DROP COLUMN` that drift is a
  permanent, unrecoverable startup failure (`SQLSTATE 42701` / `42703`),
  since every future start retries the same doomed statement forever.
  `IF NOT EXISTS`/`IF EXISTS` make a compatible drift a no-op instead, and a
  genuinely broken migration (bad SQL, wrong table, a failing
  `NOT NULL`/`CHECK`) still errors and still stops startup.
- **The guard's limit:** `IF NOT EXISTS` matches on column name only — it
  does not check the existing column's type, nullability, or default. A
  drifted column with the *wrong* shape (wrong type, missing the migration's
  intended `NOT NULL`/`DEFAULT`) is silently accepted, not rejected: the
  `ADD COLUMN` statement is skipped and the rest of the file still runs
  against whatever is actually there. This is a real, load-bearing
  limitation, not a hidden one — a migration is only safe to make idempotent
  this way when a name match is a reasonable proxy for a shape match (a
  single new column with no other migration touching it in between). It is
  not a general defense against schema drift of any kind.

## Testing

- Table-driven tests with the stdlib `testing` package.
- Test behavior through exported APIs; don't test private functions directly.
- Every non-trivial package ships with tests before its first commit merges.

## Tooling

- Format: `gofmt` (enforced, no exceptions).
- Lint: `go vet ./...`, run from inside each service's module directory. Part of the green gate for every PR — must be clean before requesting review; this is what CI actually runs. `golangci-lint` is not a gate yet — no repo-root `.golangci.yml` exists — add one and switch this rule over when the repo genuinely wants it.
- Vendoring decision deferred until first service.

## Shared package (`backend/shared/`)

Mandatory from day one — code doesn't wait for a second service to need it
before landing here:

```
backend/shared/
├── proto/              # all .proto files + generated gRPC code, every service
├── models/
│   ├── authsvc/        # auth-service's DTOs and DB row structs
│   ├── userssvc/       # users-service's DTOs and DB row structs
│   └── proxysvc/       # proxy-service's DTOs
├── clients/            # gRPC client wrappers (authsvc.Client, userssvc.Client, ...)
├── db/                 # DB connection/pool setup, migration runner
├── middleware/         # HTTP middleware (proxy) + gRPC interceptors (auth/users)
├── errors/             # sentinel error types (see Errors above)
├── logging/            # slog wrapper/defaults
├── kafka/               # producer/consumer helpers
└── config/               # env var loading helpers
```

- `models/` holds all struct definitions project-wide, including each
  service's own DB row structs — not just cross-service DTOs. Each service
  gets its own subpackage so types don't collide and ownership stays clear
  even though the files are physically colocated.
- A service still never imports another service's `internal/`. Only
  `shared/` is shared.

## gRPC & Kafka conventions

- Proto files live in `backend/shared/proto/`; generated code is committed there and imported by every service that needs it (including proxy-service, as a gRPC client).
- Kafka topic names: `<domain>.<event>` lowercase, e.g. `user.created`.
- Every consumer must be idempotent — events can be redelivered.
