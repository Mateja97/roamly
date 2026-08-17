# Content audit — fill the gap, then draft what stays empty

**Date:** 2026-08-17
**Slug:** `content-audit-draft-demotion`
**Status:** Brainstorming complete, decisions locked. Ready for planning.
**Relates to:** `2026-08-02-activity-detail-system-design.md` — that spec
built the typed-slot detail page and made every slot omit itself when its
data is absent. This spec is the consequence: a row with no data now renders
a page made almost entirely of correct absences, which reads to a user as
the old, pre-redesign layout. Also `2026-07-30-places-live-details-design.md`
(the read-time Places merge this audit reuses) and
`2026-08-01-wellness-entertainment-detail-page-design.md` (`websitesync`, the
only thing that has ever produced body content at scale). None of the three
are in this repo — they live under `docs/superpowers/`, which `.gitignore`
excludes — so these are names for context, not links.

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
| presentational only — reviews (`reviews`, merged `GoogleReviews`), `opening_hours`, `venue_type`, `hours`, `website_url`, `tripadvisor`, `effort_level`, `gear` | 1 total, however many are present |

Each signal scores once, not per key: three chips are still one chip row, and
two body blocks are still one screenful of substance.

The presentational row is deliberately **one point for the whole group**, not
one point each. An earlier draft scored `opening_hours` and chips separately,
which summed to 2 and cleared a `minScore` of 2 on page furniture alone —
precisely the outcome the bar exists to prevent. With them sharing a point, no
combination of furniture can ever reach 2.

`minScore` defaults to **2** — "one real body block or a description; furniture
is not enough." It is a constant with a CLI flag override, so a single run can
report the outcome at several thresholds. Measured on 300 rows, no row scores 2
or 4, so any threshold in (1, 3] is equivalent — the default does not sit on a
knife edge.

**Reviews score presentationally, and that is the correction the first
measurements forced.** This spec originally scored reviews as content worth
2, reasoning that a reviews carousel genuinely renders. It does render — but
it renders under an empty body, and Google returns reviews for very nearly
every Google-sourced venue, so crediting them 2 made a bar of 2 almost
unconditional across 7,768 rows. The runs recorded below found 92% of Sport
and 51% of a broad sample clearing the bar on reviews alone. Reviews now
share the single presentational point with the chips and the hours row, so
no row can pass on them.

**Two traps this scoring deliberately avoids:**

- *Tripadvisor rows.* Their content lives under a `tripadvisor` key (attribution,
  subratings, phone, `web_url`) and, for only 45 of 262 restaurants, a `reviews`
  array. Scoring `tripadvisor` as a body block would keep every restaurant on
  attribution metadata alone. Both `reviews` and the bare `tripadvisor` key are
  presentational and share one point, so a Tripadvisor row passes only on a
  description or a real body block (`popular_dishes`) — the same test every
  other category faces.

  **This is the sharpest consequence of scoring reviews presentationally, and
  it is deliberate.** Most Tripadvisor rows will now draft: 175 of 262
  restaurants have no stored description, and only one carries
  `popular_dishes`. Their pages are a rating, a reviews carousel and an
  attribution plate — genuinely thin by the standard this bar sets. Whether
  that standard should apply to a category whose entire value proposition is
  traveller reviews is a product question the measurement can inform but not
  answer.
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

> **Not shipped.** This whole section describes the write-on-read demotion
> behind `CONTENT_AUDIT_ENFORCE`. Steps 1–3 of the sequencing below (schema,
> `Renderability`, and the report-only `cmd/auditcontent` sweep) are what
> landed; this section is not — `withLiveDetails` issues no
> `repo.Update(status=draft, ...)` and no `CONTENT_AUDIT_ENFORCE` env var
> exists anywhere in the codebase. Read the rest of this section as the
> design for a step that has not been built, not as a description of current
> behaviour.

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
> "Deviation from the spec, and why". Also superseded: the last sentence
> below, "expose it on the admin `ListFilter` so a follow-up admin screen can
> query by reason" — `draft_reason` is on `Activity` and `UpdatePatch`, but
> `activitiessvc.ListFilter` has no `DraftReason` field. That follow-up has
> not landed.

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

