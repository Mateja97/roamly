# cmd/importcity: Stage-A extraction contract + operator runbook

`cmd/importcity` is Stage B of the per-city ingestion pipeline: a Go CLI that
reads a Stage-A `<city>.json` file and loads it into the live `activities`
table as `status=pending`, guaranteeing every activity ends up with at least
3 photos (downloaded to the shared photo volume, Google-backfilled when the
scrape came up short). Stage A itself runs entirely in the Firecrawl/agent
environment, not Go — there is no code to write for it, only the contract
this document defines and the procedure an operator follows per city.

This README is that contract. It has four parts:

1. The exact JSON schema Stage A must produce (`inputRow`, matching
   `main.go`'s struct tags field-for-field).
2. The field-to-column mapping the importer applies.
3. The Stage-A procedure: what to search, extract, classify, and collect,
   per city.
4. The Stage-B command to actually run the import, plus the post-import
   review step.

## 1. JSON schema

Stage A must produce a single JSON file per city: a JSON array of row
objects. Each row is validated against `inputRow` (`main.go`) before import;
a row that fails validation is logged and skipped, not aborting the batch.

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | **required** | Non-empty after trimming whitespace. |
| `description` | string | optional | Free text. Empty string is fine. |
| `category` | string | **required** | Must be exactly one of the 12 taxonomy values (see below) — `activitiessvc.Category(...).Valid()` rejects anything else. |
| `lat` | number (float64) | **required** | Together with `lng`: rejected only when *both* are exactly `0` (no signal at all). |
| `lng` | number (float64) | **required** | See `lat`. |
| `country` | string | optional | 1:1 copy to the `country` column. |
| `city` | string | optional | 1:1 copy to the `city` column. |
| `address` | string | optional | 1:1 copy to the `address` column. |
| `rating` | number (float64) | optional | `0` means "no rating signal", not a real zero rating. |
| `details` | object (JSON) | optional | Must already be the exact per-category details shape (see §3) — passed through to the `details` JSONB column as-is, unvalidated by the importer. |
| `photo_urls` | array of strings | optional | Direct image URLs the importer downloads. Target ≥3 per activity (see §3); rows landing under 3 get tagged `needs-photos`, not rejected. |
| `source_url` | string | **required** | Non-empty after trimming. This is the upsert dedupe key — re-running the same city.json is idempotent because rows match on this field. |
| `raw` | object (JSON) | optional | The original scraped payload, stored as-is for later debugging/re-processing. |

The 12 valid `category` values (`activitiessvc.Category` constants,
`backend/shared/models/activitiessvc/activity.go`):

```
restaurants, cafes, bars, nightlife, nature, sport, kids, culture, art,
wellness, shopping, entertainment
```

## 2. Field ↔ column mapping

| JSON field | `activities` column | Transform |
|---|---|---|
| `title` | `title` | 1:1 |
| `description` | `description` | 1:1 (nullable) |
| `category` | `category` | 1:1, must be one of the 12 |
| `lat` + `lng` | `location` | `ST_MakePoint(lng, lat)` in importer |
| `country` | `country` | 1:1 |
| `city` | `city` | 1:1 |
| `address` | `address` | 1:1 |
| `rating` | `rating` | 1:1 (0 = no signal) |
| `details` | `details` | 1:1 — already the exact per-category JSONB shape |
| `photo_urls` | `photos` | importer downloads URLs → `/photos/...` refs (≥3) |
| `source_url` | `source_url` | 1:1 (dedupe key) |
| `raw` | `raw` | 1:1 |
| — | `source` | importer sets `'firecrawl'` |
| — | `status` | importer sets `'pending'` |
| — | `tags` | importer sets `['needs-photos']` when <3 photos |

Only `location` and `photos` transform; every other field is a direct column
copy with a matching name.

## 3. Stage-A procedure (per city)

Run this once per target city, in the Firecrawl/agent environment.

**a. Search, per category.** Run a `firecrawl-search` pass for each of the 12
categories against the target city, e.g. `"<category> in <city>"` (adjust
phrasing per category — "best nightlife spots in <city>", "top-rated bars in
<city>", etc.). Do this for all 12:

```
restaurants, cafes, bars, nightlife, nature, sport, kids, culture, art,
wellness, shopping, entertainment
```

**b. Extract.** For each promising result, run `firecrawl-extract` with a
schema matching §1 (title, description, category, lat, lng, country, city,
address, rating, photo_urls, source_url) plus whatever raw fields the page
exposes for the `raw` field.

**c. Classify and reshape.** For each extracted candidate:

- Map it to exactly one of the 12 categories above.
- Reshape ONLY the fields you actually extracted from the page into the
  matching `activitiessvc` details shape for that category (see the struct
  list below). Never invent prices, dishes, hours, or any other field the
  source page didn't actually show — an omitted (`omitempty`) field is
  always preferable to a fabricated one.
- The 12 details shapes (`backend/shared/models/activitiessvc/activity.go`),
  by category:
  - `restaurants` → `RestaurantDetails` (cuisine, price_tier, hours,
    open_status, popular_dishes []{name, price}, action_url, opening_hours*)
  - `cafes` → `CafeDetails` (known_for_brew, wifi_quality, hours, on_the_bar
    []{name, price}, opening_hours*)
  - `bars` → `BarDetails` (vibe, happy_hour_window, opens_time,
    signature_pours []string, action_url, opening_hours*)
  - `nightlife` → `NightlifeDetails` (entry_price, dress_code, opens_time,
    open_tonight, lineup []{time, act, stage}, action_url, venue_type,
    opening_hours*)
  - `nature` → `NatureDetails` (time_to_spend, best_time, cost, good_to_know
    []string)
  - `sport` → `SportDetails` (difficulty, effort_level, duration, gear,
    what_to_bring []string, action_url, discipline)
  - `kids` → `KidsDetails` (age_range, facilities []string)
  - `culture` → `CultureDetails` (venue_type, ticket_price, hours,
    now_showing {title, description}, action_url, opening_hours*)
  - `art` → `ArtDetails` (venue_type, ticket_price, hours, artwork {artist,
    work, medium}, current_exhibition {title, description}, action_url,
    year, opening_hours*)
  - `wellness` → `WellnessDetails` (treatments []{item, duration, price},
    external_booking_note, action_url, venue_type)
  - `shopping` → `ShoppingDetails` (venue_type, best_day, hours,
    what_youll_find []string, opening_hours*)
  - `entertainment` → `EntertainmentDetails` (genre, neighborhood,
    upcoming_shows []{date, title, time_or_price}, action_url)

  \* `opening_hours` (7 categories: restaurants, cafes, bars, nightlife,
  culture, art, shopping) is the optional **structured** weekly-hours shape,
  distinct from and coexisting with the free-text `hours`/`opens_time` field:
  `{"timezone": "<IANA zone, e.g. Europe/Belgrade>", "always_open": false,
  "periods": [{"day": "monday", "open": "09:00", "close": "23:00"}, ...]}`.
  Populate it only when the page shows a real weekly schedule you can map to
  zero-padded 24h `HH:MM` per weekday (a close earlier than open means the
  window rolls past midnight). Times must be zero-padded (`09:00`, not
  `9:00`) and `timezone` a valid IANA zone, or the admin surface rejects it
  on edit — when unsure, omit `opening_hours` and keep only free-text
  `hours`.

**d. Collect photos.** Pull `photo_urls` from the page's own gallery/images
(direct image URLs only). Target ≥3 per activity — Stage B still imports
rows short of 3, but tags them `needs-photos` for manual follow-up, so the
closer Stage A gets to 3, the less review work is left over.

**e. Write out `<city>.json`** as a JSON array of these rows, ready for
Stage B.

## 4. Stage-B command

Run the importer against the file produced above. First as a dry run (parses
and validates only — no DB or photo writes), then for real.

```bash
# Dry run: validate the file without touching the DB or photo volume.
docker compose run --rm \
  -e GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY" \
  -v "$PWD":/in \
  activities-service \
  go run ./cmd/importcity -dry-run /in/belgrade.json

# Real run: upserts rows (keyed on source_url, so re-running is safe) and
# downloads/backfills photos.
docker compose run --rm \
  -e GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY" \
  -v "$PWD":/in \
  activities-service \
  go run ./cmd/importcity /in/belgrade.json
```

Notes:

- `-v "$PWD":/in` mounts your local directory (containing `belgrade.json`)
  into the container at `/in` so the importer can read the Stage-A file —
  it isn't baked into the image. `docker compose run` otherwise reuses the
  `activities-service` service definition as-is, which is what gives the
  importer its DB connection (`DATABASE_URL`, pointed at `activities-db`)
  and, crucially, write access to the `photo-data` volume already mounted on
  that service in `docker-compose.yaml`. Without that inherited mount, the
  importer would have nowhere durable to save downloaded photos — this is
  the fork-A photo caveat: the importer and `activities-service` must share
  the same volume, never write to two different photo stores.
- `GOOGLE_MAPS_API_KEY` is only used for photo backfill when a row still has
  <3 photos after downloading `photo_urls`; omit it and backfill is simply
  skipped (rows stay tagged `needs-photos` instead).
- `DATABASE_URL` and `PHOTOS_DIR` are already set by the service's
  `environment:`/`volumes:` blocks in `docker-compose.yaml` — no need to
  pass them again on the command line.

**One-time fresh-start reset.** If you ever need to wipe the catalog and
re-import every city from scratch (not the normal per-city workflow — this
is a destructive, operator-triggered reset), truncate the table directly
against `activities-db` rather than writing a migration for it:

```sql
TRUNCATE activities;
```

This is a manual operational step, not a schema change — it belongs in an
operator's runbook, never in a migration file.

## 5. Review step

After a real (non-dry-run) import, everything lands as `status=pending` —
nothing is visible to the app until an admin approves it. In the admin
panel:

1. Filter the activities list by `status=pending`.
2. Review each row, paying particular attention to any tagged
   `needs-photos` (these came in under the 3-photo target and may need a
   manual photo added before publishing).
3. Approve each reviewed row to `status=published` (one at a time via the
   existing per-row status control — there is no bulk-approve action yet).
