# Content Audit — Steps 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the number that decides the publish bar — a per-category report of how many published activities would be drafted for missing photos or missing content — plus the schema and verdict logic that a later enforcement step flips on.

**Architecture:** A nullable `draft_reason` column distinguishes machine demotion from human demotion. A pure, exported `service.Renderability` function scores an already-merged activity against the same signals the detail page renders. A report-only CLI, `cmd/auditcontent`, pages through published rows, applies the live Places merge each row would get on a detail-page open, and tallies verdicts. Nothing in this plan writes a status.

**Tech Stack:** Go 1.x (`backend/activities-service` module), pgx/v5, Postgres+PostGIS, stdlib `testing`, `flag`, `log/slog`.

## Global Constraints

- **Spec:** `docs/plans/content-audit-draft-demotion.md`. Every decision below traces to it.
- **`GO_STANDARDS.md` is mandatory.** Table-driven tests with stdlib `testing`; test behaviour through exported APIs, never private functions; config from environment variables read once in `main.go`; fail fast on missing required config; `gofmt` enforced; `golangci-lint run ./...` clean from inside `backend/activities-service`.
- **Places Terms §14.3:** detail content fetched from Google is never persisted. Photos are the one already-shipped exception and this plan does not widen it. The audit persists verdicts only — and in steps 1–3, not even those.
- **Reason values are exactly:** `no_photo`, `no_place_id`, `no_content`. Lowercase, underscore-separated, stored verbatim.
- **`minScore` default is 2.** Presentational signals (opening hours, chips) can contribute at most 1 point in total, so chips alone can never clear the bar.
- **Backend services never import each other's `internal/`.** `cmd/auditcontent` lives inside `activities-service` and may import its own `internal/` packages.
- **Run all Go commands from `backend/activities-service`.**

## Deviation from the spec, and why

The spec's §2 describes `cmd/auditcontent` as a tool with `-dry-run` defaulted to `true`. **This plan builds it report-only, with no write path and therefore no `-dry-run` flag.** A binary that contains no `UPDATE` is a stronger guarantee than a flag that defaults to safe, and steps 1–3 exist solely to produce a number. The fill and demote steps (spec §2 steps 1 and 3) land with the enforcement work, at which point `-dry-run` is added as the gate on real writes.

Second deviation, in the same spirit: `-limit` defaults to **200**, not 0. Every row costs a billed Place Details call, so the accident-cost of a bare `go run ./cmd/auditcontent` is a few dollars rather than ~$200. The full catalog requires an explicit `-limit 0`.

## File Structure

| File | Responsibility |
| --- | --- |
| `internal/repository/migrations/0033_draft_reason.sql` | Create: adds the nullable column. |
| `backend/shared/models/activitiessvc/activity.go` | Modify: `Activity.DraftReason`, `UpdatePatch.DraftReason`. |
| `internal/repository/activity.go` | Modify: `adminColumns`, `scanAdminActivity`, `Update`'s SET list, `nullIfEmpty` helper. |
| `internal/repository/integration_test.go` | Modify: round-trip and NULL-semantics coverage. |
| `internal/service/renderable.go` | Create: `Verdict`, `Renderability`, the scoring rule, reason constants. Sole owner of the publish bar. |
| `internal/service/renderable_test.go` | Create: table-driven rule coverage. |
| `internal/service/renderable_drift_test.go` | Create: the guard that fails the build when the live mapper emits a key the scorer doesn't classify. |
| `internal/service/activity.go` | Modify: exported `WithLiveDetails` wrapper. |
| `cmd/auditcontent/main.go` | Create: enumeration, per-row merge+verdict, tally, report. |
| `cmd/auditcontent/main_test.go` | Create: enumeration and tally coverage against fakes. |

---

### Task 1: `draft_reason` column, model field, and repository wiring

