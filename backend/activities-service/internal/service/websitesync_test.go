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
