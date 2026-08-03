package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

type fakeFirecrawl struct {
	calls  int
	gotURL string
	out    json.RawMessage
	err    error
}

func (f *fakeFirecrawl) ExtractJSON(_ context.Context, url, _ string, _ map[string]any) (json.RawMessage, error) {
	f.calls++
	f.gotURL = url
	return f.out, f.err
}

// TestSyncWebsiteContent_FillsGapsOnly proves the actual admin/scrape
// precedence rule using a scraper-owned key (good_to_know, present in both
// categories' schemas) rather than a key the scraper never touches — seeding
// a non-schema key like venue_type would pass trivially even under a naive
// wholesale-overwrite merge.
func TestSyncWebsiteContent_FillsGapsOnly(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
		// good_to_know already admin-set — must survive untouched.
		// treatments is empty — the scrape should fill it.
		Details: json.RawMessage(`{"good_to_know":["Existing admin note"]}`),
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"treatments":[{"item":"Aroma massage"}],"good_to_know":["Scraped note that should NOT win"]}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}

	if firecrawl.gotURL != "https://example-spa.rs" {
		t.Errorf("firecrawl called with url %q, want the resolved website", firecrawl.gotURL)
	}
	if repo.gotUpdatePatch.Details == nil {
		t.Fatal("repo.Update was not called with Details")
	}
	// The raw website URL (Places Terms §14.3) must never be persisted,
	// however this scrape got resolved/merged.
	if strings.Contains(string(*repo.gotUpdatePatch.Details), "example-spa.rs") {
		t.Errorf("persisted details contain the raw website URL: %s", *repo.gotUpdatePatch.Details)
	}
	var got map[string]any
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	goodToKnow, ok := got["good_to_know"].([]any)
	if !ok || len(goodToKnow) != 1 || goodToKnow[0] != "Existing admin note" {
		t.Errorf("good_to_know = %v, want the admin-curated value preserved, not the scraped one", got["good_to_know"])
	}
	treatments, ok := got["treatments"].([]any)
	if !ok || len(treatments) != 1 {
		t.Errorf("treatments = %v, want one scraped treatment", got["treatments"])
	}
}

// TestSyncWebsiteContent_DenylistedFieldCleared proves T1's guard runs on
// this write path too (the acceptance criteria requires a test per path,
// not just Create/Update): a scrape that comes back with a denylisted
// placeholder still writes, with only the offending field cleared, not the
// whole row skipped. good_to_know is used here — it's Wellness' surviving
// denylist-guarded free-text field (detail-price-duration-purge T1 dropped
// typical_visit/price_from, the fields the original production bug report
// named, from the schema entirely).
func TestSyncWebsiteContent_DenylistedFieldCleared(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"good_to_know":["Nije navedeno","Bring your own towel"]}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if repo.updateCalls != 1 {
		t.Fatalf("repo.Update calls = %d, want 1 — a denylist match clears a field, it must not skip the write", repo.updateCalls)
	}
	if repo.gotUpdatePatch.Details == nil {
		t.Fatal("repo.Update was not called with Details")
	}
	var got activitiessvc.WellnessDetails
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	// "Nije navedeno" is an exact denylist entry and must be dropped;
	// the legitimate entry survives.
	if want := []string{"Bring your own towel"}; len(got.GoodToKnow) != 1 || got.GoodToKnow[0] != want[0] {
		t.Errorf("good_to_know = %v, want %v (denylisted entry dropped)", got.GoodToKnow, want)
	}
}

func TestSyncWebsiteContent_NoWebsite_SkipsFirecrawl(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{}} // no WebsiteURI
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if firecrawl.calls != 0 {
		t.Errorf("firecrawl.calls = %d, want 0 — no website to scrape", firecrawl.calls)
	}
}

