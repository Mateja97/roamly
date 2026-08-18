# activities-service

Owns the activity catalog and answers scoped, filtered queries against it
(`nearby` / `anywhere`). Stateless about users: callers supply location
context (current coordinates) on every request. Backed by Postgres + PostGIS.

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
- `LOG_LEVEL` — slog level, defaults to `info`.
- `MAX_RESOLVED_PHOTOS` — how many photos `GetPhotos` resolves and persists
  per venue on first detail view, defaults to `5`. Unset, non-numeric, or
  non-positive values fall back to the default (a non-empty invalid value
  logs a warning).
- `GOOGLE_SYNC_TTL_DAYS` — how long a Google discovery sync stays fresh,
  defaults to `30`. A non-positive or non-numeric value falls back to the
  default rather than failing startup (T4).

`nearby` scope always uses a fixed, non-adjustable 10 km radius
(`service.NearbyRadiusKM`); any client-supplied `max_distance_km` is ignored
for this scope. `anywhere` is uncapped unless the caller supplies
`max_distance_km`.

## Data

Schema + seed data live in `internal/repository/migrations/` and run
automatically at startup (`backend/shared/db.Migrate`). Requires the
`postgis` extension (image `postgis/postgis:16-3.4-alpine` in
docker-compose, not the plain `postgres` image).

The catalog fills itself — there is no batch import step. Two lazy syncs run
off `QueryActivities`:

- **Google Places** — type-driven discovery, one `searchNearby` (or, for the
  few subtypes Table A can't express, a bounded `searchText`) per
  (map cell, category, subtype) row in `internal/placesmap/discovery.go`.
  Runs detached in the background; a single query schedules at most
  `maxGoogleRowsPerQuery` (8) of the ~53 rows, so a city converges over
  roughly seven searches rather than one expensive burst.
- **Tripadvisor** — Restaurants, Bars and Cafés, synchronous within the
  query.

Freshness for both is tracked in `sync_regions` (`provider`, `cell_key`,
`category`, `subtype`), TTL 30 days for Google (`googleSyncTTL` in
`internal/service/`, configurable via `GOOGLE_SYNC_TTL_DAYS`) and 14 days for
Tripadvisor (`tripadvisorSyncTTL`), plus the radius each sync
actually covered (`radius_km`) — a row is fresh only when it's both within
TTL and covers at least the requesting query's distance, so a prior narrow
sync doesn't block a later wider Anywhere search. Google's covered radius
matches the request, capped at Places' 50km ceiling; Tripadvisor's is always
its fixed 8km (Terra rejects a wider `NearbySearch` radius).

To pre-warm a city before it ships, instead of waiting for the first user
query to trickle results in over several searches:

    GOOGLE_MAPS_API_KEY=... DATABASE_URL=... \
      go run ./cmd/scrapecity -city Belgrade -lat 44.8125 -lng 20.4612 -count-only=false

`-count-only` defaults to `true`: a read-only dry run that writes nothing and
reports each discovery row's yield against the quality floor — the right
first move after touching `discovery.go`, since a row that returns zero
venues is a mapping bug. `-count-only=false` switches to pre-warm: it runs
every discovery row at the anchor through the service's own lazy-sync code
(`service.PrewarmGoogle`), ignoring the TTL and per-query budget, and
actually ingests what passes the floor.

Rows ingested before subtype resolution existed (T2) — every published
`tripadvisor`/`firecrawl` row whose `subcategory` is still `""` — need a
one-time backfill; nothing re-classifies them on its own, so this tool has to
actually be run for the filter fix to reach existing data. `TRIPADVISOR_API_KEY`
is optional: when set, a row Google and the venue's name both fail to classify
gets one more chance from Tripadvisor's price tier (restaurant subtype
coverage); when unset, the tool logs a warning and those rows simply stay
empty, same as before that signal existed.

    GOOGLE_MAPS_API_KEY=... DATABASE_URL=... [TRIPADVISOR_API_KEY=...] \
      go run ./cmd/backfillsubtype -dry-run

    GOOGLE_MAPS_API_KEY=... DATABASE_URL=... [TRIPADVISOR_API_KEY=...] \
      go run ./cmd/backfillsubtype

`-dry-run` (default `false`) reports the before-counts by source/category and
writes nothing — run this first to see how many rows are candidates.
`-limit N` (default `0`, no cap) caps a run at **at most N Places calls**,
not N rows of permanent progress: rows whose name carries a local
venue-type keyword (shisha, kafana) resolve from the stored name alone, no
Places call, and are re-selected as candidates on every run regardless of
source or current subcategory (see the tool's package doc and
`keepCandidates`), so they never leave the candidate set and consume
`-limit` budget on every staged invocation at zero Places cost. Every other
row follows the resume-by-emptiness rule: the read filter
(`subcategory = ''`) and the write guard (`SetSubcategoryIfEmpty`) are the
same condition, so re-running with no `-limit` (or a higher one) picks up
where the last run left off for those rows.
Capture the printed before/after table into `engineering-notes.md` once run
for real.

Tripadvisor rows synced before `google_place_id` existed (tripadvisor-google-
review-fallback T1) also need a one-time backfill, same shape as the tool
above but its own command since the candidate filter and setter differ:

    GOOGLE_MAPS_API_KEY=... DATABASE_URL=... \
      go run ./cmd/backfillgoogleplaceid -dry-run

    GOOGLE_MAPS_API_KEY=... DATABASE_URL=... \
      go run ./cmd/backfillgoogleplaceid

Same `-dry-run` and `-limit N` flags, same resume mechanism: the candidate
read is published rows, filtered client-side on `source == "tripadvisor"` and
empty `google_place_id` (`List` has no filter for either), and the write
guard `SetGooglePlaceIDIfEmpty` rejects a row something else already set
between the read and the write — same condition either way. Same fixed pace
between Places calls. Reuses `ResolveTripadvisorSubtype` (T1) for the
search/match — no second classification algorithm. A venue the resolver
can't match is skipped and counted (`missed`), never written with a guess.
Reports scanned/processed/resolved/written/already-set/missed/failed counts
on completion.

## Testing

- `go test ./...` — unit tests only (query-builder, validation, gRPC
  translation/error-mapping), no external dependencies.
- `go test -tags=integration ./...` — adds a real Postgres+PostGIS
  end-to-end test of the scope/filter query path. Requires a docker daemon;
  spins up and tears down its own throwaway container.

See [ARCHITECTURE.md](../../ARCHITECTURE.md) and
[GO_STANDARDS.md](../../GO_STANDARDS.md).
