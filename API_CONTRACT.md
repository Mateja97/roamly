# API Contract

The declared public API of this platform: `proxy-service`'s HTTP surface.
Per `ARCHITECTURE.md`, `proxy-service` is the only HTTP edge — the React
frontend and the React Native app talk to the backend *only* through the
routes below, so this document is the whole boundary. Everything else in the
repo (other services' gRPC surfaces, internal Go types, database schemas) is
free to change without notice; this file is not.

This document describes what the code in
`backend/proxy-service/internal/api/**` and
`backend/proxy-service/cmd/proxy-service/main.go` actually does, verified
against the handlers and their tests, not inferred from route names. Where a
shape could not be pinned down from source or tests, that gap is called out
explicitly rather than guessed.

## No version prefix

None of these routes carry a version segment (no `/v1/...`, no `/v2/...`).
There is nowhere to move a breaking change to — a MAJOR change to this
contract necessarily changes behavior for every client still calling the
old shape, in place. Until a version prefix exists, "backward-incompatible"
in the Breaking vs. additive section below is the operative safety net: a
MAJOR bump is the only signal a client integrator gets that they must
re-verify request/response shapes before upgrading.

## Global properties

### CORS

`middleware.CORS` wraps the entire mux (`main.go`: `middleware.CORS(mux)`),
so every route — including ones that don't exist — gets this behavior:

- Any request carrying an `Origin` header gets that origin reflected back
  verbatim in `Access-Control-Allow-Origin`, plus `Vary: Origin`. This is
  unconditional; there is no origin allow-list.
- An `OPTIONS` request is intercepted before mux dispatch and always
  answered `204 No Content` with `Access-Control-Allow-Methods: GET, POST,
  PATCH, OPTIONS`, `Access-Control-Allow-Headers: Content-Type,
  X-Admin-Token`, and `Access-Control-Max-Age: 300` — regardless of whether
  the path matches a real route. The wrapped mux is never reached for
  `OPTIONS`.
- No cookies/credentials are involved anywhere in this API (see
  Authentication below), which is why unconditional origin reflection is
  considered safe here — there is no session to leak cross-origin.

### Error response shape

Every non-2xx response (with the sole exception described under
`GET /healthz`) is JSON of the shape:

```json
{ "error": "<message>" }
```

written by `writeError`/`writeJSON` (`internal/api/respond.go`), always with
`Content-Type: application/json`. The admin-auth rejection path
(`internal/middleware/admin_auth.go`) writes the identical shape
independently (kept dependency-free of the `api` package) with the fixed
message `"invalid or missing admin token"`.

### HTTP status codes

`proxy-service` returns exactly one of six statuses for any gRPC-backed
route, plus two proxy-local ones (`400` for malformed request bodies/query
params rejected before a gRPC call is made, `413` for an oversize upload).
`writeGRPCError` (`internal/api/admin_translate.go`) is the single place
that maps a gRPC status code from an activities-service call onto HTTP:

| gRPC code | HTTP status |
|---|---|
| `codes.OK` | 200 |
| `codes.NotFound` | 404 |
| `codes.InvalidArgument`, `codes.FailedPrecondition` | 400 |
| `codes.PermissionDenied`, `codes.Unauthenticated` | 403 |
| `codes.AlreadyExists` | 409 |
| everything else (`Internal`, `Unavailable`, `DeadlineExceeded`, `Unknown`, ...) | 500 |

Success is always `200`, on every verb, including `POST` and `PATCH` — this
API never returns `201` or `204` for a successful write. `409` exists
specifically so a resource conflict stays distinguishable from a generic
internal failure. `POST /activities/query` and `GET /cities/suggest` are the
two routes that do **not** go through `writeGRPCError` — see their sections
below for their narrower status sets.

### Authentication

Two tiers, and nothing in between:

- **Public** — `GET /healthz`, `POST /activities/query`,
  `GET /activities/{id}`, `GET /activities/{id}/photos`,
  `GET /cities/suggest`, and `GET /photos/{path}` require no credential at
  all.
- **Admin** — every `/admin/*` route requires a `X-Admin-Token` header whose
  value exactly matches the server's `ADMIN_API_TOKEN` environment variable,
  compared with `crypto/subtle.ConstantTimeCompare` (`internal/middleware/admin_auth.go`).
  A missing or mismatched token gets `403 Forbidden` with the JSON body
  `{"error":"invalid or missing admin token"}`.

**The admin surface fails closed.** `RegisterAdminRoutes`
(`internal/api/admin_routes.go`) is only called from `main.go` with
`os.Getenv("ADMIN_API_TOKEN")`; when that value is empty, the function
registers **no** `/admin/*` patterns on the mux at all and returns `false`
(logged as a warning) — it does not register them open. A request to any
`/admin/*` path when the token is unset gets Go's stdlib `http.ServeMux`
default `404 Not Found`, indistinguishable from any other unmatched path.
This is deliberate and is contract: a deployment that forgets to set
`ADMIN_API_TOKEN` has no admin surface, never an open one, and a client
cannot use response shape (404 vs. some other body) to distinguish
"never deployed" from "wrong token" from "no token configured" — 404 covers
both "the token is unset" and "you mistyped the path."

This is a single static shared token, not per-user auth — see
`backend/proxy-service/README.md`'s "Admin authentication" section for the
accepted trade-off.

## Routes

### `GET /healthz`

Liveness probe. No parameters, no auth.

- **200** — body is the plain-text string `ok` (not JSON; no `Content-Type`
  is set explicitly, so this is the one response in the whole API that does
  not follow the JSON error/success shapes above).

### `POST /activities/query`

Public activity search — the app's main list/filter query. No auth.

**Request body** (all fields optional except `scope`):

```jsonc
{
  "scope": "nearby" | "anywhere",          // required
  "current_location": { "lat": 0, "lng": 0 },  // required for "nearby"; optional for "anywhere"
  "categories": ["restaurants", "cafes", ...], // any of the 13 taxonomy values (BUSINESS_STANDARDS.md); omitted/empty = no category filter
  "subcategories": ["fine_dining", ...],   // OR'd together, AND'd with categories; an unrecognized slug just matches nothing (not validated/rejected here)
  "min_rating": 0,
  "max_distance_km": 0,                    // 0 = uncapped; requires current_location or a non-empty cities to have effect
  "cities": [{ "lat": 0, "lng": 0 }]        // "anywhere" only: city centroids to anchor distance filtering on instead of current_location
}
```

An unrecognized key in the body (e.g. a field the backend has since
dropped) is silently ignored by `encoding/json` — this is deliberate, so a
stale client build never hard-fails a request over an obsolete field.

**Response body**, `200`:

```jsonc
{
  "activities": [
    {
      "id": "string",
      "title": "string",
      "description": "string",
      "category": "string",          // one of the 13 taxonomy values, lowercase snake_case
      "location": { "lat": 0, "lng": 0 },
      "country": "string",
      "rating": 0,
      "image_refs": [
        {
          "uri": "string",
          "attribution": { "author": "string", "link": "string (omitted if empty)" }, // present only for provider=="google" photos with a non-empty author
          "thumb_url": "string (omitted if empty)",
          "caption": "string (omitted if empty)"
        }
      ],
      "tags": ["string"],            // always an array, never null, even when empty
      "distance_km": 0,
      "details": { "...": "category-specific JSON object; \"{}\" if empty/malformed upstream" },
      "city": "string",
      "address": "string",
      "status": "published",         // always "published" — this route never returns draft/pending rows
      "subcategory": "string (\"\" if not set)",
      "review_count": 0,             // omitted (0) — always 0 on this route; only non-zero via GET /activities/{id}
      "google_reviews": [ /* omitted; always empty on this route */ ],
      "google_maps_uri": "string (omitted; always empty on this route)"
    }
  ]
}
```

`activities` is always present as an array (possibly empty, never `null`) —
an empty result set is `codes.OK` plus `[]`, not an error.

**Status codes:**
- `200` — success, including zero matches.
- `400` — malformed JSON body; unrecognized `scope`; unrecognized entry in
  `categories`; or `codes.InvalidArgument` from activities-service (its
  message is passed through as `error`).
- `500` — any other activities-service failure.

This route does not use `writeGRPCError`; it inlines the same `InvalidArgument`→400
mapping and defaults everything else to 500 (it never observes `NotFound`,
`AlreadyExists`, or `PermissionDenied` from this RPC).

### `GET /activities/{id}`

Public activity detail page. `{id}` is a required path parameter. No auth —
same public surface as `POST /activities/query`.

Backed by activities-service's live-merge RPC
(`GetActivityWithLiveDetails`): for a Places-sourced row this fetches fresh
Google Place Details at request time (never persisted) and merges them in.
This is the one route where `review_count`, `google_reviews`, and
`google_maps_uri` in the response DTO above can be non-empty.

**Response body**, `200`: the same `activityDTO` shape documented under
`POST /activities/query`, for the single requested activity.

**Status codes:**
- `200` — found (and published).
- `400` — malformed `{id}` (e.g. not a well-formed UUID) →
  `codes.InvalidArgument` from activities-service.
- `404` — no such activity, **or** the activity exists but is `draft`/`pending`
  (this route only ever returns published rows — a caller cannot distinguish
  "doesn't exist" from "exists but not published" from the response).
- `500` — any other failure.

### `GET /activities/{id}/photos`

Public per-activity photo set. `{id}` is a required path parameter. No auth.

Resolves (and persists server-side, on first view) any remaining Google
Photos beyond what's already stored; a Places-side failure during that
resolution falls back to whatever is already stored rather than failing the
request — so the only gRPC errors this route surfaces are `NotFound` (unknown
id) and `InvalidArgument` (malformed id).

**Response body**, `200`:

```json
{ "image_refs": [ /* same photoDTO shape as POST /activities/query's image_refs */ ] }
```

**Status codes:**
- `200` — success.
- `400` — malformed `{id}`.
- `404` — no such activity.
- `500` — any other failure.

### `GET /cities/suggest`

Public city-name typeahead. No auth.

**Query parameters:**
- `q` (string, optional) — partial city name. Missing or non-matching `q`
  returns an empty `suggestions` list, not an error; the app calls this on
  every keystroke.

**Response body**, `200`:

```json
{
  "suggestions": [
    { "city": "string", "country": "string", "centroid": { "lat": 0, "lng": 0 } }
  ]
}
```

**Status codes:**
- `200` — always, on any successful gRPC call, including zero suggestions.
- `500` — any activities-service failure (this route does not use
  `writeGRPCError` either, and does not special-case `InvalidArgument` — any
  error is 500).

### `GET /photos/{path}` (photo serving — `RegisterPhotoRoutes`)

Public, static file serving straight off the shared `/data/photos` volume
(configured via `PHOTOS_DIR`, default `/data/photos`) using stdlib
`http.FileServer`. No auth. Registered as the subtree pattern `GET
/photos/`, which cannot collide with any other route including `/admin/*`.

- **200** — file streamed with `http.FileServer`'s standard headers
  (`Content-Type` sniffed from extension/content, `Content-Length`, etc. —
  not the JSON envelope used elsewhere in this API).
- **404** — no file at that path (`http.FileServer`'s default).

Because this is `http.FileServer`, its full standard behavior applies
(directory listing is not exposed since no route serves `/photos/` bare with
a trailing structure meant for browsing; conditional requests `If-Modified-Since`/`Range`
are honored) — treat this route as "whatever `net/http`'s file server does,"
not as a bespoke JSON endpoint.

### Admin surface (`RegisterAdminRoutes`, `backend/proxy-service/internal/api/admin_*.go`)

Every route below requires the `X-Admin-Token` header described under
Authentication, and does not exist at all (404) when `ADMIN_API_TOKEN` is
unset. Every route uses the shared `writeGRPCError` mapping (the six-status
table above) for gRPC failures, and the shared `{"error": "..."}` body for
`400`s rejected before a gRPC call is made.

Shared response shapes across this surface:

```jsonc
// adminPhotoDTO — the admin photo shape (no attribution wrapper; that's the
// public app card's concern)
{ "url": "string", "thumb_url": "string (omitted if empty)", "caption": "string (omitted if empty)" }

// adminActivityDTO — the full activity view (GetActivity's response, and
// the created/updated row Create/Patch return)
{
  "id": "string", "title": "string", "description": "string",
  "category": "string", "city": "string", "address": "string",
  "status": "string",          // "published" | "draft" | "pending"
  "rating": 0,
  "details": { "...": "category-specific JSON object" },
  "photos": [ /* adminPhotoDTO */ ],
  "subcategory": "string (\"\" if not set)",
  "location": { "lat": 0, "lng": 0 },  // omitted entirely when the coordinate is (0,0) — the sentinel for "no admin-facing geocoding has run" — rather than a fabricated {0,0}
  "created_at": "RFC3339 string (omitted if empty)"
}
```

#### `GET /admin/activities`

List/search, any lifecycle status.

**Query parameters** (all optional):
- `q` (string) — free-text search.
- `category` (string) — one of the 13 taxonomy values; unrecognized value → `400`.
- `city` (string).
- `status` (string) — `published` | `draft` | `pending`; unrecognized value → `400`.
- `page`, `page_size` (integers) — a non-integer value silently falls back to
  `0`, which the backing service already treats as "use the default"; this
  route never 400s on `page`/`page_size` itself. `page_size` is forwarded
  as-is and may be clamped by activities-service — the response's
  `page_size` reflects what the service actually used, not what was
  requested.

**Response body**, `200`:

```jsonc
{
  "activities": [
    { "id": "string", "title": "string", "category": "string", "city": "string",
      "status": "string", "rating": 0, "photos": [ /* adminPhotoDTO */ ] }
  ],
  "total": 0, "page": 0, "page_size": 0,
  "stats": { "total": 0, "published": 0, "draft": 0, "pending": 0 }
}
```

**Status codes:** `200`; `400` (unknown `category`/`status`); the
`writeGRPCError` table for anything else.

#### `GET /admin/cities`

Every distinct city in the catalog, any status — unlike the public
`/cities/suggest`, no query prefix is required.

**Response body**, `200`: `{ "cities": ["string"] }` — always an array,
never `null`, even when the catalog is empty.

**Status codes:** `200`; the `writeGRPCError` table for a backend failure
(exercised in tests as `500`).

#### `GET /admin/activities/{id}`

The full activity, any lifecycle state.

**Response body**, `200`: `adminActivityDTO` (above).

**Status codes:** `200`; `404` if absent; the `writeGRPCError` table otherwise.

#### `POST /admin/activities`

Create.

**Request body:**

```jsonc
{
  "title": "string",           // required; missing/empty → 400 before any gRPC call
  "description": "string",
  "category": "string",        // required; must be one of the 13 taxonomy values → 400 if not
  "city": "string",
  "address": "string",
  "status": "string",          // optional; omitted → left unspecified on the wire, activities-service's service layer defaults it (observed default: draft); a non-empty unrecognized value → 400
  "details": { "...": "arbitrary JSON, passed through as a raw string" },
  "photos": [ /* adminPhotoDTO */ ],
  "subcategory": "string"      // optional; "" always valid; a non-empty value must belong to `category`'s subcategory set (BUSINESS_STANDARDS.md) → 400 if not
}
```

**Response body**, `200`: the created row as `adminActivityDTO`. **Not
`201`** — this API's success status is always `200`, on every verb.

**Status codes:**
- `200` — created.
- `400` — malformed JSON; missing `title`; unrecognized `category`;
  `subcategory` doesn't belong to `category`; unrecognized `status`; or
  `codes.InvalidArgument`/`codes.FailedPrecondition` from activities-service.
- `403`, `404`, `409`, `500` — per the `writeGRPCError` table (`403`/`409`
  are theoretical for Create as of this writing; no test exercises them,
  but the mapping function is shared and applies uniformly).

#### `PATCH /admin/activities/{id}`

Partial update. Every field is a JSON pointer/optional key: **a key absent
from the body leaves that field untouched**; a key present (even set to
`""`, `null` for `details`, or `[]` for `photos`) overwrites it. This
presence-vs-value distinction is load-bearing PATCH semantics, not
incidental — the request DTO uses pointer fields specifically so
`encoding/json` can tell "omitted" apart from "explicitly cleared."

**Request body** (all keys optional, same value shapes as `POST
/admin/activities` where they overlap): `title`, `description`, `category`,
`city`, `address`, `status`, `details`, `photos`, `subcategory`.

- Setting `category` alone (without `subcategory`) is not validated here —
  cross-checking the new category against the *existing* subcategory would
  need an extra read; that case relies on activities-service's own
  `InvalidArgument` and surfaces as `400` from there instead.
- Setting `category` and `subcategory` together **is** validated here, the
  same way `POST /admin/activities` validates them, before any gRPC call.

**Response body**, `200`: the updated row as `adminActivityDTO`.

**Status codes:**
- `200` — updated.
- `400` — malformed JSON; unrecognized `category`/`status`; `category` +
  `subcategory` set together and mismatched; or
  `InvalidArgument`/`FailedPrecondition` from activities-service.
- `404` — no such activity.
- `403`, `409`, `500` — per the `writeGRPCError` table.

#### `POST /admin/activities/{id}/photos`

Upload a photo. `{id}` is a required path parameter. `multipart/form-data`
body with the file under the field name `file`.

- The body is capped at 8 MiB (`http.MaxBytesReader`, enforced **before**
  any byte is read or forwarded to gRPC) — an oversize body never reaches
  activities-service.
- Image decode validation (is this actually a JPEG/PNG?) happens at
  activities-service, not here; a resulting `InvalidArgument` maps to `400`
  the same as any other admin write.

**Response body**, `200`: `{ "url": "string", "thumb_url": "string" }`.

**Status codes:**
- `200` — uploaded.
- `400` — missing `file` form field, or a non-image payload
  (`InvalidArgument` from activities-service).
- `413` — body exceeds 8 MiB.
- `404`, `403`, `409`, `500` — per the `writeGRPCError` table.

## Breaking vs. additive

Grounded in [SemVer 2.0.0](https://semver.org/); made concrete for this
specific wire contract.

**Breaking (MAJOR):**
- Removing or renaming a route (method+path pair), including a rename that
  only changes the path.
- Making a previously-optional request field or query parameter required.
- Removing a response field, or changing its JSON type (e.g. a field that
  was a string becoming an object, or a field that was nullable-and-absent
  becoming always-present-but-different).
- Narrowing what a field accepts on the request side (e.g. shrinking an
  enum of valid `category`/`status`/`scope` values, or a `min_rating` that
  used to accept any float now rejecting negatives).
- Changing which HTTP status code a given condition returns, **when an
  existing client could reasonably have branched on the old code** — e.g.
  a route that used to 404 on a bad input starting to 400 instead changes
  what a "not found vs. malformed" client-side branch sees.
- Changing the shape of the error body (`{"error": "..."}`) itself, or the
  CORS behavior in a way that stops browser clients from calling the API
  (e.g. no longer reflecting `Origin`).
- Any change to `/admin/*`'s fail-closed behavior (e.g. making the routes
  register even without a token) — this is a security contract, but it is
  also a wire-visible behavior change (404 → something else) and would be
  treated the same way a route appearing/disappearing is.

**Additive (MINOR):**
- Adding a new route.
- Adding a new optional request field or query parameter (one that, when
  omitted, preserves today's behavior exactly).
- Adding a new response field (existing clients that don't read it are
  unaffected; clients typically decode leniently, ignoring unknown keys —
  this API's own request decoding does exactly that, per `POST
  /activities/query`'s stray-field handling documented above).
- Widening what a field accepts (e.g. adding a new valid `category` or
  `status` value) — additive for existing clients, though a client with an
  exhaustive `switch` on the old value set may itself need updating; that
  risk is accepted the same way SemVer item 7 accepts it for MINOR.
- Marking a route/parameter/field deprecated while it keeps working
  unchanged (SemVer 2.0.0 item 7 — a MUST, not a MAY: a deprecation is
  never a PATCH).

**Bug fix, not a version-relevant contract change (PATCH):**
- Correcting a response to match what this document (or the route's own
  established behavior) already says it should have been — i.e. the wire
  contract's *description* doesn't change, only a previously-wrong
  implementation now matches it.
- Concretely: `80d0755` ("malformed activity id returns 400, not 500")
  changed `GET /activities/{id}` and `GET /activities/{id}/photos`'s
  response to a malformed id from `500` to `400`. This is a **bug fix, not
  breaking**, because `400` was already the documented, established
  response for `codes.InvalidArgument` everywhere else on this surface (see
  the HTTP status codes table above, which predates this fix) — `500` was
  never a contractual promise for "malformed id," it was a gap where an
  unmapped driver error fell through to the default case. A client that
  built retry/fallback logic around "malformed id sometimes 500s" was
  depending on a bug, not the contract; a client that already treated `400`
  as "bad request, don't retry" (the documented meaning) sees strictly
  more-correct behavior. The general rule this instance falls under: a
  status-code fix that makes an endpoint conform to *this document's own
  already-stated rules* is PATCH; a status-code change that redefines what
  a documented rule means, or introduces a new documented rule an existing
  client wasn't told to expect, is the breaking case in the list above.

## Known gaps

- The exact set of activities-service gRPC error conditions that can
  produce `codes.PermissionDenied`/`codes.Unauthenticated` (→ `403`) or
  `codes.AlreadyExists` (→ `409`) on the admin write routes
  (`POST /admin/activities`, `PATCH /admin/activities/{id}`,
  `POST /admin/activities/{id}/photos`) is not exercised by any test in
  `backend/proxy-service/internal/api` as of this writing — `writeGRPCError`
  maps them uniformly regardless of caller, so the mapping itself is
  verified, but no admin-route test constructs a fake client returning
  those two codes specifically. Treat those two statuses as reachable per
  the mapping table, not as unreachable dead code.