// TestSyncWebsiteContent_InvalidExtraction_SkipsWrite proves Firecrawl's
// LLM extraction — not schema-guaranteed — never reaches the DB
// unvalidated: an unknown key would otherwise brick every later admin edit
// to the row (ValidateDetails' strict decode would reject it). It also
// proves the attempt still gets marked despite the skipped write — a
// durably-malformed extraction (bad LLM output every time) must not
// re-spend a Firecrawl call on every future batch run either, the same
// unbounded-retry gap the give-up policy exists to close.
func TestSyncWebsiteContent_InvalidExtraction_SkipsWrite(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"unexpected_field":"surprise from the LLM"}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v, want nil (skip, not retried again)", err)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.Update calls = %d, want 0 — invalid extraction must never be persisted", repo.updateCalls)
	}
	if repo.gotUpdatePatch.Details != nil {
		t.Errorf("repo.gotUpdatePatch.Details = %v, want zero-value", repo.gotUpdatePatch.Details)
	}
	wantKey := syncKey(websiteSyncProvider, "1", string(activitiessvc.CategoryWellness), "")
	if len(repo.markSynced) != 1 || repo.markSynced[0] != wantKey {
		t.Errorf("repo.markSynced = %v, want exactly [%q] — a failed-validation attempt must still count toward the give-up policy", repo.markSynced, wantKey)
	}
}

// TestSyncWebsiteContent_ExtractionError_StillMarksAttempted proves an
// extraction call that errors out (Firecrawl already exhausted its own
// internal retries by then) still counts as this row's one automatic
// attempt — without this, a durably-unscrapable site would burn a
// Firecrawl call on every batch run forever, the exact unbounded cost the
// give-up policy exists to cap.
func TestSyncWebsiteContent_ExtractionError_StillMarksAttempted(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{err: fmt.Errorf("firecrawl scrape https://example-spa.rs status 500: boom")}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err == nil {
		t.Fatal("SyncWebsiteContent() error = nil, want the extraction error surfaced")
	}
	wantKey := syncKey(websiteSyncProvider, "1", string(activitiessvc.CategoryWellness), "")
	if len(repo.markSynced) != 1 || repo.markSynced[0] != wantKey {
		t.Errorf("repo.markSynced = %v, want exactly [%q] — an extraction failure must still count toward the give-up policy", repo.markSynced, wantKey)
	}
}

// TestSyncWebsiteContent_UpdateError_DoesNotMarkAttempted proves a DB write
// failure is treated differently from an extraction/validation failure: the
// extracted content already passed ValidateDetails, so repo.Update failing
// is an infra blip, not a reason to give up on the row — it must stay
// eligible for a normal retry next cycle, not get permanently stranded by
// the give-up policy meant to cap Firecrawl credit spend, not paper over
// transient DB errors.
func TestSyncWebsiteContent_UpdateError_DoesNotMarkAttempted(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"treatments":[{"item":"Massage"}]}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}, updateErr: fmt.Errorf("connection reset")}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err == nil {
		t.Fatal("SyncWebsiteContent() error = nil, want the DB write error surfaced")
	}
	if len(repo.markSynced) != 0 {
		t.Errorf("repo.markSynced = %v, want empty — a DB write failure on already-valid content must not give up the row", repo.markSynced)
	}
}

// TestSyncWebsiteContent_MalformedExtractionJSON_StillMarksAttempted proves
// the fillGaps decode error path — Firecrawl returning success:true with a
// body that isn't valid JSON at all, not just the wrong shape — is treated
// as a content problem, same as an extraction error or a ValidateDetails
// rejection: it still marks the attempt, since a retry would reproduce the
// same malformed body.
func TestSyncWebsiteContent_MalformedExtractionJSON_StillMarksAttempted(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`not valid json`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err == nil {
		t.Fatal("SyncWebsiteContent() error = nil, want the decode error surfaced")
	}
	wantKey := syncKey(websiteSyncProvider, "1", string(activitiessvc.CategoryWellness), "")
	if len(repo.markSynced) != 1 || repo.markSynced[0] != wantKey {
		t.Errorf("repo.markSynced = %v, want exactly [%q] — malformed extraction JSON must still count toward the give-up policy", repo.markSynced, wantKey)
	}
}