**Files:**
- Create: `backend/activities-service/internal/repository/migrations/0033_draft_reason.sql`
- Modify: `backend/shared/models/activitiessvc/activity.go` (`Activity` struct ~line 143–220, `UpdatePatch` struct ~line 753–767)
- Modify: `backend/activities-service/internal/repository/activity.go` (`adminColumns` line 250, `scanAdminActivity` line 255, `Update` line 707)
- Test: `backend/activities-service/internal/repository/integration_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `activitiessvc.Activity.DraftReason string` (empty string when the column is NULL) and `activitiessvc.UpdatePatch.DraftReason *string` (nil = untouched; pointer to `""` writes SQL NULL; pointer to a non-empty string writes that value).

- [x] **Step 1: Write the failing integration test**

Add to `backend/activities-service/internal/repository/integration_test.go`, inside `TestActivities_AdminCRUD_Integration` (after the existing `t.Run("Update with an empty-string field sets it, distinct from omitting it", ...)` block):

```go
	t.Run("draft_reason round-trips, and an empty patch value clears it back to NULL", func(t *testing.T) {
		created, err := repo.Create(ctx, activitiessvc.NewActivity{
			Title: "Reason Fixture", Category: activitiessvc.CategorySport, Status: activitiessvc.StatusDraft,
		})
		if err != nil {
			t.Fatalf("Create() error: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, created.ID) })

		if created.DraftReason != "" {
			t.Errorf("new row DraftReason = %q, want \"\" (the column defaults to NULL)", created.DraftReason)
		}

		reason := "no_photo"
		demoted, err := repo.Update(ctx, created.ID, activitiessvc.UpdatePatch{DraftReason: &reason})
		if err != nil {
			t.Fatalf("Update() setting draft_reason: %v", err)
		}
		if demoted.DraftReason != "no_photo" {
			t.Errorf("DraftReason after set = %q, want %q", demoted.DraftReason, "no_photo")
		}

		var isNull bool
		if err := db.QueryRow(ctx, `SELECT draft_reason IS NULL FROM activities WHERE id = $1`, created.ID).Scan(&isNull); err != nil {
			t.Fatalf("checking draft_reason nullness after set: %v", err)
		}
		if isNull {
			t.Error("draft_reason is NULL in the database after setting it to \"no_photo\"")
		}

		cleared := ""
		republished, err := repo.Update(ctx, created.ID, activitiessvc.UpdatePatch{DraftReason: &cleared})
		if err != nil {
			t.Fatalf("Update() clearing draft_reason: %v", err)
		}
		if republished.DraftReason != "" {
			t.Errorf("DraftReason after clear = %q, want \"\"", republished.DraftReason)
		}
		if err := db.QueryRow(ctx, `SELECT draft_reason IS NULL FROM activities WHERE id = $1`, created.ID).Scan(&isNull); err != nil {
			t.Fatalf("checking draft_reason nullness after clear: %v", err)
		}
		if !isNull {
			t.Error("draft_reason is not NULL after clearing — NULL is what distinguishes a human-drafted row from an audit-drafted one")
		}
	})

	t.Run("omitting DraftReason from a patch leaves an existing reason untouched", func(t *testing.T) {
		created, err := repo.Create(ctx, activitiessvc.NewActivity{
			Title: "Untouched Reason", Category: activitiessvc.CategorySport, Status: activitiessvc.StatusDraft,
		})
		if err != nil {
			t.Fatalf("Create() error: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, created.ID) })

		reason := "no_content"
		if _, err := repo.Update(ctx, created.ID, activitiessvc.UpdatePatch{DraftReason: &reason}); err != nil {
			t.Fatalf("Update() setting draft_reason: %v", err)
		}

		newTitle := "Untouched Reason (renamed)"
		got, err := repo.Update(ctx, created.ID, activitiessvc.UpdatePatch{Title: &newTitle})
		if err != nil {
			t.Fatalf("Update() renaming: %v", err)
		}
		if got.DraftReason != "no_content" {
			t.Errorf("DraftReason after an unrelated patch = %q, want %q preserved", got.DraftReason, "no_content")
		}
	})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd backend/activities-service && go test -tags=integration ./internal/repository/ -run TestActivities_AdminCRUD_Integration -v`

Expected: FAIL to compile — `created.DraftReason undefined` and `unknown field DraftReason in struct literal of type activitiessvc.UpdatePatch`.

Note: this test needs a running docker daemon; it starts a throwaway Postgres container.

- [x] **Step 3: Write the migration**

Create `backend/activities-service/internal/repository/migrations/0033_draft_reason.sql`:

```sql
-- content-audit-draft-demotion T1: draft_reason records why a row is
-- drafted, and therefore who may undraft it. NULL means a human decided —
-- either the row was never auto-drafted, or an admin drafted it
-- deliberately — and cmd/auditcontent must never touch such a row in
-- either direction. A non-NULL value ("no_photo" | "no_place_id" |
-- "no_content") means the audit drafted it and may republish it once the
-- gap fills.
--
-- Deliberately nullable, with no DEFAULT and no CHECK. NULL carries the
-- meaning above, so a default would erase the very distinction the column
-- exists for; and the reason vocabulary is owned by
-- internal/service/renderable.go, so a CHECK would force a migration every
-- time a reason is added or renamed.
ALTER TABLE activities ADD COLUMN draft_reason text;
```

- [x] **Step 4: Add the model fields**

In `backend/shared/models/activitiessvc/activity.go`, add to the `Activity` struct immediately after the `GooglePlaceID` field (before `CreatedAt`):

```go
	// DraftReason (content-audit-draft-demotion T1) is why cmd/auditcontent
	// drafted this row: "no_photo", "no_place_id", or "no_content". Empty
	// for every row the audit didn't draft — including a row an admin
	// drafted by hand, which is exactly the distinction the audit's
	// republish step keys on (see migration 0033). Read from the
	// `draft_reason` column via COALESCE, so a NULL column and an empty
	// string are indistinguishable here on purpose: "no machine reason".
	DraftReason string
```

And add to the `UpdatePatch` struct, after `Subcategory`:

```go
	// DraftReason (content-audit-draft-demotion T1): same
	// nil-untouched/non-nil-set convention as the other fields, with one
	// addition — a pointer to the empty string writes SQL NULL, not an
	// empty string, since NULL is the meaningful "no machine reason" value
	// (see Activity.DraftReason and migration 0033). Setting a reason and
	// setting Status are independent patches; nothing here couples them.
	DraftReason *string
```

- [x] **Step 5: Wire the repository read path**

In `backend/activities-service/internal/repository/activity.go`, change `adminColumns` (line 250) to select the new column — append it before `created_at`:

```go
const adminColumns = `id, title, description, category, ST_Y(location::geometry), ST_X(location::geometry),
	country, rating, photos, tags, details,
	COALESCE(city, '') AS city, COALESCE(address, '') AS address, status, COALESCE(external_id, '') AS external_id,
	COALESCE(source, '') AS source, subcategory, COALESCE(google_place_id, '') AS google_place_id,
	COALESCE(draft_reason, '') AS draft_reason, created_at`
```

And add the matching scan target in `scanAdminActivity`:

```go
func scanAdminActivity(row pgx.Row) (activitiessvc.Activity, error) {
	var a activitiessvc.Activity
	err := row.Scan(
		&a.ID, &a.Title, &a.Description, &a.Category,
		&a.Location.Lat, &a.Location.Lng,
		&a.Country, &a.Rating,
		&a.Photos, &a.Tags, &a.Details,
		&a.City, &a.Address, &a.Status, &a.ExternalID, &a.Source, &a.Subcategory, &a.GooglePlaceID,
		&a.DraftReason, &a.CreatedAt,
	)
	return a, err
}
```

The scan order must match `adminColumns` exactly — `draft_reason` before `created_at` in both.

- [x] **Step 6: Wire the repository write path**

In the same file, add this helper next to the existing `nonNilPhotos`/`nonNilTags`/`nonEmptyDetailsBytes` helpers (around line 411–445):

```go
// nullIfEmpty maps the empty string to a SQL NULL bind arg. Only
// draft_reason needs this: it is the one nullable text column where NULL
// is a distinct, meaningful value ("no machine reason" — see migration
// 0033), unlike city/address/external_id, which COALESCE NULL and '' to
// the same thing on read and would gain nothing from the distinction.
func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
```

And add to `Update`'s SET list, after the `patch.Subcategory` block:

```go
	if patch.DraftReason != nil {
		sets = append(sets, "draft_reason = "+arg(nullIfEmpty(*patch.DraftReason)))
	}
```

- [x] **Step 7: Run the tests to verify they pass**

Run: `cd backend/activities-service && go test -tags=integration ./internal/repository/ -run TestActivities_AdminCRUD_Integration -v`

Expected: PASS, including both new subtests.

- [x] **Step 8: Run the full suite and the linter**

Run: `cd backend/activities-service && gofmt -l . && go build ./... && go test ./... && golangci-lint run ./...`

Expected: `gofmt -l` prints nothing, the build succeeds, all tests pass, the linter is clean. Other packages construct `activitiessvc.Activity` and `UpdatePatch` with field names, so adding fields breaks nothing — but run it to be sure.

- [x] **Step 9: Commit**

```bash
git add backend/shared/models/activitiessvc/activity.go backend/activities-service/internal/repository/
git commit -m "feat(activities-service): add draft_reason to distinguish machine from human drafting

NULL means a human decided; a non-NULL reason means cmd/auditcontent
drafted the row and may republish it once the gap fills. Nullable with
no DEFAULT and no CHECK, because NULL is the meaningful value and the
reason vocabulary belongs to the service layer, not the schema.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `Renderability` — the publish bar as a pure function

**Files:**
- Create: `backend/activities-service/internal/service/renderable.go`
- Test: `backend/activities-service/internal/service/renderable_test.go`

**Interfaces:**
- Consumes: `activitiessvc.Activity` (with `DraftReason` from Task 1, though this task does not read it).
- Produces:
  - `service.Verdict` — `struct{ OK bool; Reason string; Score int }`
  - `service.Renderability(a activitiessvc.Activity, minScore int) Verdict`
  - `service.ReasonNoPhoto`, `service.ReasonNoPlaceID`, `service.ReasonNoContent` — string constants
  - `service.DefaultMinContentScore` — untyped int constant, value 2

Exported because `cmd/auditcontent` (a separate `package main`) is its consumer, and because `GO_STANDARDS.md` requires testing through exported APIs.

**Scoring rule.** Note the correction against an earlier draft of the spec: presentational signals share a single point rather than scoring 1 each. Under the earlier phrasing, `opening_hours` (1) plus a chip (1) summed to 2 and cleared a `minScore` of 2 — which is precisely the "chips alone are enough" outcome the bar exists to prevent.

| Signal | Points |
| --- | --- |
| non-empty `Description` | 2 |
| a body block: `good_to_know`, `facilities`, `known_for`, `treatments`, `upcoming_shows`, `popular_dishes`, `what_to_bring`, `now_showing`, `current_exhibition`, `on_the_bar`, `signature_pours`, `what_youll_find`, `lineup`, `difficulty` | 2 (once, however many are present) |
| any presentational signal: reviews (`reviews`, merged `GoogleReviews`), `opening_hours`, `venue_type`, `hours`, `website_url`, `tripadvisor`, `effort_level`, `gear` | 1 total |

- [x] **Step 1: Write the failing test**

Create `backend/activities-service/internal/service/renderable_test.go`:

```go
package service_test

import (
	"encoding/json"
	"testing"

	"activities-service/internal/service"

	"backend/shared/models/activitiessvc"
)

// onePhoto is the "has a photo" precondition every content case below needs
// — the photo check runs first, so a fixture without one would short-circuit
// to no_photo and never exercise the scoring at all.
var onePhoto = []activitiessvc.Photo{{URL: "https://example.com/a.jpg"}}

func TestRenderability(t *testing.T) {
	tests := []struct {
		name       string
		activity   activitiessvc.Activity
		wantOK     bool
		wantReason string
		wantScore  int
	}{
		{
			name:       "no photos drafts for no_photo even when the content is rich",
			activity:   activitiessvc.Activity{ExternalID: "place-1", Description: "A fine museum.", Details: json.RawMessage(`{"good_to_know":["Free entry"]}`)},
			wantOK:     false,
			wantReason: service.ReasonNoPhoto,
			wantScore:  4,
		},
		{
			name:      "a description alone clears the bar",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Description: "A fine museum."},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:      "a body block alone clears the bar",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"facilities":["Restroom available"]}`)},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:      "multiple body blocks still score once",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"facilities":["Restroom"],"known_for":["Coffee"],"good_to_know":["Dogs ok"]}`)},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:      "a quotable Tripadvisor reviews array clears the bar",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "ta-1", Details: json.RawMessage(`{"tripadvisor":{"web_url":"https://ta/x"},"reviews":[{"text":"Great"}]}`)},
			wantOK:    true,
			wantScore: 3, // reviews 2 + the tripadvisor chip 1
		},
		{
			name:       "a review-less Tripadvisor row with no Google reviews drafts for no_content",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "ta-1", GooglePlaceID: "place-9", Details: json.RawMessage(`{"tripadvisor":{"web_url":"https://ta/x"}}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  1,
		},
		{
			name: "the same row clears the bar once the Google review fallback fills it",
			activity: activitiessvc.Activity{
				Photos: onePhoto, ExternalID: "ta-1", GooglePlaceID: "place-9",
				Details:       json.RawMessage(`{"tripadvisor":{"web_url":"https://ta/x"}}`),
				GoogleReviews: []activitiessvc.GoogleReview{{Text: "Great"}},
			},
			wantOK:    true,
			wantScore: 3, // google reviews 2 + the tripadvisor chip 1
		},
		{
			name:       "chips and opening hours together are still not content",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"venue_type":"Museum","website_url":"https://x","hours":"Mon 9-5","opening_hours":{"periods":[{"day":"monday"}]}}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  1,
		},
		{
			name:       "a sport row with a photo and nothing else drafts for no_content",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Category: activitiessvc.CategorySport, Details: json.RawMessage(`{}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			name:       "no place id and no content drafts for no_place_id, the more specific reason",
			activity:   activitiessvc.Activity{Photos: onePhoto, Source: "firecrawl", Details: json.RawMessage(`{}`)},
			wantOK:     false,
			wantReason: service.ReasonNoPlaceID,
			wantScore:  0,
		},
		{
			name:      "no place id but enough stored content passes on its own merits",
			activity:  activitiessvc.Activity{Photos: onePhoto, Source: "firecrawl", Details: json.RawMessage(`{"treatments":[{"name":"Massage","price":"2000"}]}`)},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:       "a google_place_id alone counts as having a place id",
			activity:   activitiessvc.Activity{Photos: onePhoto, GooglePlaceID: "place-9", Details: json.RawMessage(`{}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			name:       "empty and null detail values score nothing",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"good_to_know":[],"facilities":null,"venue_type":"","reviews":[]}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			name:       "a whitespace-only description is not a description",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Description: "   ", Details: json.RawMessage(`{}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			name:       "malformed details JSON scores zero rather than erroring",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{not json`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := service.Renderability(tt.activity, service.DefaultMinContentScore)
			if got.OK != tt.wantOK {
				t.Errorf("OK = %v, want %v", got.OK, tt.wantOK)
			}
			if got.Reason != tt.wantReason {
				t.Errorf("Reason = %q, want %q", got.Reason, tt.wantReason)
			}
			if got.Score != tt.wantScore {
				t.Errorf("Score = %d, want %d", got.Score, tt.wantScore)
			}
		})
	}
}

