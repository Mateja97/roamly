package service

import (
	"context"
	"encoding/json"
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

func TestSyncWebsiteContent_FillsGapsOnly(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
		// venue_type already admin-set — must survive untouched.
		// treatments is empty — the scrape should fill it.
		Details: json.RawMessage(`{"venue_type":"Admin-curated Spa"}`),
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{WebsiteURI: "https://example-spa.rs"}}
	firecrawl := &fakeFirecrawl{out: json.RawMessage(`{"treatments":[{"item":"Aroma massage","price":"€39"}],"good_to_know":["Book ahead on weekends"]}`)}
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
	var got map[string]any
	if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
		t.Fatalf("unmarshal updated details: %v", err)
	}
	if got["venue_type"] != "Admin-curated Spa" {
		t.Errorf("venue_type = %v, want the admin-curated value preserved", got["venue_type"])
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