> **Superseded on one detail:** "without its 4-second request-scoped
> timeout" below did not ship that way. The shipped `WithLiveDetails`
> deliberately reuses `detailResolveTimeout` (4s) rather than dropping it —
> see that constant's doc comment in `internal/service/activity.go`. It is
> still a real bound on a real third-party call, and pairs with
> `WithLiveDetails`' `resolved` return: a timeout now surfaces to the audit
> as a skipped row rather than a false `no_content` verdict, so a slow
> Places response costs a retry on the next run instead of corrupting the
> count. Everything else in this section (the published-only-gate split,
> `GetByIDWithLiveDetails` staying a thin wrapper) shipped as described.

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

---

## Measured outcome — 2026-08-17

First real run, Sport, 100 rows, `min-content=2`. No rows skipped, so every
Places call resolved and the sample is sound as far as it goes. Read in
`title ASC` order, not randomly.

```
content audit — 100 rows scanned at min-content=2
  would stay published: 95
  would be drafted:     5

by reason        no_photo 5 · no_place_id 0 · no_content 0
score distribution   score 2: 97 · score 4: 3

how the passing rows cleared the bar
  google_reviews                92
  description+google_reviews     3
```

### The bar is wrong, and only the measurement could show it

Sport reads as healthy: zero content failures, five photoless rows. That
verdict is an artifact of the scoring, not a fact about the catalog.

**92 of the 95 passing rows cleared the bar on `google_reviews` alone.**
Three carry a description. None carry a body block. Those pages render a
photo, a title, a rating, a reviews carousel, a map and a CTA — no About
block, no fact strip, no unique section. That is exactly the bare page this
spec was written to find.

Google returns reviews for very nearly every Google-sourced venue, so
crediting them 2 points makes a bar of 2 close to unconditional across all
7,768 Google-sourced rows. A bar that cannot separate a full page from an
empty one is not a bar.

This is the decision the "measure before enforcing" sequencing existed to
protect. Enforcing at `min-content=2` would have drafted 5 rows, declared
the problem solved, and left every bare page published.

### What the data actually says

Requiring content that is not reviews — a description or a body block —
Sport passes **3 of 100**. The remaining 97 have nothing the detail page can
render as body content, and `BuildLiveDetails` has no `case` for Sport, so
no amount of Google fetching will change that.

### Consequences

1. **`GoogleReviews` must stop scoring as body content.** Reviews are worth
   showing, but they do not answer "is there anything on this page to read".
   Either score them presentationally, or split the bar into two axes —
   "has a body" and "has social proof" — and gate publication on the first.
2. **Do not enforce.** At an honest bar, enforcement drafts most of Sport,
   and by extension most of the Google-sourced catalog. Drafting ~97% of a
   category is not a content-quality fix, it is deleting the catalog.
3. **The remedy is sourcing, not demotion.** `websitesync` is the only thing
   that has ever produced body content at scale (Wellness 201, Entertainment
   349). Extending it to the remaining categories is the work that makes
   these pages good rather than fewer. That was listed as out of scope here;
   it is now the recommended next project.

### Still unmeasured

