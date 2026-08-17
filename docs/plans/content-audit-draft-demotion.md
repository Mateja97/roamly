# Content audit — fill the gap, then draft what stays empty

**Date:** 2026-08-17
**Slug:** `content-audit-draft-demotion`
**Status:** Brainstorming complete, decisions locked. Ready for planning.
**Relates to:**
[2026-08-02-activity-detail-system-design.md](2026-08-02-activity-detail-system-design.md)
— that spec built the typed-slot detail page and made every slot omit itself
when its data is absent. This spec is the consequence: a row with no data now
renders a page made almost entirely of correct absences, which reads to a user
as the old, pre-redesign layout. Also
[2026-07-30-places-live-details-design.md](2026-07-30-places-live-details-design.md)
(the read-time Places merge this audit reuses) and
[2026-08-01-wellness-entertainment-detail-page-design.md](2026-08-01-wellness-entertainment-detail-page-design.md)
(`websitesync`, the only thing that has ever produced body content at scale).

---

## The problem

Users still hit detail pages that look unbuilt: no photo, no description, no
fact strip, no unique section — hero, title, map, CTA, nothing else. The layout
is not at fault. Every slot is correctly omitting itself because it has no data.

Measured against the live catalog (8183 published rows: 7768 `google_places`,
317 `tripadvisor`, 98 `firecrawl`), three distinct causes:

| Gap | Rows | Cause |
| --- | --- | --- |
| Zero stored photos | 438 (348 Google, 90 TA) | All have an `external_id`, so `GetPhotos` re-attempts a live resolve on every detail open and keeps getting nothing. Nothing is persisted, so it never converges — and list cards, which read only stored photos, stay blank forever. |
| No place id at all | 98 (all `firecrawl`) | `withLiveDetails` returns at the `activity.ExternalID == ""` guard. These rows can never receive a description, fact strip, hours, reviews, or maps link. |
| Place id, but Google returns nothing renderable | unknown without fetching | No `editorialSummary`/`generativeSummary` and nothing the category mapper can fill. |

The third cause is not measurable from the database, and that is by design:
Places Terms §14.3 forbids caching detail content, so
`Activities.withLiveDetails` merges at read time and persists nothing
(`backend/activities-service/internal/service/activity.go`, `withLiveDetails`
doc comment). The stored `details` column is empty for most rows *and always
will be*. Any "is this row renderable?" verdict has to come from a job that
fetches, judges, and persists **only the verdict** — never the content.

### The finding that reshaped this spec

`placesmap.BuildLiveDetails` is the sole path from Google into a body block,
and across all 13 categories it emits exactly two of them: `good_to_know`
(nature) and `facilities` (kids). Everything else it produces is chips, an
hours row, or a website URL.

| Category | Published | Stored body block | What Places can add |
| --- | --- | --- | --- |
| shopping | 1443 | 0 | hours, venue type, website |
| cafes | 1391 | 0 | hours, `known_for`, website |
| **sport** | **1064** | **0** | **nothing — no `case` in the mapper at all** |
| nightlife | 865 | 0 | venue type, hours |
| culture | 788 | 0 | hours, venue type, website |
| nature | 602 | 0 | `good_to_know`, website |
| kids | 599 | 0 | `facilities`, website |
| entertainment | 551 | 349 | website, hours |
| wellness | 383 | 201 | venue type, website, hours |
| restaurants | 262 | 45 (`reviews`) | Google reviews via the T2 fallback |
| art | 204 | 0 | hours, venue type, website |
| bars | 31 | 1 (`reviews`) | Google reviews via the T2 fallback |

Only **550 of 8183 rows** carry a real body block today, and both categories
that have one got it from `websitesync` (firecrawl + Claude), not from Google.
For the other ten, the entire body is one live `editorialSummary` —
which Google supplies for a minority of venues.

So a "must have content" publish bar does not demote a few hundred stragglers.
Applied catalog-wide it could demote thousands, and sport — 1064 rows — can
never satisfy it from Google at any threshold.