// TestRenderability_MinScoreIsHonoured pins the threshold as a parameter,
// not a hard-coded 2 — the whole point of the dry-run report is that the
// bar can be re-read at several thresholds from one run.
func TestRenderability_MinScoreIsHonoured(t *testing.T) {
	chipsOnly := activitiessvc.Activity{
		Photos: onePhoto, ExternalID: "place-1",
		Details: json.RawMessage(`{"venue_type":"Museum"}`),
	}

	if got := service.Renderability(chipsOnly, 1); !got.OK {
		t.Errorf("at minScore=1 a chips-only row should pass, got %+v", got)
	}
	if got := service.Renderability(chipsOnly, 2); got.OK {
		t.Errorf("at minScore=2 a chips-only row should fail, got %+v", got)
	}

	rich := activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Description: "Words."}
	if got := service.Renderability(rich, 4); got.OK {
		t.Errorf("at minScore=4 a description-only row (score 2) should fail, got %+v", got)
	}
}

// TestRenderability_VerdictReasonIsEmptyWhenOK guards the convention the
// audit's tally depends on: a passing verdict carries no reason string, so
// counting by reason never double-counts a healthy row.
func TestRenderability_VerdictReasonIsEmptyWhenOK(t *testing.T) {
	got := service.Renderability(activitiessvc.Activity{Photos: onePhoto, Description: "Words."}, service.DefaultMinContentScore)
	if !got.OK || got.Reason != "" {
		t.Errorf("Renderability() = %+v, want OK with an empty Reason", got)
	}
}
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd backend/activities-service && go test ./internal/service/ -run TestRenderability -v`

Expected: FAIL to compile — `undefined: service.Renderability`, `undefined: service.ReasonNoPhoto`, `undefined: service.DefaultMinContentScore`.

- [x] **Step 3: Write the implementation**

> **Historical — the snippet below is what was planned, not what shipped.**
> Review and measurement changed the scoring three times after this was
> written: seven body-block keys were missing, `difficulty` was misfiled as
> a chip, and reviews were demoted from content to furniture once the first
> runs showed 51% of rows clearing the bar on them alone. The score table
> above this step is current; `internal/service/renderable.go` is the
> authority.

Create `backend/activities-service/internal/service/renderable.go`:

```go
package service

