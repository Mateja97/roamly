package service

import (
	"context"
	"encoding/json"
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
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"treatments":[{"item":"Aroma massage","price":"€39"}],"good_to_know":["Scraped note that should NOT win"]}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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

func TestSyncWebsiteContent_NoWebsite_SkipsFirecrawl(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{}} // no WebsiteURI
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if firecrawl.calls != 0 {
		t.Errorf("firecrawl.calls = %d, want 0 — no website to scrape", firecrawl.calls)
	}
}

// TestSyncWebsiteContent_InvalidExtraction_SkipsWrite proves Firecrawl's
// LLM extraction — not schema-guaranteed — never reaches the DB
// unvalidated: an unknown key would otherwise brick every later admin edit
// to the row (ValidateDetails' strict decode would reject it).
func TestSyncWebsiteContent_InvalidExtraction_SkipsWrite(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"unexpected_field":"surprise from the LLM"}`)}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v, want nil (skip-and-retry-next-week)", err)
	}
	if repo.updateCalls != 0 {
		t.Errorf("repo.Update calls = %d, want 0 — invalid extraction must never be persisted", repo.updateCalls)
	}
	if repo.gotUpdatePatch.Details != nil {
		t.Errorf("repo.gotUpdatePatch.Details = %v, want zero-value", repo.gotUpdatePatch.Details)
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

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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
		{"wellness missing typical_visit", activitiessvc.CategoryWellness,
			`{"treatments":[{"item":"Massage"}],"good_to_know":["Note"],"price_from":"€30"}`, false},
		{"wellness all four present", activitiessvc.CategoryWellness,
			`{"treatments":[{"item":"Massage"}],"good_to_know":["Note"],"typical_visit":"1 hr","price_from":"€30"}`, true},
		{"entertainment all four present", activitiessvc.CategoryEntertainment,
			`{"upcoming_shows":[{"date":"2026-09-01","title":"Show"}],"good_to_know":["Note"],"typical_show_length":"2 hrs","price_from":"€10"}`, true},
		{"culture missing now_showing", activitiessvc.CategoryCulture, `{}`, false},
		{"culture now_showing present", activitiessvc.CategoryCulture,
			`{"now_showing":{"title":"Exhibit","description":"..."}}`, true},
		{"art missing current_exhibition", activitiessvc.CategoryArt, `{}`, false},
		{"art current_exhibition present", activitiessvc.CategoryArt,
			`{"current_exhibition":{"title":"Show","description":"..."}}`, true},
		{"sport missing difficulty", activitiessvc.CategorySport,
			`{"what_to_bring":["Water"],"effort_level":"High","duration":"1 hr","gear":"None"}`, false},
		{"sport all five present", activitiessvc.CategorySport,
			`{"what_to_bring":["Water"],"effort_level":"High","duration":"1 hr","gear":"None","difficulty":4}`, true},
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
		Details: json.RawMessage(`{"treatments":[{"item":"Massage"}],"good_to_know":["Note"],"typical_visit":"1 hr","price_from":"€30"}`),
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{}} // never synced — would be eligible under the old flat cadence
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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
	completeDetails := `{"upcoming_shows":[{"date":"2026-09-01","title":"Show"}],"good_to_know":["Note"],"typical_show_length":"2 hrs","price_from":"€10"}`

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

		if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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

		if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
			t.Fatalf("SyncWebsiteContent() error: %v", err)
		}
		if firecrawl.calls != 1 {
			t.Errorf("firecrawl.calls = %d, want 1 — 31 days is past the 30-day window", firecrawl.calls)
		}
	})
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

		if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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

		if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
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

func TestSyncWebsiteContent_RecentlySynced_Skips(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{}
	repo := &fakeRepo{getOut: stored, syncedAtOut: map[string]time.Time{
		syncKey("website", "1", "wellness", ""): time.Now(),
	}}
	svc := New(repo).WithPlaces(places).WithFirecrawl(firecrawl)

	if err := svc.SyncWebsiteContent(context.Background(), "1"); err != nil {
		t.Fatalf("SyncWebsiteContent() error: %v", err)
	}
	if firecrawl.calls != 0 {
		t.Errorf("firecrawl.calls = %d, want 0 — synced less than 7 days ago", firecrawl.calls)
	}
}