// TestSyncWebsiteContent_SportFractionalDifficulty_SkipsWrite proves the
// existing fail-safe (ValidateDetails' strict decode into SportDetails'
// int Difficulty field) still rejects a whole merged payload when
// Firecrawl hands back a fractional difficulty — the constrained schema
// (integer, 1-5) is only a hint to the LLM, not a guarantee, so this test
// is really re-proving the atomic-reject contract still holds, mirroring
// TestSyncWebsiteContent_InvalidExtraction_SkipsWrite's shape.
func TestSyncWebsiteContent_SportFractionalDifficulty_SkipsWrite(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategorySport, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-gym.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"difficulty":3.5,"effort_level":"Moderate to hard"}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v, want nil (skip, not retried again)", err)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.Update calls = %d, want 0 — fractional difficulty must never be persisted, along with the rest of the payload (effort_level, gear, what_to_bring)", repo.updateCalls)
	}
	if repo.gotUpdatePatch.Details != nil {
		t.Errorf("repo.gotUpdatePatch.Details = %v, want zero-value", repo.gotUpdatePatch.Details)
	}
	wantKey := syncKey(websiteSyncProvider, "1", string(activitiessvc.CategorySport), "")
	if len(repo.markSynced) != 1 || repo.markSynced[0] != wantKey {
		t.Errorf("repo.markSynced = %v, want exactly [%q] — a failed-validation attempt must still count toward the give-up policy", repo.markSynced, wantKey)
	}
}

// TestSyncWebsiteContent_AdminCreatedRow_SkipsPlacesCall proves an
// admin-created row (no Google place_id) never calls PlaceDetails with an
// empty ExternalID — which would otherwise happen on every weekly run
// forever.
func TestSyncWebsiteContent_AdminCreatedRow_SkipsPlacesCall(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "", ExternalID: "",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if places.detailCalls != 0 {
		t.Errorf("places.detailCalls = %d, want 0 — admin-created row has no place_id", places.detailCalls)
	}
	if firecrawl.calls != 0 {
		t.Errorf("firecrawl.calls = %d, want 0", firecrawl.calls)
	}
}

// TestSyncWebsiteContent_TripadvisorRow_SkipsPlacesCall mirrors the
// admin-created case: a Tripadvisor-sourced row's ExternalID is a
// Tripadvisor location id, not a Google place_id.
func TestSyncWebsiteContent_TripadvisorRow_SkipsPlacesCall(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "tripadvisor", ExternalID: "ta-123",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if places.detailCalls != 0 {
		t.Errorf("places.detailCalls = %d, want 0 — tripadvisor row has no Google place_id", places.detailCalls)
	}
}

// TestSyncWebsiteContent_UnsupportedCategory_Skips proves a category other
// than Wellness/Entertainment is skipped rather than silently falling
// through to the wellness prompt/schema default. Category is a plain string
// type (backend/shared/models/activitiessvc.Category), so nothing in the
// type system stops a direct SyncWebsiteContent(ctx, id) call from reaching
// this with any category — this guard is reachable, not just defensive.
func TestSyncWebsiteContent_UnsupportedCategory_Skips(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryRestaurants, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if places.detailCalls != 0 {
		t.Errorf("places.detailCalls = %d, want 0 — unsupported category skipped before any live call", places.detailCalls)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.Update calls = %d, want 0", repo.updateCalls)
	}
}

