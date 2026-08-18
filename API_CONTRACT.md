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

Every non-2xx response **that a handler in this repo writes** is JSON of the
shape:

```json
{ "error": "<message>" }
```

written by `writeError`/`writeJSON` (`internal/api/respond.go`), always with
`Content-Type: application/json`. The admin-auth rejection path
(`internal/middleware/admin_auth.go`) writes the identical shape
independently (kept dependency-free of the `api` package) with the fixed
message `"invalid or missing admin token"`.

This scoping matters: it is **not** true of every non-2xx response the
server can produce. `http.ServeMux` and `http.FileServer` answer some
requests themselves, before any handler in this repo runs, and they write
their own stdlib bodies — plain text, not this JSON shape. See "Responses
`net/http` writes itself" below for exactly which ones and probe-verified
output.

### Responses `net/http` writes itself

These are wire-visible on every route and are not written by any handler in
this repo — `http.ServeMux`/`http.FileServer` produce them directly, with
their own status codes and headers (`text/plain` bodies for the two 4xx
cases below; the redirect below carries a minimal auto-generated HTML
body, not `text/plain`) (verified by probing a mux built from this
package's real route registrations):

- **`404 Not Found`, unmatched path** — no route pattern matches. Body
  `404 page not found\n`, `Content-Type: text/plain; charset=utf-8`. This is
  the same response the fail-closed admin surface relies on (see
  Authentication below) — an unmatched path and a never-registered `/admin/*`
  route are, correctly, identical.
- **`405 Method Not Allowed`** — the path matches a registered pattern but
  not this method. Body `Method Not Allowed\n`,
  `Content-Type: text/plain; charset=utf-8`, plus an `Allow` header listing
  the methods that *are* registered for that path (probe: `DELETE
  /activities/abc` → `405`, `Allow: GET, HEAD`).
- **`HEAD` on every `GET` route** — `net/http`'s `ServeMux` answers `HEAD`
  for any pattern registered as `GET` automatically; every `GET` route in
  this document also accepts `HEAD` (headers only, no body), without the
  handler needing to do anything.
- **`307 Temporary Redirect`, `GET /photos` (no trailing slash) only** —
  `net/http`'s `ServeMux` itself redirects a bare request for a
  registered trailing-slash subtree pattern (`GET /photos/`) to the
  slash-terminated form, **before `http.FileServer` ever runs** (probe:
  `GET /photos` → `307`, `Location: /photos/`, `Content-Type: text/html;
  charset=utf-8`). This is the only redirect left in this API: an earlier
  revision of this document also listed a `301` that `http.FileServer`
  produced for a real subdirectory requested without a trailing slash —
  that redirect (and the directory listing it led into) no longer happens
  as of #210; see `GET /photos/{path}` below for the current, narrower
  behavior.
- Conditional-request headers (`If-Modified-Since`, `Range`, etc.) are
  honored by `http.FileServer` on `/photos/*` per its stdlib defaults; not
  re-verified item-by-item here, but treat that route as "whatever
  `net/http`'s file server does," not a bespoke JSON endpoint.

None of the above carry the `{"error": "..."}` envelope, and a client
parsing every non-2xx body as that JSON shape will fail to parse these.

### HTTP status codes

For any request a handler in this repo actually processes,
`proxy-service` returns exactly one of six statuses for any gRPC-backed
route, plus two proxy-local ones (`400` for malformed request bodies/query
params rejected before a gRPC call is made, `413` for an oversize upload).
This is the handler-level contract; it does not cover `404`/`405`/`307`,
which `net/http` itself can produce before a handler runs — see "Responses
`net/http` writes itself" above.
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
default `404 Not Found`, `text/plain`, indistinguishable from any other
unmatched path — verified by probe: unset token, `GET /admin/activities`
→ `404`, `Content-Type: text/plain; charset=utf-8`, body
`404 page not found\n`. This is deliberate and is contract: a deployment
that forgets to set `ADMIN_API_TOKEN` has no admin surface, never an open
one.

That said, **"no admin surface" and "wrong credential" are themselves
plainly distinguishable from each other**, by both status and body: unset
token → `404` `text/plain` `404 page not found\n` (route absent, per
above); token configured but the request's header is missing or wrong →
`403` JSON `{"error":"invalid or missing admin token"}` (route present,
credential rejected) — verified by probe. A client that gets `403` knows
for certain the admin surface is deployed and reachable and only the
credential was wrong; it is only "never deployed" vs. "you mistyped the
path" that stay indistinguishable from each other, both being ordinary
`404`s — the fail-closed guarantee is about *that* pair, not about hiding
whether the admin surface exists at all from a caller who already has some
`X-Admin-Token` value to try.

One more edge the check itself doesn't cover: `RegisterAdminRoutes` tests
`adminToken == ""` only — a value like `" "` (a single space) or a token
with a stray trailing newline is non-empty and registers `/admin/*` with
that literal string as the required credential, rather than being treated
as "unset." This is unlikely in practice (`os.Getenv` on a genuinely unset
variable returns `""`) but is reachable if the environment sets the
variable to whitespace; not currently trimmed in code.

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

This route routes every gRPC error through `writeGRPCError` (verified by
probe: feeding each of `FailedPrecondition`, `PermissionDenied`,
`Unauthenticated`, `AlreadyExists` through the handler produces `400`,
`403`, `403`, `409` respectively, matching the shared table above exactly —
this is **not** a narrower "InvalidArgument→400, else 500" route like
`POST /activities/query`).

**Status codes:** the `writeGRPCError` table above, in full. Concretely for
this route:
- `200` — found (and published).
- `400` — malformed `{id}` (e.g. not a well-formed UUID) →
  `codes.InvalidArgument`; also reachable on `codes.FailedPrecondition`.
- `403` — `codes.PermissionDenied`/`codes.Unauthenticated`.
- `404` — no such activity, **or** the activity exists but is `draft`/`pending`
  (this route only ever returns published rows — a caller cannot distinguish
  "doesn't exist" from "exists but not published" from the response).
- `409` — `codes.AlreadyExists`.
- `500` — everything else. As of this writing, activities-service's actual
  `GetActivityWithLiveDetails` implementation is only observed to return
  `NotFound`/`InvalidArgument`/`Internal` for this RPC — `403`/`409` are
  reachable through the shared mapping if the upstream ever returns those
  codes, not exercised by any current test or real code path.

### `GET /activities/{id}/photos`

Public per-activity photo set. `{id}` is a required path parameter. No auth.

Resolves (and persists server-side, on first view) any remaining Google
Photos beyond what's already stored; a Places-side failure during that
resolution falls back to whatever is already stored rather than failing the
request. This route also goes through `writeGRPCError` in full (same
probe-verified behavior as `GET /activities/{id}` above) — as of this
writing, activities-service's `GetActivityPhotos` implementation is only
observed to return `NotFound`/`InvalidArgument` for it, but `403`/`409` are
reachable through the shared mapping the same way.

**Response body**, `200`:

```json
{ "image_refs": [ /* same photoDTO shape as POST /activities/query's image_refs */ ] }
```

**Status codes:** the `writeGRPCError` table above. Observed in practice:
- `200` — success.
- `400` — malformed `{id}`.
- `404` — no such activity.
- `500` — everything else. `403`/`409` are reachable through the shared
  mapping but not currently exercised by any test or real code path here.

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
`http.FileServer` wrapped in a directory-refusing `http.FileSystem`
(`noDirListingFS`, added in #210 — see below), fed by an `os.Root` opened
on the volume (see the symlink-escape fix below) rather than `http.Dir`.
No auth. Registered as the subtree pattern `GET /photos/`, which cannot
collide with any other route including `/admin/*`.

- **200** — a file, streamed with `http.FileServer`'s standard headers
  (`Content-Type` sniffed from extension/content, `Content-Length`, etc. —
  not the JSON envelope used elsewhere in this API). Probe-verified against
  a real fixture: `Content-Type: image/jpeg` for a `.jpg`. A symlink inside
  the volume whose target also resolves inside it is unaffected by the fix
  below and stays servable exactly like any other file — deliberate, not
  an oversight: it doesn't escape the volume, so there's nothing to refuse
  (probe-verified).
- **404** — no *file* at that path, **and, as of #210, any directory
  path too** — `GET /photos/`, `GET /photos/sub`, `GET /photos/sub/` all
  `404` now, whether or not `sub` actually exists as a directory
  (probe-verified). Directories are made indistinguishable from missing
  files on purpose (see below); a `404` here does not imply the path never
  existed, only that nothing servable does. **As of the symlink-escape fix
  (`c89f907`), also covers:** a symlink inside the volume whose target
  resolves *outside* `/data/photos` (file or directory target, both
  probe-verified), and a file the process can't read due to filesystem
  permissions — `noDirListingFS` now normalizes every `Open` failure from
  the volume, not just "is a directory," to `fs.ErrNotExist`, so a
  rejected symlink and an unreadable file both collapse into the same
  `404` as a plain missing file, on purpose: an unauthenticated caller
  gets no signal distinguishing "not there" from "refused." This is a
  status-code change worth flagging precisely: this document never
  previously stated what an unreadable file returned, so there was no
  established `403` here for this route to break — see "Breaking vs.
  additive" below for why that makes it a bug fix, not a `403`→`404`
  regression against a documented promise.
- **307** — the bare, no-trailing-slash request for this route's own root,
  `GET /photos` (no path after it) *only*, redirects to `/photos/` —
  `net/http.ServeMux`'s own subtree-pattern redirect, fired before
  `http.FileServer` or the directory wrapper ever run (probe: `GET
  /photos` → `307`, `Location: /photos/`; the redirect target itself then
  `404`s per the point above). See "Responses `net/http` writes itself"
  above for why this is a different producer than ordinary file serving.
  This is the only redirect this route produces — the `301` a subdirectory
  request used to get (documented in an earlier revision of this
  document) is gone as of #210: see below.

**Fixed in #210 (`df8e2e1`, merged): `GET /photos/` no longer serves a
directory listing, and no longer 301-redirects a bare subdirectory path
either.** An earlier revision of this document described the listing as
current, present behavior on `main` at the time — that was accurate then
and is the reason #210 exists, but it is stale now that the fix has
landed; this section describes the **current** state. Mechanism: a
`noDirListingFS` wrapper around the volume's `http.FileSystem` makes
`Open` return `fs.ErrNotExist` for any directory (`internal/api/photo_routes.go`),
so `http.FileServer` treats every directory exactly like a missing file —
before it ever gets far enough to list one or to redirect a bare
subdirectory path toward a trailing slash (that redirect only used to fire
*because* `FileServer` had successfully opened the directory; refusing the
`Open` removes the precondition for both behaviors at once, not just the
listing).

**Fixed (`c89f907`, this branch): a symlink inside the volume that pointed
outside `/data/photos` used to be followed and served with a `200`,
leaking the target's bytes.** `http.Dir` rejects a `..` in the request
path but still follows a symlink already sitting in the volume out past
the root — a gap in the previous mechanism, not something #210's fix
touched. `RegisterPhotoRoutes` now opens the volume with `os.OpenRoot`
instead of `http.Dir` and serves via `http.FS(root.FS())`: `os.Root`
confines every `Open` — symlink or not — to inside `root` and errors on
anything that would resolve outside it, so `noDirListingFS`'s
`fs.ErrNotExist` normalization (above) turns that rejection into the same
`404` a missing file gets, never a `200` with the target's bytes
(probe-verified for both a symlink-to-file and a symlink-to-directory
target outside the volume). File serving itself — content, `Content-Type`,
`..`-traversal rejection, Range/conditional-request handling — is
unaffected; it is still the same `http.FileServer`, only fed a
traversal-resistant `fs.FS` instead of `http.Dir`.

Conditional-request headers (`If-Modified-Since`, `Range`, `If-Range`, etc.)
are honored by `http.FileServer` on this route per its stdlib defaults —
probe-verified as of the symlink-escape fix above (`Range` → `206`, an
out-of-range `Range` → `416`, a future `If-Modified-Since` → `304`, `Range`
+ a matching `If-Range` → `206`), specifically to re-pin that swapping
`http.Dir` for `os.Root` didn't change this: `http.FS(root.FS())` still
hands `http.FileServer` a `Seek`-able, `Stat`-able file, same as
`http.Dir` did. Treat everything else about this route as "whatever
`net/http`'s file server does," not a bespoke JSON endpoint.

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

Partial update. Every field is a Go pointer decoded from a JSON key:
**a key absent from the body leaves that field untouched.** Beyond that,
the semantics split by what the key is set *to*, and this is where a naive
"presence = intent" reading is wrong — verified by decoding the DTO
directly, not by reading the struct tags:

- **A key explicitly set to JSON `null`** (e.g. `{"details": null}`,
  `{"title": null}`) decodes to a **nil pointer — exactly the same as the
  key being absent.** `encoding/json` sets a pointer field to `nil` for a
  literal JSON `null` regardless of the pointed-to type, so this holds for
  every field on this DTO (`title`, `description`, `category`, `city`,
  `address`, `status`, `details`, `photos`, `subcategory` alike): **`null`
  never clears a field here — it is indistinguishable from omitting the key
  entirely, and the handler forwards nothing for it.** A client that sends
  `null` intending "clear this value" is silently a no-op.
- **A key set to its type's non-null empty value** — `""` for the string
  fields, `[]` for `photos` — decodes to a **non-nil pointer to that empty
  value**, distinguishable from both "omitted" and "null," and **does**
  overwrite the field: `{"address": ""}` clears `address` to empty (proven
  by `TestAdminPatchActivity_EmptyStringIsSetNotOmitted`);
  `{"photos": []}` replaces the photo list with an empty one (probe-verified:
  decodes to a non-nil pointer to a zero-length slice, which the handler
  forwards as an explicit empty `PhotoList`). To clear `details` to an empty
  object, send `{"details": {}}` — a literal empty JSON object, not `null`.
- A key set to any other non-empty value overwrites the field with that
  value, as expected.

The request DTO uses pointer fields specifically so `encoding/json` can
tell "omitted" apart from "present" — but "present, and JSON `null`" still
collapses back onto "omitted" for every field, which is the one case worth
calling out explicitly since it is easy to assume `null` means "clear."

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
- Changing which HTTP status code a given condition returns, **when the old
  code was itself this document's stated, established behavior for that
  condition** — e.g. this document says a route 404s on a bad input and a
  change makes it 400 instead; that changes what a "not found vs.
  malformed" client-side branch sees, and an existing client was entitled
  to rely on what was documented. **This bullet explicitly does not cover
  a status-code change that instead makes an endpoint conform to what this
  document already stated — that is the Bug fix / PATCH case below, and
  when the two appear to conflict, PATCH wins: the deciding question is
  always "what did this document say the old behavior was," not "did an
  existing client's code branch on it." A client's code branching on an
  undocumented, buggy status is not the contract; only this document is.**
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
- Concretely, a second instance: `c89f907` (the `/photos/{path}`
  symlink-escape fix, this branch) makes a symlink inside the volume that
  resolves outside `/data/photos` return `404` instead of `200` with the
  target's bytes, and — as a side effect of the same `noDirListingFS`
  normalization — makes an unreadable file return `404` instead of the
  `403` `http.Dir`'s stdlib error path used to produce. Both are **PATCH**,
  by two different routes through the same rule above:
  - The symlink case is a bug fix outright, not even a close call — no
    client could ever have legitimately depended on reading an arbitrary
    host file through a public photo route by planting a symlink; that
    capability was never something this document (or any sane reading of
    "public photo serving") promised, so removing it isn't narrowing a
    promise, it's closing a hole.
  - The `403`→`404` collapse is the same "was it established behavior"
    test the `500`→`400` case above turns on, applied to a case this
    document has no prior claim about either way: nothing in this
    document, before this fix, said what an unreadable file returned —
    `http.Dir`'s `403` was stdlib's default, never written down here as a
    promise. No established behavior, so nothing to break.

## Known gaps

- **Resolved, not an open gap: `GET /photos/` used to serve a full
  directory listing of the photos volume; #210 (`df8e2e1`) fixed it.** An
  earlier revision of this document described the listing as current,
  present behavior — accurate at the time, on `main` as it stood then —
  and flagged it here as a tracked defect rather than an accepted design
  decision. #210 has since merged to `main` and this document's `GET
  /photos/{path}` section above has been updated to match (the listing is
  gone, the old `301` subdirectory redirect is gone with it, and every
  directory path now `404`s). Left as a Known gaps entry, past tense,
  rather than deleted outright, as a record of the drift: #210 is an
  ordinary code change and did not pass through Phase 6 of
  `run-audit-auto.md` (that phase only runs against tasks merged through
  this pipeline's own dispatch) — nothing automated prompted this
  document's update when #210 merged; it was updated by hand, in the same
  pass that merged `origin/main` into this branch and re-probed the route
  to confirm the new behavior. A future fix landing outside the pipeline
  has the same gap and the same fix: someone has to notice and re-probe.
- The exact set of activities-service gRPC error conditions that can
  produce `codes.PermissionDenied`/`codes.Unauthenticated` (→ `403`) or
  `codes.AlreadyExists` (→ `409`) is not exercised by any test in
  `backend/proxy-service/internal/api` as of this writing, on **any** route
  that goes through `writeGRPCError` — not just the admin write routes:
  `GET /admin/activities/{id}`, `GET /admin/activities`, `GET
  /admin/cities`, `GET /activities/{id}`, and `GET /activities/{id}/photos`
  all share the same gap. `writeGRPCError` maps them uniformly regardless of
  caller, so the mapping function itself is verified (probed directly with
  synthetic gRPC errors), but no route-level test anywhere in this package
  constructs a fake client returning those two codes specifically. Treat
  `403`/`409` as reachable per the mapping table on every `writeGRPCError`
  caller, not as unreachable dead code on some subset of routes.
- **`RegisterAdminRoutes`'s fail-closed check is `adminToken == ""`, not a
  trimmed/whitespace-aware check.** An `ADMIN_API_TOKEN` set to a
  whitespace-only or trailing-newline value is non-empty and registers
  `/admin/*` with that literal string as the required credential, rather
  than being treated as unset. Not currently trimmed in code; noted here
  rather than silently assumed safe.
- **Provenance of the claims in this document is mixed, and worth being
  precise about**, since a wrong claim here can now suppress a real SemVer
  bump (`.claude/commands/run-audit-auto.md`'s MAJOR-rule step treats this
  document as authoritative, and on a doc-vs-code disagreement pushes the
  run to the ambiguous outcome rather than trusting the document): route
  existence, DTO shapes,
  and the six-status `writeGRPCError` mapping are verified by reading
  handler source directly. Wire-visible edge behavior — the stdlib-mux
  404/405/307/HEAD responses, the `/photos/{path}` directory/file
  distinction (both before and after #210), the `/photos/{path}`
  symlink-escape rejection and Range/conditional-request behavior (both
  before and after the `os.Root` fix, `c89f907`), the PATCH
  `null`-vs-empty-value semantics, the admin-auth 404-vs-403
  distinguishability, and the multipart upload's implicit `Content-Type`
  requirement — was verified by **probing**: building a mux from this
  package's real route registrations and issuing real
  `net/http/httptest` requests against it, not by reading and assuming.
  An earlier version of this document got several of these wrong by
  reasoning about `http.FileServer`/`encoding/json` from memory instead
  of probing, and later revisions re-probed after `origin/main` moved
  (#210 merged mid-review; the `os.Root` symlink-escape fix again after
  that) to confirm this document's `/photos` section still matched; treat
  any future edit to this document that isn't probe- or test-verified as
  suspect, and re-probe rather than assume nothing changed underneath a
  claim just because it was correct once.

## Not part of the contract (unpinned)

These are observable today but this document makes no promise about them —
none are validated against a stated rule, so a client depending on the
*current* value rather than the documented range is depending on
incidental behavior:

- `page`/`page_size`'s default and clamp bounds on `GET /admin/activities`
  (the response's `page`/`page_size` reflect whatever activities-service's
  service layer actually used; this document only pins that the proxy
  forwards the raw requested values and echoes back the service's answer,
  not what the bounds themselves are).
- Ordering of `activities` in `POST /activities/query`'s and `GET
  /admin/activities`'s responses, and of `suggestions` in `GET
  /cities/suggest`.
- `id` format (observed as UUID-shaped strings; not stated as a guaranteed
  format for future rows).
- Photo URL format — `image_refs[].uri`/`adminPhotoDTO.url` may be a
  server-relative path (`/photos/...`, admin-uploaded) or an absolute
  external URL (Google-sourced), and this document does not promise which
  form applies to which source going forward.
- Response `Content-Type` beyond "the JSON routes send
  `application/json`, `GET /healthz` and stdlib-written responses don't" —
  no promise about charset parameters or exact casing.
- Request `Content-Type` on the JSON routes (`POST /activities/query`,
  every admin JSON body) — none of them check the header; sending JSON
  with the wrong or missing `Content-Type` still decodes. **This does not
  extend to `POST /admin/activities/{id}/photos`**: `r.FormFile` needs the
  multipart boundary that only a correct `multipart/form-data;
  boundary=...` `Content-Type` carries, so a missing or wrong
  `Content-Type` there fails the same way a missing `file` field does
  (probe-verified: `400`, `{"error":"missing \"file\" form field"}`) —
  that route effectively requires the right `Content-Type` even though no
  line of code checks the header directly.
- Server read/write timeouts and any body size limit other than the
  explicit 8 MiB cap on `POST /admin/activities/{id}/photos` (no other
  route in this document has an enforced request body size limit stated in
  source).