import (
	"encoding/json"
	"strings"

	"backend/shared/models/activitiessvc"
)

// Reason values recorded in the activities.draft_reason column
// (migration 0033). Stored verbatim, so these strings are a persisted
// vocabulary — renaming one needs a data migration, not just a constant
// edit.
const (
	ReasonNoPhoto   = "no_photo"
	ReasonNoPlaceID = "no_place_id"
	ReasonNoContent = "no_content"
)

// DefaultMinContentScore is the publish bar: "one real body block, or a
// description, or quotable reviews". Presentational signals share a single
// point (see contentScore), so no combination of chips and opening hours
// can reach it — which is the whole reason the bar is 2 and not 1.
const DefaultMinContentScore = 2

// Verdict is one activity's renderability judgement. Reason is "" exactly
// when OK is true. Score is always populated, including on a no_photo
// verdict, so cmd/auditcontent can report the score distribution across the
// whole catalog rather than only across the rows that got as far as the
// content check.
type Verdict struct {
	OK     bool
	Reason string
	Score  int
}

// bodyBlockKeys are the details keys that render a labelled section in the
// detail page's body. Any one of them is real content.
var bodyBlockKeys = []string{
	"good_to_know", "facilities", "known_for",
	"treatments", "upcoming_shows", "popular_dishes",
}

// presentationalKeys are the details keys that render a chip, an hours row,
// or an attribution plate — page furniture, not something a user came to
// read. They share one point between them (see contentScore).
var presentationalKeys = []string{
	"opening_hours", "venue_type", "hours", "website_url", "tripadvisor",
}

// reviewsKey is the Tripadvisor quoted-review array. Scored like a body
// block, not like the `tripadvisor` attribution key beside it: the reviews
// carousel is content a user reads, the attribution plate is furniture.
const reviewsKey = "reviews"

const (
	scoreContent        = 2
	scorePresentational = 1
)

// Renderability judges whether activity has enough to be worth publishing:
// a photo, and content scoring at least minScore. It is pure — no I/O, no
// clients — and expects an activity that has already been through the live
// merge (see Activities.WithLiveDetails), so the judgement is made against
// exactly what a detail-page request would render, not against the sparser
// stored row.
//
// Reasons are ordered most-specific-first. A row with no place id and no
// content reports no_place_id rather than no_content, because the two need
// different remedies: no_content might resolve on Google's next update,
// while no_place_id never resolves until something matches the venue.
//
// Nothing here writes. Persisting a verdict is the caller's decision, and
// deliberately a separate one.
func Renderability(a activitiessvc.Activity, minScore int) Verdict {
	score := contentScore(a)
	switch {
	case len(a.Photos) == 0:
		return Verdict{Reason: ReasonNoPhoto, Score: score}
	case score >= minScore:
		return Verdict{OK: true, Score: score}
	case a.ExternalID == "" && a.GooglePlaceID == "":
		return Verdict{Reason: ReasonNoPlaceID, Score: score}
	default:
		return Verdict{Reason: ReasonNoContent, Score: score}
	}
}

// contentScore counts what renders a block on the detail page, not what is
// merely present in the JSON. Each signal scores once however many of its
// keys are present — three chips are still one chip row, and two body
// blocks are still one screenful of substance rather than two.
//
// Malformed stored details score zero for every details-derived signal
// rather than erroring, the same best-effort decode hasTripadvisorReviews
// and mergeLiveDetails already use: a stored-data problem this function
// cannot repair must not become a demotion it can't justify either — and it
// won't, since a row scoring zero on a corrupt blob still needs the photo
// and place-id checks to fall its way before any reason is reported.
func contentScore(a activitiessvc.Activity) int {
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(a.Details, &fields) // best-effort; nil map on failure

	score := 0
	if strings.TrimSpace(a.Description) != "" {
		score += scoreContent
	}
	if anyKeyHasValue(fields, bodyBlockKeys) {
		score += scoreContent
	}
	if hasValue(fields[reviewsKey]) {
		score += scoreContent
	}
	if len(a.GoogleReviews) > 0 {
		score += scoreContent
	}
	if anyKeyHasValue(fields, presentationalKeys) {
		score += scorePresentational
	}
	return score
}

func anyKeyHasValue(fields map[string]json.RawMessage, keys []string) bool {
	for _, k := range keys {
		if hasValue(fields[k]) {
			return true
		}
	}
	return false
}