**That is why this spec measures before it enforces.** The demotion rule is the
easy half. The number nobody knows yet is how much of the catalog it would
take, and guessing it wrong either does nothing or empties the app.

## Decisions

Locked during brainstorming:

1. **The publish bar is a photo AND some content.** Chips alone are not content.
2. **Two mechanisms, split by cost.** An offline sweep does what is free or
   cheap; the content verdict rides along on the Places call the detail page is
   already paying for. No standalone $200 full-catalog pass.
3. **Auto-demotion is reversible, human demotion is not.** A nullable
   `draft_reason` column distinguishes them.
4. **Enforcement ships dark.** The sweep defaults to `-dry-run`, the read-time
   verdict defaults to off. The first deliverable is a number, not a demotion.

## Architecture

### 1. One verdict function, two callers

New file `backend/activities-service/internal/service/renderable.go`:

```go
type Verdict struct {
	OK     bool
	Reason string // "" when OK; otherwise no_photo | no_place_id | no_content
	Score  int
}

func renderability(a activitiessvc.Activity, minScore int) Verdict
```

Pure function over an already-merged `activitiessvc.Activity`. No I/O, no
clients, no database. Both callers below hand it the exact activity the app
would render, so the verdict is never a proxy for what the user sees — it *is*
what the user sees.

Evaluated in order, first failure wins:

1. `len(a.Photos) == 0` → `no_photo`
2. no place id (`ExternalID` and `GooglePlaceID` both empty) **and** score below
   `minScore` → `no_place_id`
3. score below `minScore` → `no_content`
4. otherwise OK

Rule 2 exists so the 98 firecrawl rows get a reason that names their actual,
permanent problem rather than the generic one. A firecrawl row that carries
enough stored content to render passes on its own merits and is never demoted
for lacking a place id.

**Content score.** Counts what renders a block on the detail page, not what is
merely present in the JSON:

| Signal | Score |
| --- | --- |
| non-empty `Description` | 2 |
| a body block — `good_to_know`, `facilities`, `known_for`, `treatments`, `upcoming_shows`, `popular_dishes`, `what_to_bring`, `now_showing`, `current_exhibition`, `on_the_bar`, `signature_pours`, `what_youll_find`, `lineup`, `difficulty` | 2 |
| a quotable Tripadvisor `reviews` array | 2 |
| a non-empty merged `GoogleReviews` | 2 |
| presentational only — `opening_hours`, `venue_type`, `hours`, `website_url`, `tripadvisor`, `effort_level`, `gear` | 1 total, however many are present |

Each signal scores once, not per key: three chips are still one chip row, and
two body blocks are still one screenful of substance.

The presentational row is deliberately **one point for the whole group**, not
one point each. An earlier draft scored `opening_hours` and chips separately,
which summed to 2 and cleared a `minScore` of 2 on page furniture alone —
precisely the outcome the bar exists to prevent. With them sharing a point, no
combination of furniture can ever reach 2.

`minScore` defaults to **2** — "one real body block, or a description, or
quotable reviews; chips alone are not enough." It is a constant with a CLI flag
override, so a single dry-run can report the outcome at several thresholds.

Crediting `GoogleReviews` matters more than it looks: it is what keeps a
review-less Tripadvisor restaurant with no description from drafting, since the
T2 fallback fills that slot from Google and the page genuinely renders a reviews
section as a result.

**Two traps this scoring deliberately avoids:**

- *Tripadvisor rows.* Their content lives under a `tripadvisor` key (attribution,
  subratings, phone, `web_url`) and, for only 45 of 262 restaurants, a `reviews`
  array. Scoring `tripadvisor` as a body block would keep every restaurant;
  ignoring `reviews` would draft every restaurant. Both are wrong. `reviews`
  scores 2 because the reviews carousel genuinely renders; the bare `tripadvisor`
  key scores 1 as a chip. A review-less Tripadvisor row is judged on its Google
  content instead, which is exactly the path
  `withTripadvisorGoogleReviews` already puts it on post
  `tripadvisor-marks-require-reviews` T2.