// TestIsComplete_PerCategory proves the completeness check walks each
// category's own scraper-owned field list, not a shared one — mirrors
// scraperOwnedFields exactly so a category added there without updating
// this table (or vice versa) shows up as a test failure, not a silent gap.
func TestIsComplete_PerCategory(t *testing.T) {
	tests := []struct {
		name     string
		category activitiessvc.Category
		details  string
		want     bool
	}{
		{"wellness missing good_to_know", activitiessvc.CategoryWellness,
			`{"treatments":[{"item":"Massage"}]}`, false},
		{"wellness both fields present", activitiessvc.CategoryWellness,
			`{"treatments":[{"item":"Massage"}],"good_to_know":["Note"]}`, true},
		{"entertainment both fields present", activitiessvc.CategoryEntertainment,
			`{"upcoming_shows":[{"date":"2026-09-01","title":"Show"}],"good_to_know":["Note"]}`, true},
		{"culture missing now_showing", activitiessvc.CategoryCulture, `{}`, false},
		{"culture now_showing present", activitiessvc.CategoryCulture,
			`{"now_showing":{"title":"Exhibit","description":"..."}}`, true},
		{"culture stored now_showing with blank title", activitiessvc.CategoryCulture,
			`{"now_showing":{"title":"","description":"leftover from before dropBlankBanner existed"}}`, false},
		{"art missing current_exhibition", activitiessvc.CategoryArt, `{}`, false},
		{"art current_exhibition present", activitiessvc.CategoryArt,
			`{"current_exhibition":{"title":"Show","description":"..."}}`, true},
		{"sport missing difficulty", activitiessvc.CategorySport,
			`{"what_to_bring":["Water"],"effort_level":"High","gear":"None"}`, false},
		{"sport all four present", activitiessvc.CategorySport,
			`{"what_to_bring":["Water"],"effort_level":"High","gear":"None","difficulty":4}`, true},
		{"unsupported category never complete", activitiessvc.CategoryRestaurants, `{}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isComplete(tt.category, json.RawMessage(tt.details)); got != tt.want {
				t.Errorf("isComplete(%s, %s) = %v, want %v", tt.category, tt.details, got, tt.want)
			}
		})
	}
}

// TestSyncWebsiteContent_CompleteWellnessRow_SkipsPermanently proves a
// non-Entertainment category with every scraper-owned field already filled
// is skipped before any Places or Firecrawl call — regardless of how long
// ago (or whether ever) it was synced.
func TestSyncWebsiteContent_CompleteWellnessRow_SkipsPermanently(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
		Details: json.RawMessage(`{"treatments":[{"item":"Massage"}],"good_to_know":["Note"]}`),
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}} // never synced — would be eligible under the old flat cadence
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if places.detailCalls != 0 {
		t.Errorf("places.detailCalls = %d, want 0 — complete row skipped before resolving a website", places.detailCalls)
	}
	if firecrawl.calls != 0 {
		t.Errorf("firecrawl.calls = %d, want 0", firecrawl.calls)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.Update calls = %d, want 0", repo.updateCalls)
	}
}

// TestSyncWebsiteContent_CompleteEntertainmentRow_RefreshesAfter30Days
// proves Entertainment is the one category that keeps a periodic re-scan
// even once complete, and that the window is 30 days now, not the old 7.
func TestSyncWebsiteContent_CompleteEntertainmentRow_RefreshesAfter30Days(t *testing.T) {
	completeDetails := `{"upcoming_shows":[{"date":"2026-09-01","title":"Show"}],"good_to_know":["Note"]}`

	t.Run("skipped at 10 days", func(t *testing.T) {
		stored := activitiessvc.Activity{
			ID: "1", Category: activitiessvc.CategoryEntertainment, Status: activitiessvc.StatusPublished,
			Source: "google_places", ExternalID: "place-1", Details: json.RawMessage(completeDetails),
		}
		places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-theatre.rs"}}
		firecrawl := &fakeFirecrawl{}
		repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{
			syncKey("website", "1", "entertainment", ""): time.Now().Add(-10 * 24 * time.Hour),
		}}
		svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

		if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
			t.Fatalf("SyncWebsiteContent() error: %v", err)
		}
		if firecrawl.calls != 0 {
			t.Errorf("firecrawl.calls = %d, want 0 — 10 days is inside the 30-day window", firecrawl.calls)
		}
	})

	t.Run("re-attempted at 31 days", func(t *testing.T) {
		stored := activitiessvc.Activity{
			ID: "1", Category: activitiessvc.CategoryEntertainment, Status: activitiessvc.StatusPublished,
			Source: "google_places", ExternalID: "place-1", Details: json.RawMessage(completeDetails),
		}
		places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-theatre.rs"}}
		firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"upcoming_shows":[{"date":"2026-10-01","title":"New Show"}]}`)}
		repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{
			syncKey("website", "1", "entertainment", ""): time.Now().Add(-31 * 24 * time.Hour),
		}}
		svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

		if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
			t.Fatalf("SyncWebsiteContent() error: %v", err)
		}
		if firecrawl.calls != 1 {
			t.Errorf("firecrawl.calls = %d, want 1 — 31 days is past the 30-day window", firecrawl.calls)
		}
		if repo.gotUpdatePatch.Details == nil {
			t.Fatal("repo.Update was not called with Details")
		}
		var got map[string]any
		if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
			t.Fatalf("unmarshal updated details: %v", err)
		}
		shows, ok := got["upcoming_shows"].([]any)
		if !ok || len(shows) != 1 {
			t.Fatalf("upcoming_shows = %v, want one fresh show", got["upcoming_shows"])
		}
		show, ok := shows[0].(map[string]any)
		if !ok || show["title"] != "New Show" {
			t.Errorf("upcoming_shows[0] = %v, want the newly scraped show, not the stale stored one", shows[0])
		}
	})
}