Only Sport, and only its alphabetically-first 100 rows. Categories whose
mapper emits a body block (Nature's `good_to_know`, Kids' `facilities`,
Cafés' `known_for`) may score genuinely rather than on reviews, and Wellness
and Entertainment carry stored blocks already. A broad sample would show
whether Sport is the worst case or the typical one.

## Broad sample — 300 rows, all categories, same day

```
content audit — 300 rows scanned at min-content=2
  would stay published: 279
  would be drafted:     21

by reason        no_photo 19 · no_place_id 1 · no_content 1

by category        no_photo   no_place_id   no_content
  cafes                   3             0            0
  kids                    4             0            0
  nature                  1             0            0
  restaurants             1             0            1
  shopping                7             1            0
  sport                   3             0            0

score distribution   1: 2 · 2: 54 · 3: 115 · 4: 23 · 5: 97 · 7: 9

how the passing rows cleared the bar
  google_reviews+presentational                        102
  body_block+google_reviews+presentational              86
  google_reviews                                        50
  body_block+google_reviews                             21
  description+body_block+google_reviews+presentational   9
  description+google_reviews+presentational              7
  description+presentational                             2
  description+google_reviews                             1
  tripadvisor_reviews+presentational                     1
```

### Sport is the worst case, not the typical one

| | Sport (100) | Broad (300) |
| --- | --- | --- |
| Has a body block | 0% | 39% |
| Has a description | 3% | 6% |
| **Genuine body content (either)** | **3%** | **42%** |
| Passed on reviews alone | 92% | 51% |

The difference is entirely whether `BuildLiveDetails` serves the category.
107 of the 116 body-block rows come from the mapper's three live fields —
Nature's `good_to_know`, Kids' `facilities`, Cafés' `known_for`. The
categories with no case in the mapper (Sport, Culture, Art, Shopping,
Nightlife) are the bare ones, which is the same split the spec's opening
table predicted from the schema alone.

### What an honest bar costs

Requiring content that is not reviews: **126 of 300 pass, 174 draft (58%)**.
Extrapolated across 8,183 published rows that is roughly 4,750 demotions.
Better than Sport's 97%, still far too many to enforce.

The confirmed recommendation is unchanged and now has a second data point
behind it: fix the scoring so reviews stop counting as body content, do not
enforce, and extend `websitesync` to the five categories the live mapper
cannot serve. Those five are where the bare pages actually are.

### Reporting gap noticed during this run

`byCategory` counts only failures, so a run cannot show how many rows per
category it scanned. That makes per-category pass rates uncomputable from
the report alone — worth adding before the next measurement round.

## Broad sample, re-run with reviews scored presentationally

Same 300 rows, same day, only the scoring changed.

```
content audit — 300 rows scanned at min-content=2
  would stay published: 126
  would be drafted:     174

by reason        no_photo 19 · no_place_id 1 · no_content 154

by category        no_photo   no_place_id   no_content
  art                     0             0            6
  cafes                   3             0            0
  culture                 0             0           12
  entertainment           0             0            5
  kids                    4             0            8
  nature                  1             0            3
  nightlife               0             0           22
  restaurants             1             0            3
  shopping                7             1           40
  sport                   3             0           43
  wellness                0             0           12

score distribution   1: 168 · 3: 123 · 5: 9

how the passing rows cleared the bar
  body_block+presentational+google_reviews              86
  body_block+google_reviews                             21
  description+body_block+presentational+google_reviews   9
  description+presentational+google_reviews              7
  description+presentational                             2
  description+google_reviews                             1
```

### The bar now sits in an empty region, which makes it robust

**No row scores 2 or 4.** Nearly every row carries some furniture, so the
distribution is bimodal: 168 rows at 1 (furniture only, no body) and 132 at
3 or 5 (a body, plus furniture). The threshold is not balanced on a knife
edge — any bar in the range (1, 3] produces exactly the same verdict on
every row in the sample. That is a much stronger property than picking 2 and
hoping, and it is only visible because reviews stopped inflating the middle.

The pass count, 126, is exactly what the previous run's signal breakdown
predicted for a reviews-excluded bar. The two runs agree.

### The failures land where the mapper does not reach

| Category | `no_content` | Has a live body field? |
| --- | --- | --- |
| sport | 43 | no case in the mapper at all |
| shopping | 40 | no |
| nightlife | 22 | no |
| culture | 12 | no |
| wellness | 12 | partial — `websitesync` only |
| kids | 8 | yes — `facilities` |
| art | 6 | no |
| entertainment | 5 | partial — `websitesync` only |
| nature | 3 | yes — `good_to_know` |
| restaurants | 3 | no |
| **cafes** | **0** | yes — `known_for` |

Cafés fail zero content checks across 300 rows. Nature fails 3, Kids 8. The
three categories `BuildLiveDetails` serves are the three that pass. Every
heavy failure is a category it skips. This is the spec's opening hypothesis,
now measured rather than inferred from the schema.

### Verdict

174 of 300 draft, 58%, extrapolating to roughly 4,750 of 8,183 published
rows. **Do not enforce.** The bar is now honest and the catalog cannot meet
it, which is the correct finding, not a reason to loosen the bar again — the
last time the bar was loosened it passed 51% of rows that render nothing.

The work that closes the gap is extending `websitesync` to the five
categories with no live body field: **sport, shopping, nightlife, culture,
art**. Those five account for 123 of the 154 content failures in this
sample. Cafés, Nature and Kids demonstrate that a single well-chosen body
field per category is enough to move a category from failing to passing.

## Restaurants — 200 rows, the Tripadvisor question answered

```
content audit — 200 rows scanned at min-content=2
  would stay published: 48
  would be drafted:     152

by reason        no_photo 67 · no_place_id 0 · no_content 85

by category      scanned  passed   rate   no_photo   no_place_id   no_content
  restaurants        200      48    24%         67             0           85

score distribution   1: 138 · 3: 62

how the passing rows cleared the bar
  description+presentational                     23
  description+presentational+tripadvisor_reviews 14
  description+presentational+google_reviews      11
```

**24% pass.** Every single passing row passes on a stored `description` — not
one of 200 carries a body block, confirming that `popular_dishes` is
effectively unpopulated (1 row catalog-wide).

The distribution shows the same clean gap: 138 at 1, 62 at 3, nothing at 2.
The 14-row difference between "62 scored 3" and "48 passed" is rows with
real content and no photo, which fail earlier on `no_photo`.

### The photo gap here is far worse than catalog-average

**67 of 200 restaurants have no photo — 34%**, against roughly 5%
catalog-wide. These are broken list cards today, independent of any content
debate, and they are the clearest actionable finding in all four runs. All
67 have an `external_id`, so `GetPhotos` re-attempts a live Tripadvisor
resolve on every single detail open and keeps getting nothing — the
never-converging loop described at the top of this spec, concentrated in one
category.

### The product question, now with numbers

Scoring reviews as furniture drafts **76% of restaurants**. Their pages are
a rating, a reviews carousel, a Tripadvisor attribution plate, and for a
quarter of them a description.

Whether that is "thin" depends on a judgement this measurement cannot make:
for a restaurant, traveller reviews arguably *are* the content, which is the
whole premise of sourcing the category from Tripadvisor in the first place.
The same page shape that reads as empty for a hiking trail may read as
complete for a restaurant.

Two defensible resolutions, both deliberate rather than accidental:

1. **A per-category bar.** Restaurants, Bars and Cafés pass on reviews;
   every other category needs a body. Honest, but it makes the scorer
   category-aware, which it currently is not.
2. **Exclude the Tripadvisor categories from the audit entirely** until
   there is a sourcing plan for them, the way `pending` rows are already
   excluded as someone else's workflow.

**Not** recommended: reverting reviews to content-worth-2 catalog-wide. That
is what produced the false all-clear on Sport, and it would hide the 51% of
Google-sourced rows that genuinely render nothing.

### Fix the photos regardless

The 67 photoless restaurants need no product decision. Whatever the bar
becomes, a published row with no photo is a broken card, and `no_photo` is
the one reason in this audit that is unambiguous across every category.

## Decision: the Tripadvisor categories are out of scope

> **Superseded — see "Follow-up 4, resolved" below.** The blanket exclusion
> is gone. Tripadvisor-sourced rows are measured again, against a bar where
> reviews count as content for them alone.


Rows with `source = "tripadvisor"` are excluded from the audit, the same way
`pending` rows are — someone else's workflow, not this bar's business. The
restaurants run above is the justification: the bar drafts 76% of them, which
is a verdict about the bar's fit rather than about the rows. A Tripadvisor
row's proposition is traveller reviews, and this scorer counts reviews as
furniture by design. They return to the audit if they get a body-content
sourcing plan.

**The filter is on `Source`, not `Category`**, which is the stricter reading.
Restaurants and Bars are entirely Tripadvisor-sourced so the two are
identical for them, but Cafés are mixed: dropping that category wholesale
would also drop ~1,367 Google-sourced cafés, and cafés turn out to be the
best-performing category in the catalog. Source keeps them.

The count is printed in the report (`EXCLUDED: 367`) rather than applied
silently. A scope decision the reader cannot see is indistinguishable from a
bug.

## Final broad sample — Tripadvisor excluded, per-category rates

```
content audit — 300 rows scanned at min-content=2
  EXCLUDED (Tripadvisor-sourced, out of scope for this bar): 367
  would stay published: 129
  would be drafted:     171

by reason        no_photo 17 · no_place_id 1 · no_content 153

by category      scanned  passed   rate   no_photo   no_place_id   no_content
  art                  6       0     0%          0             0            6
  shopping            50       1     2%          7             1           41
  sport               47       1     2%          3             0           43
  nightlife           26       3    11%          0             0           23
  culture             16       4    25%          0             0           12
  wellness            24      12    50%          0             0           12
  entertainment       18      13    72%          0             0            5
  kids                50      38    76%          4             0            8
  nature              19      15    78%          1             0            3
  cafes               44      42    95%          2             0            0

score distribution   1: 167 · 3: 124 · 5: 9
```

### The table the whole spec was written to produce

Pass rate tracks one thing and one thing only: whether the category has a
working body-content source.

| Category | Pass rate | Body-content source |
| --- | --- | --- |
| cafes | **95%** | `known_for`, live from the mapper |
| nature | 78% | `good_to_know`, live from the mapper |
| kids | 76% | `facilities`, live from the mapper |
| entertainment | 72% | `websitesync`, 349 rows done |
| wellness | 50% | `websitesync`, 201 rows done |
| culture | 25% | none |
| nightlife | 11% | none |
| sport | 2% | none |
| shopping | 2% | none |
| art | 0% | none |

The five categories with a source pass at 50–95%. The five without pass at
0–25%. There is no overlap between the two groups and no other variable that
explains the split — not category size, not photo coverage, not provider.

**Cafés at 95% is the proof of concept.** One live body field, `known_for`,
sourced from amenity booleans Google already returns, moves a category from
the failing group to the top of the passing group. It is not an expensive
field and it is not a special case.

## Recommendation

1. **Do not enforce yet.** 171 of 300 draft, and 153 of those are
   `no_content` in five categories that have no way to pass.
2. **Extend `websitesync` to art, shopping, sport, nightlife and culture** —
   125 of the 153 content failures. Cafés, Nature and Kids show that one
   well-chosen body field per category is enough.
3. **Fix the photos independently.** `no_photo` needs no product decision and
   is concentrated in shopping (7), kids (4), sport (3) — plus 67 of 200
   restaurants, which stay broken cards whether or not the category is in
   scope for the content bar.
4. **Re-run this audit after each sourcing change.** The tool is report-only
   and the per-category rate is now the metric to move.

## Outcome: websitesync moves the metric

Audited 100 rows per category after the full `websitesync` run, same bar
(`min-content=2`), same title-order sample as the baseline.

| Category | Pass rate before | Pass rate after |
| --- | --- | --- |
| art | 0% | **54%** |
| culture | 25% | **43%** |
| sport | 2% | **61%** |

The cause is unambiguous. Counting body blocks directly in the first 100 rows
of each category: art 52, culture 39, sport 61 — within two points of each
category's pass count. Essentially the entire improvement is scraper-written
body content, not descriptions Google happened to supply.

Sport is the sharpest result: the category with no `case` in
`placesmap.BuildLiveDetails`, written up at the top of this spec as
structurally unable to pass at any threshold, now passes 61% — above the
broad sample's 42% average and second only to Cafés.

### What the residual failures are

`no_content` after enrichment: art 41, culture 55, sport 34. These are the
website-coverage ceiling identified in the pilot — a row whose venue has no
website, or whose site had nothing extractable, gets one attempt and is then
permanently skipped. No prompt change reaches them; they need a different
source, or acceptance.

Photos remain a separate, untouched problem: art 1, culture 1, sport 5 in
these samples, and 67 of 200 for restaurants.

### Status

Shopping is not measured here — its sync had not started when these ran, so
its 13 enriched rows are the pilot's alone. Audit it once the run completes.

### The bar is now worth revisiting

Three of the five previously-unsourced categories moved from 0–25% to 43–61%
on one sourcing change. Enforcement was rejected earlier because an honest
bar drafted 58% of the catalog; that figure is now materially better in every
enriched category, and the remaining failures are concentrated in rows with
no website at all — a population small enough to consider drafting on its
merits rather than as a catalog-wide cull.

## Operational note: the first full run hit a Firecrawl credit ceiling

Run of 2026-08-17, four categories, in order:

| Category | Rows | Credit (402) failures | Other failures |
| --- | --- | --- | --- |
| art | 278 | 0 | 21 |
| culture | 867 | 0 | 25 |
| sport | 1148 | 300 | 60 |
| shopping | 1444 | 843 | 6 |

Art and culture completed on available credit. Sport ran out partway;
shopping was almost entirely starved. **1,143 distinct rows failed with
`HTTP 402: Insufficient credits`** — a billing condition, not a content one.

That matters because `SyncWebsiteContent` marks the attempt on an extraction
error, and every non-perishable category is then skipped permanently. A
credit outage was therefore recorded as "we tried, there is nothing there",
and topping up credit alone would not have recovered a single row. The 1,143
marks were deleted so a later run re-attempts them.

**Fixed.** `internal/firecrawl` now wraps a 402 in a
`firecrawl.ErrInsufficientCredits` sentinel; `SyncWebsiteContent` returns
before `markAttempt` on it, so an outage no longer retires a row; and
`cmd/websitesync`'s run loop aborts on it rather than grinding through the
remaining catalog burning a billed Places call per row to reach a Firecrawl
call that cannot succeed. Read the incident above as history, not as current
behaviour.

**So shopping's measured 26% is not shopping's ceiling.** Its pilot extracted
content from 13 of 13 rows that had a website — the best rate of any
category. Treat the post-enrichment numbers for shopping, and to a lesser
extent sport, as floors.

### A repeat-cost bug this exposed

A row whose venue has no website returns at `websitesync.go`'s
`detail.WebsiteURI == ""` guard **without** marking an attempt. It is
therefore re-attempted on every run forever, costing one billed Places call
each time to rediscover that it still has no website. Across these four
categories that is roughly 1,800 rows, so about $36 of Places calls per run,
permanently, for rows that can never yield content.

Fixed: the branch now marks the attempt, which moves the skip up to the
`attemptedBefore` check — and that one returns *before* the Places call
rather than after it, which is where the saving actually comes from. A
venue that later publishes a site is still picked up by a perishable
category's periodic re-scan, or by an explicit `-retry-id` run elsewhere,
the same recovery path every other one-attempt outcome relies on.

---

## Follow-ups

Everything below is deliberately NOT in the branch that shipped this spec.
None of it blocks that merge — the branch measures and sources content, and
enforces nothing.

**1. Top up Firecrawl and re-run the enrichment.** 1,143 `sync_regions` marks
were cleared after the credit outage and are queued for a re-attempt. Until
that runs, shopping's 26% and sport's 57% are floors, not ceilings — shopping
in particular extracted content from 13 of 13 rows that had a website, the
best rate of any category.

**2. The enforcement decision.** §3's read-time verdict and §2's photo-fill
and demote steps are designed but unbuilt. Worth deciding only after (1),
since the numbers it turns on are still moving. `draft_reason` and
`Renderability` are already in place for it.

**3. Photos, independently of any of that.** 438 photoless published rows
catalog-wide, and 67 of 200 sampled restaurants — 34% against a ~5% catalog
average. `no_photo` is the one verdict in this audit that needs no product
judgement: a published row with no photo is a broken list card in every
category. All 438 have an `external_id`, so `GetPhotos` re-attempts a live
resolve on every detail open and keeps getting nothing.

**4. The Tripadvisor categories.** ✅ **Resolved — see below.**

**5. Language validation on the write path.** Every extraction prompt now
instructs "Answer in English throughout", but the pilot returned a Serbian
`what_youll_find` despite it. `internal/contentkind` has no
confidently-wrong-language check, so nothing rejects it server-side — the
long-standing follow-up noted in `websitesync.go`'s own comment, now with
evidence behind it.

**6. Surface `draft_reason` in the admin UI.** The column ships and the
repository exposes it; no screen reads it yet.

**7. Culture's first refresh is a month out.** The rows enriched on
2026-08-17 are marked synced that day, so their dated August programmes sit
until roughly mid-September before the perishable re-scan replaces them.
Clearing those `sync_regions` rows would force it sooner, at the cost of
re-scraping ~323 rows.

**8. Nightlife has no path.** 11% pass rate, removed from `websitesync` for
fabricating lineups. Its only body field is inherently perishable and its
venues publish schedules on social media rather than their own sites, so
recovering it means a different source, not a different prompt.


## Follow-up 4, resolved: reviews are content for a Tripadvisor row

The blanket exclusion is removed. `Renderability` now scores reviews as
content (2 points) for a row whose `Source` is `tripadvisor`, and as
furniture (sharing the single presentational point) for every other row.
This is the only place the scorer looks at where a row came from.

### Why not a body-content source instead

Checked before choosing, because sourcing beats scoring wherever it is
available — it is what took art from 0% to 66%. For these categories it is
not available:

| Candidate | Coverage |
| --- | --- |
| Tripadvisor `Description` | already stored, ~33% of venues |
| Tripadvisor `attributes` | empty for all 83 venues sampled |
| `popular_dishes` | 1 row of 306 |
| `websitesync` | needs a Google place id to resolve the website; only 112/306 restaurants, 15/34 bars, 7/27 cafés carry one |

Best case, extending `websitesync` reaches ~65 of 367 rows. Promoting the
cuisine `Categories` list to a body block would have "fixed" the number
without changing a single page — the same metric-gaming the reviews
correction removed.

So the finding stands: for these venues the reviews carousel genuinely is
the page's proposition, and holding them to a body-content bar drafted 76%
of restaurants for lacking something they cannot source.

### Why measured rather than excluded

Excluding them left 367 rows unmeasured, and among them **the worst photo gap
in the catalog — 67 of 200 sampled restaurants have no photo, 34% against a
~5% average.** `no_photo` needs no product judgement in any category, and the
exclusion was the only thing hiding it. Measuring these rows against a bar
that fits them keeps that check working.

The asymmetry is deliberately narrow: a Tripadvisor row with no reviews of
any kind still fails `no_content`, and the photo check applies to every
source unchanged.

### Measured

100 restaurants, same sample as the pre-change run:

```
category          scanned  passed   rate   no_photo   no_place_id   no_content
restaurants           100      44    44%         33             0           23
```

**24% → 44%.** More useful than the pass rate: `no_photo` is now the largest
single failure reason for the category, at 33 of 100. That is the gap the
exclusion was suppressing, and it needs no product decision to act on. The
remaining 23 `no_content` rows have neither a review nor a description — they
are genuinely thin by any bar.
