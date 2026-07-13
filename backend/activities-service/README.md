# activities-service

Owns the activity catalog and answers scoped, filtered queries against it
(`home` / `nearby` / `my_country`). Stateless about users: callers
supply location context (current/home coordinates, home country) on every
request. Backed by Postgres + PostGIS.

**Status:** MVP — single `QueryActivities` gRPC method, seeded read-only
catalog. No write/CRUD API (see product-tasks.md "Out of scope").

## gRPC contract

Proto: `backend/shared/proto/activities/v1/activities.proto`. See
`pipeline/roamly-activities-mvp/engineering-notes.md` (T1 section) for the
full field-by-field contract and validation rules, written for whoever
builds the proxy-service edge on top of this (T2).

## Configuration

Environment variables, read once at startup in `main.go`:

- `DATABASE_URL` — Postgres DSN (required), e.g.
  `postgres://user:pass@host:5432/activities?sslmode=disable`.
- `GRPC_ADDR` — gRPC listen address, defaults to `:9090`.
- `DEFAULT_RADIUS_KM` — default radius in km for `home`/`nearby` scopes,
  defaults to `50`.
- `LOG_LEVEL` — slog level, defaults to `info`.

## Data

Schema + seed data live in `internal/repository/migrations/` and run
automatically at startup (`backend/shared/db.Migrate`). Requires the
`postgis` extension (image `postgis/postgis:16-3.4-alpine` in
docker-compose, not the plain `postgres` image).

## Testing

- `go test ./...` — unit tests only (query-builder, validation, gRPC
  translation/error-mapping), no external dependencies.
- `go test -tags=integration ./...` — adds a real Postgres+PostGIS
  end-to-end test of the scope/filter query path. Requires a docker daemon;
  spins up and tears down its own throwaway container.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) and
[GO_STANDARDS.md](../../GO_STANDARDS.md).