// hasValue reports whether a decoded details value is worth rendering.
// Absent, null, "", [] and {} all read as absent — the app's own slots omit
// themselves for every one of these, so scoring them would credit a row for
// a section the user never sees.
func hasValue(raw json.RawMessage) bool {
	switch strings.TrimSpace(string(raw)) {
	case "", "null", `""`, "[]", "{}":
		return false
	}
	return true
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd backend/activities-service && go test ./internal/service/ -run TestRenderability -v`

Expected: PASS, all subtests.

- [x] **Step 5: Run the full suite and the linter**

Run: `cd backend/activities-service && gofmt -l . && go test ./... && golangci-lint run ./...`

Expected: clean.

- [x] **Step 6: Commit**

```bash
git add backend/activities-service/internal/service/renderable.go backend/activities-service/internal/service/renderable_test.go
git commit -m "feat(activities-service): add Renderability, the publish bar as a pure function

Scores an already-merged activity against what the detail page actually
renders: a body block, a description, or quotable reviews is content;
chips, hours and attribution plates are furniture and share one point
between them, so no pile of chips can clear a bar of 2.

Reasons are ordered most-specific-first — no_place_id outranks
no_content because the two need different remedies. Nothing here writes;
persisting a verdict is a separate decision.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The drift guard

**Files:**
- Create: `backend/activities-service/internal/service/renderable_drift_test.go`
- Modify: `backend/activities-service/internal/service/renderable.go` (add one exported test seam)

**Interfaces:**
- Consumes: `service.Renderability`'s key lists from Task 2.
- Produces: `service.KnownDetailKeys() []string` — every details key the scorer classifies, used only by the guard.

**Why this direction.** The failure that matters is the mapper gaining a key the scorer doesn't know about: a new body field would go uncredited, and rows carrying it would be drafted despite rendering fine. So the invariant is *the scorer knows about every key `placesmap.BuildLiveDetails` can emit* — checkable with no hand-maintained list of the 13 detail structs.

A key the mapper cannot emit for a sparse fixture simply isn't checked, which weakens the guard but can never false-fail it.

- [x] **Step 1: Write the failing test**

Create `backend/activities-service/internal/service/renderable_drift_test.go`:

```go
package service_test

import (
	"encoding/json"
	"testing"

	"activities-service/internal/placesmap"
	"activities-service/internal/service"

	"backend/shared/models/activitiessvc"
)

// liveMappedCategories are the categories placesmap.BuildLiveDetails has a
// case for, plus the three it deliberately doesn't (restaurants, bars,
// tours_experiences) — listing all 13 means a new category with a new body
// field is covered the moment it is added, without editing this test.
var liveMappedCategories = []activitiessvc.Category{
	activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes, activitiessvc.CategoryBars,
	activitiessvc.CategoryNightlife, activitiessvc.CategoryNature, activitiessvc.CategorySport,
	activitiessvc.CategoryKids, activitiessvc.CategoryCulture, activitiessvc.CategoryArt,
	activitiessvc.CategoryWellness, activitiessvc.CategoryShopping, activitiessvc.CategoryEntertainment,
	activitiessvc.CategoryToursExperiences,
}

// fullyPopulatedDetail turns on every field BuildLiveDetails reads, so the
// union of keys it emits across all categories is as wide as the mapper can
// make it. ParkingOptions/AccessibilityOptions are left zero — their type is
// unexported, so this test can't construct them — which costs nothing:
// natureGoodToKnow and kidsFacilities both still emit from the plain
// booleans below.
func fullyPopulatedDetail() placesmap.PlaceDetail {
	var d placesmap.PlaceDetail
	d.WebsiteURI = "https://example.com"
	d.PrimaryTypeDisplayName.Text = "Museum"
	d.RegularOpeningHours.WeekdayDescriptions = []string{"Monday: 9 AM – 5 PM"}
	d.GoodForChildren = true
	d.GoodForGroups = true
	d.AllowsDogs = true
	d.Restroom = true
	d.OutdoorSeating = true
	d.LiveMusic = true
	d.ServesCoffee = true
	d.ServesVegetarianFood = true
	d.MenuForChildren = true
	d.DineIn = true
	d.Takeout = true
	d.Reservable = true
	return d
}

// TestRenderability_ScorerClassifiesEveryLiveDetailKey is the drift guard.
// If placesmap.BuildLiveDetails gains a key the scorer doesn't classify,
// rows carrying it score zero for it and get drafted despite rendering
// fine. Fixing a failure here means deciding whether the new key is a body
// block (real content, 2 points) or presentational (furniture, shares 1)
// and adding it to the matching list in renderable.go.
func TestRenderability_ScorerClassifiesEveryLiveDetailKey(t *testing.T) {
	known := map[string]bool{}
	for _, k := range service.KnownDetailKeys() {
		known[k] = true
	}

	detail := fullyPopulatedDetail()
	for _, category := range liveMappedCategories {
		raw := placesmap.BuildLiveDetails(category, "RS", detail)

		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			t.Fatalf("BuildLiveDetails(%s) produced undecodable JSON: %v", category, err)
		}
		for key := range fields {
			if !known[key] {
				t.Errorf("BuildLiveDetails(%s) emits details key %q, which service.Renderability does not classify — "+
					"add it to bodyBlockKeys (real content) or presentationalKeys (furniture) in renderable.go",
					category, key)
			}
		}
	}
}

// TestKnownDetailKeys_HasNoDuplicates guards the lists themselves: a key in
// both bodyBlockKeys and presentationalKeys would score 3 instead of 2,
// silently moving the bar for every row that carries it.
func TestKnownDetailKeys_HasNoDuplicates(t *testing.T) {
	seen := map[string]bool{}
	for _, k := range service.KnownDetailKeys() {
		if seen[k] {
			t.Errorf("details key %q appears in more than one scorer list — it would score twice", k)
		}
		seen[k] = true
	}
}
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd backend/activities-service && go test ./internal/service/ -run 'TestRenderability_ScorerClassifiesEveryLiveDetailKey|TestKnownDetailKeys' -v`

Expected: FAIL to compile — `undefined: service.KnownDetailKeys`.

- [x] **Step 3: Add the test seam**

Append to `backend/activities-service/internal/service/renderable.go`:

```go
// KnownDetailKeys returns every details key the scorer classifies, in no
// particular order. Exported for the drift guard in
// renderable_drift_test.go, which asserts placesmap.BuildLiveDetails cannot
// emit a key this list is missing — an unclassified key scores nothing and
// would draft rows that render perfectly well.
func KnownDetailKeys() []string {
	out := make([]string, 0, len(bodyBlockKeys)+len(presentationalKeys)+1)
	out = append(out, bodyBlockKeys...)
	out = append(out, presentationalKeys...)
	return append(out, reviewsKey)
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd backend/activities-service && go test ./internal/service/ -run 'TestRenderability_ScorerClassifiesEveryLiveDetailKey|TestKnownDetailKeys' -v`

Expected: PASS. The mapper's full key set — `hours`, `opening_hours`, `known_for`, `website_url`, `venue_type`, `good_to_know`, `facilities` — is entirely covered by the two lists.

If it fails naming a key you did not expect, that is the guard doing its job: classify the key, don't widen the test.

- [x] **Step 5: Run the full suite and the linter**

Run: `cd backend/activities-service && gofmt -l . && go test ./... && golangci-lint run ./...`

Expected: clean.

- [x] **Step 6: Commit**

```bash
git add backend/activities-service/internal/service/renderable.go backend/activities-service/internal/service/renderable_drift_test.go
git commit -m "test(activities-service): fail the build if the live mapper outgrows the scorer

A new key in BuildLiveDetails that the scorer doesn't classify scores
nothing, so rows carrying it would be drafted despite rendering fine.
The guard asserts the mapper cannot emit a key the scorer is missing,
and a second test catches a key landing in both scorer lists, which
would silently move the bar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `cmd/auditcontent` — the report

**Files:**
- Create: `backend/activities-service/cmd/auditcontent/main.go`
- Create: `backend/activities-service/cmd/auditcontent/main_test.go`
- Modify: `backend/activities-service/internal/service/activity.go` (export a `WithLiveDetails` wrapper next to `GetByIDWithLiveDetails`, around line 827–836)

**Interfaces:**
- Consumes: `service.Renderability`, `service.Verdict`, `service.ReasonNoPhoto|NoPlaceID|NoContent`, `service.DefaultMinContentScore` (Task 2); `activitiessvc.Activity.DraftReason` (Task 1, present but unread here).
- Produces: `(*service.Activities).WithLiveDetails(ctx context.Context, activity activitiessvc.Activity) activitiessvc.Activity` — the exported wrapper. No other task depends on this binary.

**Why the wrapper.** The sweep needs the same merge the detail page applies, but `GetByIDWithLiveDetails` refuses non-published rows — correct for a public read, wrong for an audit that must eventually re-check the rows it drafted. A three-line exported wrapper is the entire refactor; no restructuring of `withLiveDetails` itself.

- [x] **Step 1: Write the failing test**

Create `backend/activities-service/cmd/auditcontent/main_test.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"testing"

	"activities-service/internal/service"

	"backend/shared/models/activitiessvc"
)

