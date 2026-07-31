// These tests call googleDueRows directly even though it's unexported —
// a deliberate, project-sanctioned exception (see GO_STANDARDS.md) so the
// row-selection and priority logic can be verified without a database or a
// live Google client standing behind Query.
package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

func allStale(_, _, _ string) bool { return false }

func TestGoogleDueRows_CapsAtBudget(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
	}
	jobs := googleDueRows(req, allStale)
	if len(jobs) != maxGoogleRowsPerQuery {
		t.Errorf("jobs = %d, want the budget cap %d", len(jobs), maxGoogleRowsPerQuery)
	}
}

func TestGoogleDueRows_PrioritizesRequestedCategory(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryWellness},
	}
	jobs := googleDueRows(req, allStale)
	if len(jobs) == 0 {
		t.Fatal("jobs = 0, want the wellness rows")
	}
	// Wellness has fewer rows (4 subtypes + 1 category-level) than the
	// budget, so other categories legitimately fill the remainder. What must
	// hold is ordering: every wellness row comes before any non-wellness one,
	// so a user filtering on Wellness gets wellness venues on their next
	// search rather than their seventh.
	seenOther := false
	for _, j := range jobs {
		if j.row.Category != activitiessvc.CategoryWellness {
			seenOther = true
			continue
		}
		if seenOther {
			t.Errorf("wellness row %q scheduled after a non-requested category; requested categories must come first", j.row.Subtype)
		}
	}
}

func TestGoogleDueRows_PrioritizesRequestedSubtype(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryNature},
		Subcategories:   []string{"beach"},
	}
	jobs := googleDueRows(req, allStale)
	if len(jobs) == 0 {
		t.Fatal("jobs = 0, want the beach row")
	}
	if jobs[0].row.Subtype != "beach" {
		t.Errorf("first job subtype = %q, want beach — a user filtering on a subtype should get that subtype synced first", jobs[0].row.Subtype)
	}
}

func TestGoogleDueRows_SkipsFreshRows(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryNature},
	}
	fresh := func(_, category, subtype string) bool {
		return category == string(activitiessvc.CategoryNature) && subtype == "beach"
	}
	for _, j := range googleDueRows(req, fresh) {
		if j.row.Subtype == "beach" {
			t.Error("a fresh row was scheduled; freshness must be checked per (cell, category, subtype)")
		}
	}
}

func TestGoogleDueRows_NoAnchorNoWork(t *testing.T) {
	req := Request{Scope: activitiessvc.ScopeAnywhere}
	if jobs := googleDueRows(req, allStale); len(jobs) != 0 {
		t.Errorf("jobs = %d, want 0 — an unanchored query has nowhere to sync", len(jobs))
	}
}

func TestActivities_Query_GoogleSync_UpsertsWithSubtypeFromTheRow(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{{
		ID: "beach-1", Rating: 4.4, UserRatingCount: 30,
		GoogleMapsURI: "https://maps.google/beach-1",
	}}}
	gp.nearbyOut[0].DisplayName.Text = "Ada Ciganlija"
	gp.nearbyOut[0].Location.Latitude = 44.79
	gp.nearbyOut[0].Location.Longitude = 20.40

	svc := New(repo).WithPlaces(gp)
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryNature},
		Subcategories:   []string{"beach"},
	}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	if len(repo.gotUpserts) == 0 {
		t.Fatal("no upserts, want the discovered beach")
	}
	got := repo.gotUpserts[0]
	// The whole design in one assertion: subtype comes from the row that
	// issued the query, never from classifying the response.
	if got.Category != activitiessvc.CategoryNature || got.Subcategory != "beach" {
		t.Errorf("upsert category/subcategory = %s/%s, want nature/beach", got.Category, got.Subcategory)
	}
	if got.Source != "google_places" || got.ExternalID != "beach-1" {
		t.Errorf("upsert source/external id = %s/%s, want google_places/beach-1", got.Source, got.ExternalID)
	}
}

func TestActivities_Query_GoogleSync_AppliesQualityFloor(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{
		{ID: "good", Rating: 4.0, UserRatingCount: 20, GoogleMapsURI: "https://maps.google/good"},
		{ID: "unrated", Rating: 0, UserRatingCount: 0, GoogleMapsURI: "https://maps.google/unrated"},
		{ID: "thin", Rating: 4.9, UserRatingCount: 2, GoogleMapsURI: "https://maps.google/thin"},
	}}
	svc := New(repo).WithPlaces(gp)
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	for _, u := range repo.gotUpserts {
		if u.ExternalID == "unrated" || u.ExternalID == "thin" {
			t.Errorf("upserted %q, want it dropped by the quality floor", u.ExternalID)
		}
	}
}

func TestActivities_Query_GoogleSync_FailedRowLeftUnmarked(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyErr: errors.New("places 503")}
	svc := New(repo).WithPlaces(gp)
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v — a sync failure must never fail the query", err)
	}
	svc.waitForGoogleSync()

	if len(repo.markSynced) != 0 {
		t.Errorf("markSynced = %v, want none — a failed row must stay stale so a later query retries it", repo.markSynced)
	}
}

func TestActivities_Query_GoogleSync_NoClientNoWork(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	svc := New(repo) // no WithPlaces
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	if repo.upsertCalls != 0 {
		t.Errorf("upsertCalls = %d, want 0 with no Places client configured", repo.upsertCalls)
	}
}

// TestSubtypeFor covers the order-independence property the Belgrade dry run
// forced into the design: Google types overlap at the place level, so the same
// venue is returned by more than one discovery row, and every one of them must
// derive the same subtype or the stored value becomes last-writer-wins.
func TestSubtypeFor(t *testing.T) {
	// A real Belgrade case: 19 of 20 monuments were claimed by the
	// historical_site row purely because it sorts earlier than
	// monument_landmark.
	monument := placesmap.Place{PrimaryType: "monument", Types: []string{"monument", "historical_place", "tourist_attraction"}}
	historicalRow := placesmap.DiscoveryRow{Category: activitiessvc.CategoryCulture, Subtype: "historical_site"}
	monumentRow := placesmap.DiscoveryRow{Category: activitiessvc.CategoryCulture, Subtype: "monument_landmark"}

	viaHistorical := subtypeFor(historicalRow, monument)
	viaMonument := subtypeFor(monumentRow, monument)
	if viaHistorical != viaMonument {
		t.Errorf("same place resolved to %q via the historical_site row and %q via the monument_landmark row; subtype must not depend on which row found it",
			viaHistorical, viaMonument)
	}
	if viaHistorical != "monument_landmark" {
		t.Errorf("subtype = %q, want monument_landmark — primaryType is the place's own statement of what it is", viaHistorical)
	}

	// Fallback: a place whose primaryType maps to nothing keeps the row's
	// subtype, which is what makes an unmappable place land in a bucket at all.
	unmappable := placesmap.Place{PrimaryType: "point_of_interest", Types: []string{"point_of_interest"}}
	if got := subtypeFor(monumentRow, unmappable); got != "monument_landmark" {
		t.Errorf("subtype = %q, want the row's own monument_landmark when primaryType maps to nothing", got)
	}

	// A primaryType mapping to a subtype of a DIFFERENT category must not win:
	// placesmap.Subtype validates against the row's category.
	crossCategory := placesmap.Place{PrimaryType: "yoga_studio", Types: []string{"yoga_studio"}}
	if got := subtypeFor(monumentRow, crossCategory); got != "monument_landmark" {
		t.Errorf("subtype = %q, want monument_landmark — a wellness subtype is not valid for a culture row", got)
	}
}