- *Drift.* The app decides what renders in
  `app/src/features/activity-list/activityDetailConfig.ts`; this scoring is a
  second, Go-side statement of the same thing. Rather than re-derive it, the key
  list is short, explicit, and guarded by a test asserting every key it names
  still appears in `placesmap.BuildLiveDetails`'s output or in
  `activitiessvc`'s details shapes. A key disappearing from the mapper fails the
  build, in the spirit of `610705a` ("fail the build if Tours ever gets a
  provider").

### 2. `cmd/auditcontent` — the sweep

Modelled directly on `cmd/backfillgoogleplaceid`: sequential rather than a
worker pool, a fixed pace between Places calls, every row written the moment it
resolves, and resumable by simply re-running — no checkpoint file. A
build/maintenance-time tool, never wired into `activities-service`'s startup.

Per published row:

1. **Fill.** Photos empty and a place id present → `places.ResolvePhotos` or
   `tripadvisor.LocationPhotos`, chosen by the same `source == "tripadvisor"`
   switch `GetPhotos` uses. Persist on success. This is the only step that
   writes Google-derived content, and it writes exactly what `GetPhotos`
   already persists today — no new caching posture.
2. **Fetch.** Place id present → one `PlaceDetails` call, merged through the
   same code path `withLiveDetails` uses, so the judged activity is byte-for-byte
   what a detail-page request would produce. Never persisted.
3. **Judge.** `renderability()`. Failure → `status = 'draft'`,
   `draft_reason = <reason>`. Pass → if the row is currently `draft` with a
   non-null `draft_reason`, republish it and clear the reason.

Rows with `status = 'pending'` are out of scope: `pending` is the existing
firecrawl review queue (107 rows) and belongs to a human workflow this tool must
not touch.

**Flags:**

> As shipped, this table is superseded — see
> [content-audit-draft-demotion-plan.md](content-audit-draft-demotion-plan.md)'s
> "Deviation from the spec, and why": `cmd/auditcontent` shipped report-only
> with no `-dry-run` flag at all, and `-limit` defaults to 200, not 0.

| Flag | Default | Purpose |
| --- | --- | --- |
| `-dry-run` | **true** | Report only. No writes of any kind, including step 1's photo fill. |
| `-limit N` | 0 (all) | Bound the run — a 200-row sample costs a few dollars, not $200. |
| `-category X` | "" (all) | Scope to one category. |
| `-min-content N` | 2 | Override the threshold. |

**Dry-run output** is the actual first deliverable: a per-category table of
would-draft counts broken down by reason, plus the distribution of content
scores. The publish bar gets chosen by reading that table, not by argument.

### 3. Read-time verdict

`withLiveDetails` already holds the merged activity and has already paid for the
Places call. After the merge it runs `renderability()`; on failure it issues a
best-effort `repo.Update(status=draft, draft_reason=…)`, ignores any error, and
serves the page to the current viewer regardless — demoting a page out from
under the person reading it would be worse than the bare page.

This is a write on a read path, which `GetPhotos` already establishes as the
house pattern for exactly this situation (resolve-and-persist on first view,
never fail the request over the write).

Gated behind `CONTENT_AUDIT_ENFORCE`, **default off**, so measuring and
enforcing are two separate decisions with two separate rollbacks.

Its reach is deliberately partial: it only ever fires for rows someone opens,
and never for the 98 rows that have no place id to fetch with. The sweep is the
mechanism; this is a self-healing top-up that keeps the catalog honest between
sweeps.

### 4. Schema

> Shipped as `0033_draft_reason.sql`, not `0032` — the migration sequence had
> moved on by the time this landed. Other shipped deviations from this spec
> are tracked in
> [content-audit-draft-demotion-plan.md](content-audit-draft-demotion-plan.md)'s
> "Deviation from the spec, and why".

`0033_draft_reason.sql`:

```sql
ALTER TABLE activities ADD COLUMN draft_reason text;
```

Nullable, no default, no constraint. `NULL` means "a human decided this" and the
sweep never touches such a row in either direction — the same principle the
existing re-import path already protects (`integration_test.go`: "re-import must
not un-publish an admin-approved row"), applied to the republish direction.

Repository changes: include `draft_reason` in the row scan, add it to
`UpdatePatch`, and expose it on the admin `ListFilter` so a follow-up admin
screen can query by reason.

### 5. Required refactor

Step 2 of the sweep needs the Places merge without
`GetByIDWithLiveDetails`' published-only gate and without its 4-second
request-scoped timeout. Split `withLiveDetails` so the merge is callable with a
caller-supplied context, leaving `GetByIDWithLiveDetails` as the thin public
wrapper it already is. Small, but named here so it is planned rather than
discovered.

### 6. Out of scope

- **No app changes.** `GetByIDWithLiveDetails` already 404s a non-published row,
  and the public list query is already `status = 'published'`. A demoted row
  disappears from both surfaces with no client work.
- **No admin-frontend work.** The `draft_reason` column is added and populated;
  surfacing it in the admin activities screen is a follow-up.
- **No new caching of Places content.** Photos, and only photos, as today.
- **No `websitesync` extension.** Sourcing body content for the other ten
  categories is the real fix for the bare-page symptom and is a much larger
  project. This spec produces the measurement that would justify it.

## Error handling

Every failure mode degrades toward "leave the row alone", never toward a
demotion on incomplete evidence:

| Failure | Behaviour |
| --- | --- |
| `PlaceDetails` errors or times out | Log a warning, skip the row entirely, no verdict, no write. Same contract as `resolvePlaceDetails` today. |
| `ResolvePhotos` errors or returns empty | Photo fill did not happen; the row is judged on its stored photos, which is the honest state. |
| Photo persist fails | Log, continue. Next run retries; the `WHERE photos = '[]'` read is the whole resume mechanism. |
| Status update fails | Log, continue. Re-running re-judges and re-attempts. |
| Malformed stored `details` JSON | Scores 0 for detail-derived signals rather than erroring — the same best-effort decode `hasTripadvisorReviews` and `mergeLiveDetails` already use. |
| No places client configured | The sweep exits with a clear error rather than drafting the entire catalog for `no_content`. |

That last row is the important one: an unconfigured API key must never be
mistaken for "Google has nothing on this venue."

## Testing

- `renderable_test.go` — table-driven over the scoring rule and the ordered
  reasons, with named cases for every trap above: a Tripadvisor row with
  `reviews`, one without, a firecrawl row with stored content, a sport row with
  a photo and nothing else, a chips-only row at the boundary.
- The drift guard — asserts every key the scorer names still appears in
  `placesmap.BuildLiveDetails`'s output or in `activitiessvc`'s details shapes.
- Repository integration — `draft_reason` round-trips; an auto-drafted row
  republishes and clears its reason; an admin-drafted row (`NULL`) is untouched
  in both directions; a `pending` row is never selected.
- `cmd/auditcontent` — against a fake places client: `-dry-run` performs zero
  writes including the photo fill, `-limit` and `-category` bound the selection,
  each reason maps to the right rows, and an unconfigured client is a hard error
  rather than a catalog-wide demotion.

## Sequencing

1. Schema, repository, and `renderability()` with its tests.
2. `cmd/auditcontent` with `-dry-run` defaulted on.
3. **Run a sampled dry-run and read the table.** Choose `minScore` from it.
4. Enable writes on the sweep at the chosen threshold.
5. Only then, `CONTENT_AUDIT_ENFORCE` on the read path.

Steps 1–3 are the deliverable that answers the open question. Steps 4–5 are a
flag flip each, and each is independently revertible.