// TestSyncWebsiteContent_IncompleteEntertainmentRow_StillRefreshesShows
// proves upcoming_shows gets overwritten on re-scrape even when the row is
// NOT complete (good_to_know still empty) — the overwrite must fire on
// category alone, not on isComplete, or a row that never completes (the one
// that re-scrapes most often) would never get its stale show list
// refreshed.
func TestSyncWebsiteContent_IncompleteEntertainmentRow_StillRefreshesShows(t *testing.T) {
	// good_to_know deliberately left empty — the row is not complete, so an
	// Entertainment row keeps entertainmentRefreshFreshness's periodic
	// re-scan (30 days) rather than the one-attempt-and-give-up rule every
	// other category gets; seed synced_at older than that so the sync
	// actually proceeds to the merge step instead of being skipped as
	// still-fresh.
	incompleteDetails := `{"upcoming_shows":[{"date":"2026-09-01","title":"Old Show"}]}`
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryEntertainment, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1", Details: json.RawMessage(incompleteDetails),
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-theatre.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"upcoming_shows":[{"date":"2026-10-01","title":"New Show"}]}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{
		syncKey("website", "1", "entertainment", ""): time.Now().Add(-31 * 24 * time.Hour),
	}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if repo.gotUpdatePatch.Details == nil {
		t.Fatal("repo.Update was not called with Details")
	}
	var got map[string]any
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	shows, ok := got["upcoming_shows"].([]any)
	if !ok || len(shows) != 1 {
		t.Fatalf("upcoming_shows = %v, want one fresh show", got["upcoming_shows"])
	}
	show, ok := shows[0].(map[string]any)
	if !ok || show["title"] != "New Show" {
		t.Errorf("upcoming_shows[0] = %v, want the newly scraped show, not the stale stored one — refresh must fire regardless of row completeness", shows[0])
	}
}