// fakeLister paginates a fixed set of rows the way repository.List does,
// so publishedRows' paging loop is exercised without a database.
type fakeLister struct {
	rows  []activitiessvc.Activity
	calls int
}

func (f *fakeLister) List(_ context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error) {
	f.calls++
	start := filter.Offset
	if start > len(f.rows) {
		start = len(f.rows)
	}
	end := start + filter.Limit
	if end > len(f.rows) {
		end = len(f.rows)
	}
	return activitiessvc.ListResult{Activities: f.rows[start:end], Total: len(f.rows)}, nil
}

// fakeMerger stands in for service.Activities' live merge: it records which
// rows it was asked to merge and hands back a canned upgrade, so the tally
// can be tested without Google.
type fakeMerger struct {
	merged   []string
	upgrades map[string]activitiessvc.Activity
}

func (f *fakeMerger) WithLiveDetails(_ context.Context, a activitiessvc.Activity) activitiessvc.Activity {
	f.merged = append(f.merged, a.ID)
	if up, ok := f.upgrades[a.ID]; ok {
		return up
	}
	return a
}

func row(id, category string, photos int, details string) activitiessvc.Activity {
	a := activitiessvc.Activity{
		ID: id, Title: id, Category: activitiessvc.Category(category),
		ExternalID: "place-" + id, Status: activitiessvc.StatusPublished,
		Details: json.RawMessage(details),
	}
	for i := 0; i < photos; i++ {
		a.Photos = append(a.Photos, activitiessvc.Photo{URL: "https://example.com/" + id + ".jpg"})
	}
	return a
}

func TestPublishedRows_PagesUntilTotalIsReached(t *testing.T) {
	lister := &fakeLister{rows: []activitiessvc.Activity{
		row("a", "sport", 1, `{}`), row("b", "sport", 1, `{}`),
		row("c", "sport", 1, `{}`), row("d", "sport", 1, `{}`), row("e", "sport", 1, `{}`),
	}}

	got, err := publishedRows(context.Background(), lister, 2)
	if err != nil {
		t.Fatalf("publishedRows() error: %v", err)
	}
	if len(got) != 5 {
		t.Errorf("got %d rows, want all 5 across pages", len(got))
	}
	if lister.calls < 3 {
		t.Errorf("List called %d times, want at least 3 for a 5-row set at page size 2", lister.calls)
	}
}

func TestRunAudit_TalliesByCategoryReasonAndScore(t *testing.T) {
	rows := []activitiessvc.Activity{
		row("photoless", "culture", 0, `{"good_to_know":["Free"]}`),
		row("bare", "sport", 1, `{}`),
		row("chips", "shopping", 1, `{"venue_type":"Market","website_url":"https://x"}`),
		row("good", "nature", 1, `{"good_to_know":["Dogs ok"]}`),
	}
	merger := &fakeMerger{upgrades: map[string]activitiessvc.Activity{}}

	report := runAudit(context.Background(), merger, rows, service.DefaultMinContentScore, func() {})

	if report.scanned != 4 {
		t.Errorf("scanned = %d, want 4", report.scanned)
	}
	if report.ok != 1 {
		t.Errorf("ok = %d, want 1 (only the nature row)", report.ok)
	}
	if got := report.byReason[service.ReasonNoPhoto]; got != 1 {
		t.Errorf("no_photo count = %d, want 1", got)
	}
	if got := report.byReason[service.ReasonNoContent]; got != 2 {
		t.Errorf("no_content count = %d, want 2 (the bare sport row and the chips-only shopping row)", got)
	}
	if got := report.byCategory["sport"][service.ReasonNoContent]; got != 1 {
		t.Errorf("sport/no_content count = %d, want 1", got)
	}
	if got := report.byScore[0]; got != 1 {
		t.Errorf("score-0 count = %d, want 1 (the bare sport row)", got)
	}
	if got := report.byScore[1]; got != 1 {
		t.Errorf("score-1 count = %d, want 1 (the chips-only row)", got)
	}
	if len(merger.merged) != 4 {
		t.Errorf("merged %d rows, want every row merged before judging", len(merger.merged))
	}
}

// TestRunAudit_JudgesTheMergedRowNotTheStoredOne is the behaviour the whole
// tool rests on: a stored row that looks bare must be judged on what the
// detail page would actually render after the live merge.
func TestRunAudit_JudgesTheMergedRowNotTheStoredOne(t *testing.T) {
	stored := row("upgradeable", "culture", 1, `{}`)
	merged := stored
	merged.Description = "A live editorial summary from Google."

	merger := &fakeMerger{upgrades: map[string]activitiessvc.Activity{"upgradeable": merged}}
	report := runAudit(context.Background(), merger, []activitiessvc.Activity{stored}, service.DefaultMinContentScore, func() {})

	if report.ok != 1 {
		t.Errorf("ok = %d, want 1 — the stored row is bare but the merged row has a description", report.ok)
	}
	if len(report.byReason) != 0 {
		t.Errorf("byReason = %v, want empty", report.byReason)
	}
}