// TestSyncWebsiteContent_SportDifficulty_SetsInferredFlag proves filling a
// previously-empty difficulty from a scrape marks it inferred in the same
// write, and that an admin-set difficulty is left untouched, flag included.
func TestSyncWebsiteContent_SportDifficulty_SetsInferredFlag(t *testing.T) {
	t.Run("fills difficulty and sets inferred", func(t *testing.T) {
		stored := activitiessvc.Activity{
			ID: "1", Category: activitiessvc.CategorySport, Status: activitiessvc.StatusPublished,
			Source: "google_places", ExternalID: "place-1",
		}
		places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-gym.rs"}}
		firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"difficulty":4,"effort_level":"High intensity"}`)}
		repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
		svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

		if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
			t.Fatalf("SyncWebsiteContent() error: %v", err)
		}
		if repo.gotUpdatePatch.Details == nil {
			t.Fatal("repo.Update was not called with Details")
		}
		var got map[string]any
		if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
			t.Fatalf("unmarshal updated details: %v", err)
		}
		if got["difficulty"] != float64(4) {
			t.Errorf("difficulty = %v, want 4", got["difficulty"])
		}
		if got["difficulty_inferred"] != true {
			t.Errorf("difficulty_inferred = %v, want true", got["difficulty_inferred"])
		}
	})

	t.Run("admin-set difficulty survives untouched, no inferred flag added", func(t *testing.T) {
		stored := activitiessvc.Activity{
			ID: "1", Category: activitiessvc.CategorySport, Status: activitiessvc.StatusPublished,
			Source: "google_places", ExternalID: "place-1",
			Details: json.RawMessage(`{"difficulty":2}`),
		}
		places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-gym.rs"}}
		firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"difficulty":5,"effort_level":"High intensity"}`)}
		repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
		svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

		if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
			t.Fatalf("SyncWebsiteContent() error: %v", err)
		}
		var got map[string]any
		if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
			t.Fatalf("unmarshal updated details: %v", err)
		}
		if got["difficulty"] != float64(2) {
			t.Errorf("difficulty = %v, want the admin-set 2 preserved", got["difficulty"])
		}
		if _, ok := got["difficulty_inferred"]; ok {
			t.Errorf("difficulty_inferred = %v, want absent for an admin-set value", got["difficulty_inferred"])
		}
	})
}

// TestSyncWebsiteContent_CultureArt_FillNestedBanner proves the generic
// fillGaps/isEmptyValue path correctly handles a nested object field
// (now_showing/current_exhibition are {title, description}, not a flat
// string or array) — untested territory before Culture/Art existed.
func TestSyncWebsiteContent_CultureArt_FillNestedBanner(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryCulture, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-museum.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"now_showing":{"title":"Modern Serbia","description":"A retrospective."}}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	nowShowing, ok := got["now_showing"].(map[string]any)
	if !ok || nowShowing["title"] != "Modern Serbia" {
		t.Errorf("now_showing = %v, want the scraped banner", got["now_showing"])
	}
}

// TestSyncWebsiteContent_Culture_BlankBanner_NotTreatedAsFilled proves a
// blank-title extraction (an empty banner Firecrawl couldn't actually fill
// in) never counts as a completed now_showing — otherwise isComplete would
// lock the row permanently on a single bad extraction, since Culture has
// exactly one scraper-owned field.
func TestSyncWebsiteContent_Culture_BlankBanner_NotTreatedAsFilled(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryCulture, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-museum.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"now_showing":{"title":"","description":""}}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if repo.gotUpdatePatch.Details == nil {
		t.Fatal("repo.Update was not called with Details")
	}
	var got map[string]any
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	if isComplete(activitiessvc.CategoryCulture, *repo.gotUpdatePatch.Details) {
		t.Errorf("now_showing = %v, blank banner must not count as complete", got["now_showing"])
	}
}

// TestSyncWebsiteContent_Culture_WhitespaceOnlyBanner_NotTreatedAsFilled
// proves dropBlankBanner treats a whitespace-only title the same as an
// empty one, not as a real value.
func TestSyncWebsiteContent_Culture_WhitespaceOnlyBanner_NotTreatedAsFilled(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryCulture, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-museum.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"now_showing":{"title":"   ","description":""}}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if repo.gotUpdatePatch.Details == nil {
		t.Fatal("repo.Update was not called with Details")
	}
	if isComplete(activitiessvc.CategoryCulture, *repo.gotUpdatePatch.Details) {
		t.Error("whitespace-only banner title must not count as complete")
	}
}

// TestSyncWebsiteContent_Culture_DenylistedBanner_NotTreatedAsFilled proves a
// non-blank but denylisted title (e.g. "Unknown") — the case
// dropBlankBanner's empty-string check lets through, since the title isn't
// blank — still doesn't get persisted or count as complete. Without T1's
// validateExtraFields guard on Culture/Art, this exact row would write
// "Unknown" as now_showing and never retry, since isComplete would then read
// it as filled.
func TestSyncWebsiteContent_Culture_DenylistedBanner_NotTreatedAsFilled(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryCulture, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-museum.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"now_showing":{"title":"Unknown","description":"A retrospective."}}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if repo.gotUpdatePatch.Details == nil {
		t.Fatal("repo.Update was not called with Details")
	}
	var got map[string]any
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	if _, ok := got["now_showing"]; ok {
		t.Errorf("now_showing = %v, want dropped (denylisted title must not persist)", got["now_showing"])
	}
	if isComplete(activitiessvc.CategoryCulture, *repo.gotUpdatePatch.Details) {
		t.Error("denylisted banner title must not count as complete")
	}
}

// TestSyncWebsiteContent_IncompleteRow_GivesUpAfterOneAttempt proves a
// non-Entertainment row that already had one automatic attempt (however
// long ago) is skipped forever afterward, not retried on any timer — the
// credit-cost fix: an unbounded 7-day retry loop on a row that will never
// complete (a missing field on the venue's site, permanently) was never
// accounted for in the design spec's cost estimate.
func TestSyncWebsiteContent_IncompleteRow_GivesUpAfterOneAttempt(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{
		// 400 days ago — far past the old 7-day retry window — proves the
		// skip is permanent, not just a longer timer.
		syncKey("website", "1", "wellness", ""): time.Now().Add(-400 * 24 * time.Hour),
	}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if firecrawl.calls != 0 {
		t.Errorf("firecrawl.calls = %d, want 0 — already attempted once, must not auto-retry", firecrawl.calls)
	}
}

// TestSyncWebsiteContent_Force_RetriesGivenUpRow proves force bypasses the
// already-attempted skip above — cmd/websitesync's -retry-id path.
func TestSyncWebsiteContent_Force_RetriesGivenUpRow(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"treatments":[{"item":"Massage"}]}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{
		syncKey("website", "1", "wellness", ""): time.Now().Add(-400 * 24 * time.Hour),
	}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", true); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if firecrawl.calls != 1 {
		t.Errorf("firecrawl.calls = %d, want 1 — force must bypass the already-attempted skip", firecrawl.calls)
	}
}

// TestWellnessAndEntertainmentPrompts_GoodToKnowWording proves the T2
// good_to_know wording survives detail-price-duration-purge T1's prompt
// prune (which removed the scalar price/duration instructions, not the
// good_to_know ones): venue-specific, never generic, shape-bounded.
func TestWellnessAndEntertainmentPrompts_GoodToKnowWording(t *testing.T) {
	wantSubstrings := []string{
		"venue",
		"never generic",
		"80 characters or fewer",
		"no trailing period",
		"Answer in English",
	}
	for _, tt := range []struct {
		name   string
		prompt string
	}{
		{"wellness", wellnessPrompt},
		{"entertainment", entertainmentPrompt},
	} {
		t.Run(tt.name, func(t *testing.T) {
			for _, want := range wantSubstrings {
				if !strings.Contains(tt.prompt, want) {
					t.Errorf("%s prompt missing expected instruction %q:\n%s", tt.name, want, tt.prompt)
				}
			}
		})
	}
}

// TestPrompts_NoPriceOrDurationWording is T1 (detail-price-duration-purge)'s
// core acceptance criterion: none of the three pruned prompts may mention
// price or duration in their instruction text — these are unverifiable LLM
// extractions of a scraped page, so the scraper stops asking for them
// entirely rather than collecting-then-discarding.
func TestPrompts_NoPriceOrDurationWording(t *testing.T) {
	for _, tt := range []struct {
		name   string
		prompt string
	}{
		{"wellness", wellnessPrompt},
		{"entertainment", entertainmentPrompt},
		{"sport", sportPrompt},
	} {
		t.Run(tt.name, func(t *testing.T) {
			lower := strings.ToLower(tt.prompt)
			if strings.Contains(lower, "price") {
				t.Errorf("%s prompt mentions price:\n%s", tt.name, tt.prompt)
			}
			if strings.Contains(lower, "duration") {
				t.Errorf("%s prompt mentions duration:\n%s", tt.name, tt.prompt)
			}
		})
	}
}