func TestRunAudit_PacesOncePerRow(t *testing.T) {
	rows := []activitiessvc.Activity{row("a", "sport", 1, `{}`), row("b", "sport", 1, `{}`)}
	paces := 0
	runAudit(context.Background(), &fakeMerger{upgrades: map[string]activitiessvc.Activity{}}, rows, service.DefaultMinContentScore, func() { paces++ })

	if paces != 2 {
		t.Errorf("paced %d times, want once per row — every row costs a billed Places call", paces)
	}
}
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd backend/activities-service && go test ./cmd/auditcontent/ -v`

Expected: FAIL — `no Go files in .../cmd/auditcontent` or, once the file exists, `undefined: publishedRows` / `undefined: runAudit`.

- [x] **Step 3: Export the live-merge wrapper**

In `backend/activities-service/internal/service/activity.go`, add immediately after `GetByIDWithLiveDetails` (which ends around line 836):

```go
// WithLiveDetails applies the same live Google merge the public detail path
// applies (see withLiveDetails), for a caller that already holds the stored
// row. Exported for cmd/auditcontent, which must judge a row on what the
// detail page would render rather than on the sparser stored version, and
// which cannot go through GetByIDWithLiveDetails because that deliberately
// refuses any row that isn't published — correct for a public read, wrong
// for an audit whose whole job includes re-checking the rows it drafted.
//
// Same fallback contract as withLiveDetails itself: an unconfigured client,
// a resolve error, or a timeout all return the bare stored row, no error.
func (a *Activities) WithLiveDetails(ctx context.Context, activity activitiessvc.Activity) activitiessvc.Activity {
	return a.withLiveDetails(ctx, activity)
}
```

- [x] **Step 4: Write the command**

Create `backend/activities-service/cmd/auditcontent/main.go`:

```go
// Command auditcontent reports how much of the published catalog would fail
// the content-audit publish bar — a photo, plus content scoring at least
// -min-content (see service.Renderability). It is the measurement step of
// docs/plans/content-audit-draft-demotion.md, and its output is what the
// publish bar gets chosen from.
//
// Report-only, by construction: this binary contains no UPDATE and no
// -dry-run flag, because a tool that cannot write is a stronger guarantee
// than a flag that defaults to safe. The photo-fill and demote steps land
// with the enforcement work, and -dry-run arrives with them, gating those
// writes.
//
// Every row costs one billed Place Details call, so -limit defaults to 200
// rather than "everything": a bare run costs a few dollars, and the full
// catalog needs an explicit -limit 0. Modelled on cmd/backfillgoogleplaceid
// otherwise — sequential rather than a worker pool, a fixed pace between
// Places calls, resumable by simply re-running since it holds no state.
//
// Live-reading only, and never wired into activities-service's own startup
// path — run by hand.
//
// Usage: DATABASE_URL=... GOOGLE_MAPS_API_KEY=... go run ./cmd/auditcontent [-limit 200] [-category sport] [-min-content 2]
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"time"

	"activities-service/internal/places"
	"activities-service/internal/repository"
	"activities-service/internal/service"

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

// listPageSize is this tool's own List pagination page size — the admin
// catalog query, not a Places call, so it has nothing to do with Places
// quota. Same knob and same value as cmd/backfillgoogleplaceid's.
const listPageSize = 200

// auditPace is the fixed sleep between Places calls, a conservative floor
// under Places' per-project QPS quota. Same value and reasoning as
// cmd/backfillgoogleplaceid's backfillPace.
const auditPace = 200 * time.Millisecond