// TestSchemas_NoPriceOrDurationKeys is T1's other core acceptance
// criterion: the three JSON schemas passed to Firecrawl contain no
// price/duration property keys, at any nesting level. Marshaling the schema
// and substring-matching the quoted key is simpler than walking the
// map[string]any tree by hand, and just as precise here — a JSON key only
// ever appears quoted (`"price":`), so it can't collide with prose.
func TestSchemas_NoPriceOrDurationKeys(t *testing.T) {
	bannedKeys := []string{"price", "duration", "price_from", "typical_visit", "typical_show_length", "time_or_price"}
	for _, tt := range []struct {
		name   string
		schema map[string]any
	}{
		{"wellness", wellnessSchema},
		{"entertainment", entertainmentSchema},
		{"sport", sportSchema},
	} {
		t.Run(tt.name, func(t *testing.T) {
			encoded, err := json.Marshal(tt.schema)
			if err != nil {
				t.Fatalf("marshal schema: %v", err)
			}
			for _, banned := range bannedKeys {
				if strings.Contains(string(encoded), `"`+banned+`"`) {
					t.Errorf("%s schema still declares key %q, want removed:\n%s", tt.name, banned, encoded)
				}
			}
		})
	}
}

// TestWellnessSchema_TreatmentsItemOnly and
// TestEntertainmentSchema_UpcomingShowsDateTitleOnly are T1's per-category
// acceptance tests: a wellness scrape returns treatments[] with item only
// (no duration/price keys), and an entertainment scrape returns
// upcoming_shows[] with date+title only (no time_or_price key).
func TestWellnessSchema_TreatmentsItemOnly(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	// Firecrawl's schema no longer declares duration/price (see wellnessSchema),
	// but the extraction isn't schema-guaranteed — feeding them here anyway
	// proves they're actually stripped, not merely absent from the fixture.
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"treatments":[{"item":"Aroma massage","duration":"60m","price":"$80"}],"good_to_know":["Bring a towel"]}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if repo.gotUpdatePatch.Details == nil {
		t.Fatal("repo.Update was not called with Details")
	}
	var got map[string]any
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	treatments, ok := got["treatments"].([]any)
	if !ok || len(treatments) != 1 {
		t.Fatalf("treatments = %v, want one row", got["treatments"])
	}
	row, ok := treatments[0].(map[string]any)
	if !ok {
		t.Fatalf("treatments[0] = %v, want an object", treatments[0])
	}
	if _, has := row["duration"]; has {
		t.Errorf("treatments[0] has a duration key, want none: %v", row)
	}
	if _, has := row["price"]; has {
		t.Errorf("treatments[0] has a price key, want none: %v", row)
	}
	if row["item"] != "Aroma massage" {
		t.Errorf("treatments[0].item = %v, want %q", row["item"], "Aroma massage")
	}
}

func TestEntertainmentSchema_UpcomingShowsDateTitleOnly(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryEntertainment, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-theatre.rs"}}
	// Firecrawl's schema no longer declares time_or_price (see
	// entertainmentSchema), but the extraction isn't schema-guaranteed —
	// feeding it here anyway proves it's actually stripped, not merely
	// absent from the fixture.
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"upcoming_shows":[{"date":"2026-09-01","title":"Jazz Night","time_or_price":"from $20"}],"good_to_know":["Doors open early"]}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1", false); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if repo.gotUpdatePatch.Details == nil {
		t.Fatal("repo.Update was not called with Details")
	}
	var got map[string]any
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	shows, ok := got["upcoming_shows"].([]any)
	if !ok || len(shows) != 1 {
		t.Fatalf("upcoming_shows = %v, want one row", got["upcoming_shows"])
	}
	row, ok := shows[0].(map[string]any)
	if !ok {
		t.Fatalf("upcoming_shows[0] = %v, want an object", shows[0])
	}
	if _, has := row["time_or_price"]; has {
		t.Errorf("upcoming_shows[0] has a time_or_price key, want none: %v", row)
	}
	if row["date"] != "2026-09-01" || row["title"] != "Jazz Night" {
		t.Errorf("upcoming_shows[0] = %v, want date+title unchanged", row)
	}
}