// defaultLimit caps an unflagged run. Deliberately not 0: at one billed
// Place Details call per row, an accidental full-catalog pass over ~8,000
// published rows is a real bill, while 200 rows is a sample that costs a
// few dollars and still reads clearly per category.
const defaultLimit = 200

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	limit := flag.Int("limit", defaultLimit, "stop after this many rows (0 = the whole catalog; every row costs a billed Places call)")
	category := flag.String("category", "", "restrict the audit to one category slug (default: all)")
	minContent := flag.Int("min-content", service.DefaultMinContentScore, "content score a row needs to stay published")
	flag.Parse()

	ctx := context.Background()
	dsn, err := sharedconfig.Require("DATABASE_URL")
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}

	// Fail fast on the Places client, never degrade to a nil one: without
	// it every row would merge to its bare stored form and the report would
	// claim the catalog has no content, when what actually happened is that
	// nobody asked Google. A missing API key must not read as "Google has
	// nothing on this venue".
	placesClient, err := places.NewFromEnv()
	if err != nil {
		logger.Error("startup failed: this audit is meaningless without a live Places client", "error", err)
		os.Exit(1)
	}

	pool, err := shareddb.Connect(ctx, dsn)
	if err != nil {
		logger.Error("connecting to db", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	repo := repository.New(pool)
	svc := service.New(repo).WithPlaces(placesClient)

	rows, err := publishedRows(ctx, repo, listPageSize)
	if err != nil {
		logger.Error("listing published rows", "error", err)
		os.Exit(1)
	}
	if *category != "" {
		rows = onlyCategory(rows, activitiessvc.Category(*category))
	}
	logger.Info("enumerated published rows", "count", len(rows), "category", *category)

	if *limit > 0 && len(rows) > *limit {
		logger.Info("sampling: the report below covers only this many rows, not the whole catalog",
			"limit", *limit, "available", len(rows))
		rows = rows[:*limit]
	}

	report := runAudit(ctx, svc, rows, *minContent, func() { time.Sleep(auditPace) })
	fmt.Print(report.render(*minContent))
}

// activityLister is the one repository capability the enumeration step
// needs — narrowed so the test can fake pagination without a real DB, same
// pattern as cmd/backfillgoogleplaceid's activityLister.
type activityLister interface {
	List(ctx context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error)
}

// liveMerger is (*service.Activities).WithLiveDetails' shape, narrowed the
// same way, so runAudit is testable without a Places client.
type liveMerger interface {
	WithLiveDetails(ctx context.Context, activity activitiessvc.Activity) activitiessvc.Activity
}

// publishedRows pages through every published row. Pending rows are
// deliberately excluded by the filter: `pending` is the firecrawl review
// queue, a human workflow this tool has no business judging.
func publishedRows(ctx context.Context, repo activityLister, pageSize int) ([]activitiessvc.Activity, error) {
	var out []activitiessvc.Activity
	offset := 0
	for {
		result, err := repo.List(ctx, activitiessvc.ListFilter{
			Status: activitiessvc.StatusPublished, Limit: pageSize, Offset: offset,
		})
		if err != nil {
			return nil, err
		}
		out = append(out, result.Activities...)
		offset += len(result.Activities)
		if len(result.Activities) == 0 || offset >= result.Total {
			break
		}
	}
	return out, nil
}

func onlyCategory(rows []activitiessvc.Activity, category activitiessvc.Category) []activitiessvc.Activity {
	var out []activitiessvc.Activity
	for _, a := range rows {
		if a.Category == category {
			out = append(out, a)
		}
	}
	return out
}

// auditReport tallies one run. byReason is catalog-wide, byCategory is the
// same counts split per category (the table the publish bar gets read
// from), and byScore is the score distribution across every row scanned —
// including rows that failed on the photo check, so the distribution
// describes the catalog rather than only the rows that reached the content
// check.
type auditReport struct {
	scanned    int
	ok         int
	byReason   map[string]int
	byCategory map[string]map[string]int
	byScore    map[int]int
}

// runAudit merges and judges rows in place, one at a time, in the order
// given — sequential, not worker-pool, see the package doc. pace is called
// once per row (a func, not a raw sleep, so tests run instantly). It writes
// nothing.
func runAudit(ctx context.Context, merger liveMerger, rows []activitiessvc.Activity, minScore int, pace func()) auditReport {
	report := auditReport{
		byReason:   map[string]int{},
		byCategory: map[string]map[string]int{},
		byScore:    map[int]int{},
	}

	for _, stored := range rows {
		report.scanned++
		merged := merger.WithLiveDetails(ctx, stored)
		pace()

		verdict := service.Renderability(merged, minScore)
		report.byScore[verdict.Score]++
		if verdict.OK {
			report.ok++
			continue
		}

		report.byReason[verdict.Reason]++
		category := string(stored.Category)
		if report.byCategory[category] == nil {
			report.byCategory[category] = map[string]int{}
		}
		report.byCategory[category][verdict.Reason]++
	}
	return report
}

// render formats the report as the plain-text table the publish-bar
// decision gets read from. Written to stdout, while every log line goes to
// stderr, so a run can be piped into a file without the logs mixed in.
func (r auditReport) render(minScore int) string {
	out := fmt.Sprintf("\ncontent audit — %d rows scanned at min-content=%d\n", r.scanned, minScore)
	out += fmt.Sprintf("  would stay published: %d\n", r.ok)
	out += fmt.Sprintf("  would be drafted:     %d\n\n", r.scanned-r.ok)

	out += "by reason\n"
	for _, reason := range []string{service.ReasonNoPhoto, service.ReasonNoPlaceID, service.ReasonNoContent} {
		out += fmt.Sprintf("  %-14s %d\n", reason, r.byReason[reason])
	}

	out += "\nby category\n"
	out += fmt.Sprintf("  %-16s %10s %13s %12s\n", "category", "no_photo", "no_place_id", "no_content")
	categories := make([]string, 0, len(r.byCategory))
	for category := range r.byCategory {
		categories = append(categories, category)
	}
	sort.Strings(categories)
	for _, category := range categories {
		counts := r.byCategory[category]
		out += fmt.Sprintf("  %-16s %10d %13d %12d\n", category,
			counts[service.ReasonNoPhoto], counts[service.ReasonNoPlaceID], counts[service.ReasonNoContent])
	}

	out += "\nscore distribution (a bar of N drafts everything below N)\n"
	scores := make([]int, 0, len(r.byScore))
	for score := range r.byScore {
		scores = append(scores, score)
	}
	sort.Ints(scores)
	for _, score := range scores {
		out += fmt.Sprintf("  score %d: %d\n", score, r.byScore[score])
	}
	return out
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd backend/activities-service && go test ./cmd/auditcontent/ -v`

Expected: PASS, all four tests.

- [x] **Step 6: Run the full suite and the linter**

Run: `cd backend/activities-service && gofmt -l . && go build ./... && go test ./... && golangci-lint run ./...`

Expected: clean.

- [x] **Step 7: Commit**

```bash
git add backend/activities-service/cmd/auditcontent/ backend/activities-service/internal/service/activity.go
git commit -m "feat(activities-service): add auditcontent, the content-gap report

Pages published rows, applies the same live merge a detail-page open
would, and tallies renderability verdicts by category, reason and score.
The output is what the publish bar gets chosen from.

Report-only by construction — no UPDATE, no -dry-run flag, since a tool
that cannot write beats a flag that defaults to safe. -limit defaults to
200 because every row is a billed Places call, and a missing API key is
a hard startup failure rather than a report claiming the catalog is
empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Run the audit and record the numbers

**Files:**
- Modify: `docs/plans/content-audit-draft-demotion.md` (append a "Measured outcome" section)

**Interfaces:**
- Consumes: the `cmd/auditcontent` binary from Task 4.
- Produces: the chosen `minScore`, which the enforcement work depends on.

This task is a decision, not a code change. It is the reason the previous four exist.

- [ ] **Step 1: Confirm the stack is up**

Run: `docker compose ps`

Expected: `roamly-activities-db-1` healthy. If not: `docker compose up -d`.

- [ ] **Step 2: Run a sampled audit per category**

Sport is the category with the most at stake — 1064 published rows and no case in `BuildLiveDetails` — so audit it first, then a broad sample.

```bash
cd backend/activities-service && DATABASE_URL="postgres://activities:activities@localhost:5433/activities?sslmode=disable" GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY" go run ./cmd/auditcontent -category sport -limit 100 > /tmp/audit-sport.txt 2>/tmp/audit-sport.log; cat /tmp/audit-sport.txt
```

Expected: the report table on stdout. ~100 billed Places calls, roughly $2.

- [ ] **Step 3: Run a broad sample**

```bash
cd backend/activities-service && DATABASE_URL="postgres://activities:activities@localhost:5433/activities?sslmode=disable" GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY" go run ./cmd/auditcontent -limit 300 > /tmp/audit-broad.txt 2>/tmp/audit-broad.log; cat /tmp/audit-broad.txt
```

Note this samples the first 300 rows in `title ASC` order, not a random sample — read it as a spot check, and re-run per category for anything that looks off.

- [ ] **Step 4: Record the outcome in the spec**

Append a "Measured outcome" section to `docs/plans/content-audit-draft-demotion.md` containing: both report tables verbatim, the chosen `minScore` with one sentence of reasoning, and — if the sport numbers confirm the structural gap — an explicit note on whether enforcement should wait on extending `websitesync`.

- [ ] **Step 5: Commit**

```bash
git add docs/plans/content-audit-draft-demotion.md
git commit -m "docs(activities-service): record the content-audit measurements and the chosen bar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Out of scope

Deferred to the enforcement work (spec sequencing steps 4–5), and deliberately absent from every task above:

- The photo-fill step (`ResolvePhotos`/`LocationPhotos` plus persist) and the `-dry-run` flag that will gate it.
- Writing `status` or `draft_reason` from the audit, and the republish path for auto-drafted rows.
- The read-time verdict in `withLiveDetails` and its `CONTENT_AUDIT_ENFORCE` gate.
- Surfacing `draft_reason` in the admin frontend.
- Extending `websitesync` to the ten categories with no body-block source.

## Self-review

**Spec coverage.** §1 verdict function → Tasks 2 and 3. §2 sweep, enumeration and judging → Task 4; its fill and demote steps → explicitly out of scope, matching the "steps 1–3" scope. §3 read-time verdict → out of scope. §4 schema → Task 1. §5 required refactor → Task 4 step 3. §6 out of scope → carried through unchanged. Error handling: the unconfigured-client case is Task 4 step 4 (hard failure); malformed JSON is Task 2's final test case; the merge's own error fallback is inherited from `withLiveDetails` and unchanged. Testing section → Tasks 1–4, one per bullet.

**Correction against the spec.** Task 2's scoring table gives presentational signals 1 point *in total*, where the spec's table listed `opening_hours` at 1 and chips at 1 — which summed to 2 and cleared a bar of 2 on furniture alone. The spec's scoring table needs the same correction; the plan is the corrected version.

**Type consistency.** `Verdict{OK, Reason, Score}` is used identically in Tasks 2, 3 and 4. `Renderability(activity, minScore)` keeps its two-argument shape throughout. `KnownDetailKeys()` is defined in Task 3 step 3 and consumed only there. `WithLiveDetails(ctx, activity) activitiessvc.Activity` matches between the service method (Task 4 step 3) and the `liveMerger` interface and `fakeMerger` (Task 4 steps 1 and 4). `DraftReason` is `string` on `Activity` and `*string` on `UpdatePatch` in Task 1 and nowhere contradicted.
