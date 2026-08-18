// These tests call googleDueRows directly even though it's unexported —
// a deliberate, project-sanctioned exception (see GO_STANDARDS.md) so the
// row-selection and priority logic can be verified without a database or a
// live Google client standing behind Query.
package service

import (
	"context"
	"errors"
	"slices"
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

// TestGoogleDueRows_NeverSchedulesRestaurantsOrBars is the discovery half of
// item T1's "one table, two directions, two different sets": DiscoveryRows
// now carries Restaurants/Bars rows for classification (placesmap.Subtype),
// but googleDueRows must never turn one into a searchNearby job — discovery
// stays Tripadvisor-exclusive for those two categories. Requesting them
// explicitly is the strongest case: even a direct ask must not schedule one.
func TestGoogleDueRows_NeverSchedulesRestaurantsOrBars(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryRestaurants, activitiessvc.CategoryBars},
	}
	for _, j := range googleDueRows(req, allStale) {
		if j.row.Category == activitiessvc.CategoryRestaurants || j.row.Category == activitiessvc.CategoryBars {
			t.Errorf("scheduled a %s job (subtype %q) — Restaurants/Bars rows classify Tripadvisor venues, never discover from Google",
				j.row.Category, j.row.Subtype)
		}
	}
}

func TestGoogleDueRows_NoAnchorNoWork(t *testing.T) {
	req := Request{Scope: activitiessvc.ScopeAnywhere}
	if jobs := googleDueRows(req, allStale); len(jobs) != 0 {
		t.Errorf("jobs = %d, want 0 — an unanchored query has nowhere to sync", len(jobs))
	}
}

func TestActivities_Query_GoogleSync_UpsertsWithArbitratedSubtype(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	// The Belgrade case that motivated subtypeFor: a monument discovered by
	// the historical_site row (PrimaryType/Types say "monument", not
	// "historical_place") must still come out as monument_landmark — the
	// place's own declared type, not row.Subtype ("historical_site"). Using
	// a PrimaryType that maps to a DIFFERENT subtype than the row's own is
	// what makes this test actually discriminate subtypeFor's arbitration
	// from a reverted row.Subtype passthrough; a fixture whose PrimaryType
	// happens to map to the same subtype as the row (e.g. "beach"/"beach")
	// would pass either way.
	gp := &fakeGooglePlaces{
		nearbyOut: []placesmap.Place{{
			ID: "monument-1", Rating: 4.4, UserRatingCount: 30,
			GoogleMapsURI: "https://maps.google/monument-1",
			PrimaryType:   "monument",
			Types:         []string{"monument", "historical_place", "tourist_attraction"},
		}},
		geocodeCity: "Belgrade", geocodeCountry: "Serbia",
	}
	gp.nearbyOut[0].DisplayName.Text = "Pobednik"
	gp.nearbyOut[0].Location.Latitude = 44.82
	gp.nearbyOut[0].Location.Longitude = 20.45

	svc := New(repo).WithPlaces(gp)
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryCulture},
		Subcategories:   []string{"historical_site"},
	}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	if len(repo.gotUpserts) == 0 {
		t.Fatal("no upserts, want the discovered monument")
	}
	got := repo.gotUpserts[0]
	// The row supplies Category (and, only as a fallback, Subtype) — the
	// place's own primaryType is what subtypeFor actually derives Subcategory
	// from, so this lands on monument_landmark even though the row that
	// found it (historical_site) has a different Subtype of its own.
	if got.Category != activitiessvc.CategoryCulture || got.Subcategory != "monument_landmark" {
		t.Errorf("upsert category/subcategory = %s/%s, want culture/monument_landmark", got.Category, got.Subcategory)
	}
	if got.Source != "google_places" || got.ExternalID != "monument-1" {
		t.Errorf("upsert source/external id = %s/%s, want google_places/monument-1", got.Source, got.ExternalID)
	}
	// City/Country come from the sync cell's reverse-geocoded resolution,
	// not the discovery row — without this, BuildLiveDetails' opening-hours
	// timezone lookup (keyed on Country) always misses for a sweep-ingested
	// row.
	if got.City != "Belgrade" || got.Country != "Serbia" {
		t.Errorf("upsert city/country = %s/%s, want Belgrade/Serbia", got.City, got.Country)
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

func TestActivities_Query_GoogleSync_AllUpsertsFailedLeavesRowUnmarked(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}, upsertErr: errors.New("db down")}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{
		{ID: "good", Rating: 4.5, UserRatingCount: 50, GoogleMapsURI: "https://maps.google/good"},
	}}
	svc := New(repo).WithPlaces(gp)
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	// The search itself succeeded (places were found), but every Upsert of
	// them errored — kept stays 0 despite found > 0. Marking this row synced
	// would freeze it at zero ingested rows for the whole TTL, so it must be
	// left unmarked exactly like a row whose search call failed outright.
	if len(repo.markSynced) != 0 {
		t.Errorf("markSynced = %v, want none — a row must stay unmarked when every upsert failed even though places were found", repo.markSynced)
	}
}

// TestActivities_Query_GoogleSync_AllBelowFloorStillMarksSynced is the
// regression guard for round 1's own bug: a row whose search succeeded but
// whose every result is unrated/thin (a common, unremarkable outcome for a
// niche subtype in a smaller city — nothing failed) must still be marked
// fresh. Conflating "nothing passed the floor" with "the upsert failed"
// would leave a legitimately-empty row permanently stale, re-searching on
// every future query forever — trading the stale-data bug for unbounded
// quota spend.
func TestActivities_Query_GoogleSync_AllBelowFloorStillMarksSynced(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{
		{ID: "unrated", Rating: 0, UserRatingCount: 0, GoogleMapsURI: "https://maps.google/unrated"},
	}}
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

	if len(repo.gotUpserts) != 0 {
		t.Errorf("gotUpserts = %v, want none — the only result fails the quality floor", repo.gotUpserts)
	}
	wantKey := syncKey(ProviderGoogle, "44.8,20.5", string(activitiessvc.CategoryNature), "beach")
	if !slices.Contains(repo.markSynced, wantKey) {
		t.Errorf("markSynced = %v, want it to contain %q — a row with no eligible places is not a failure and must not re-search forever", repo.markSynced, wantKey)
	}
}

func TestActivities_Query_GoogleSync_CityResolvedOncePerCell(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{
		nearbyOut: []placesmap.Place{
			{ID: "a", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/a"},
			{ID: "b", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/b"},
		},
		geocodeCity: "Belgrade", geocodeCountry: "Serbia",
	}
	svc := New(repo).WithPlaces(gp)
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	if len(repo.gotUpserts) == 0 {
		t.Fatal("no upserts")
	}
	for _, u := range repo.gotUpserts {
		if u.City != "Belgrade" || u.Country != "Serbia" {
			t.Errorf("upsert city/country = %q/%q, want Belgrade/Serbia for every venue in the cell", u.City, u.Country)
		}
	}
	// One call for the whole sweep — not one per venue, and not one per row.
	if gp.geocodeCalls != 1 {
		t.Errorf("ReverseGeocodeCity calls = %d, want exactly 1 per cell", gp.geocodeCalls)
	}
}

// TestActivities_Query_GoogleSync_GeocodeErrorLeavesCellUnmarked is the
// regression guard for a real bug an earlier round introduced: dropping
// toIngest's per-venue placesmap.CityCountry fallback is only safe for a
// cell with an already-stored row for Upsert's own ON CONFLICT
// COALESCE(NULLIF(...), ...) to protect. For a cell being swept for the
// first time there is nothing to coalesce against, so a geocode ERROR must
// drop that cell's jobs entirely — never call SearchNearby, never upsert,
// never mark synced — rather than ingest new venues with an empty
// city/country and then freeze that state for the full TTL.
func TestActivities_Query_GoogleSync_GeocodeErrorLeavesCellUnmarked(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	p := placesmap.Place{ID: "a", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/a"}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{p}, geocodeErr: errors.New("geocode 503")}
	svc := New(repo).WithPlaces(gp)
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	if gp.nearbyCalls != 0 {
		t.Errorf("SearchNearby calls = %d, want 0 — a geocode error must drop the cell's jobs before ever searching", gp.nearbyCalls)
	}
	if repo.upsertCalls != 0 {
		t.Errorf("upsertCalls = %d, want 0 — never ingest a new venue with no city to fall back on", repo.upsertCalls)
	}
	if len(repo.markSynced) != 0 {
		t.Errorf("markSynced = %v, want none — the cell must stay unmarked so a later query retries the geocode", repo.markSynced)
	}
}

// TestActivities_Query_GoogleSync_ZeroResultsStillMarksSynced covers the
// other half of the same fix: ZERO_RESULTS (err == nil, city/country simply
// empty — a genuinely unnamed location) is not an error and must not be
// treated like one. Its rows still search, still upsert with an empty
// city/country (safe: Upsert's COALESCE only ever protects an
// already-stored value, and there being none here is the correct outcome
// for an unnamed place), and still get marked — or an unnamed cell would
// re-search forever, the unbounded-spend bug an earlier round already
// fixed.
func TestActivities_Query_GoogleSync_ZeroResultsStillMarksSynced(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	p := placesmap.Place{ID: "a", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/a"}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{p}} // geocodeErr nil, geocodeCity/Country "" — ZERO_RESULTS
	svc := New(repo).WithPlaces(gp)
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	if gp.nearbyCalls == 0 {
		t.Fatal("SearchNearby calls = 0, want the rows to still run for a ZERO_RESULTS (non-error) geocode")
	}
	if len(repo.gotUpserts) == 0 {
		t.Fatal("no upserts — ZERO_RESULTS must not drop the sweep")
	}
	for _, u := range repo.gotUpserts {
		if u.City != "" || u.Country != "" {
			t.Errorf("upsert city/country = %q/%q, want empty for an unnamed location", u.City, u.Country)
		}
	}
	if len(repo.markSynced) == 0 {
		t.Error("markSynced = none, want every due row still marked — an unnamed cell must not re-search forever")
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

// TestVenueWrongCategory covers item 3's arbitration rule directly, the
// category-level sibling of TestSubtypeFor above.
func TestVenueWrongCategory(t *testing.T) {
	// The motivating bug: a Nature row's includedTypes overlap far enough
	// that it also returns a children's playroom, whose own primaryType
	// ("amusement_center") plainly belongs to Kids. The row must not win.
	natureRow := placesmap.DiscoveryRow{Category: activitiessvc.CategoryNature, Subtype: "botanical_garden", Types: []string{"botanical_garden"}}
	playroom := placesmap.Place{PrimaryType: "amusement_center", Types: []string{"amusement_center"}}
	if !venueWrongCategory(natureRow, playroom) {
		t.Error("venueWrongCategory = false, want true — amusement_center belongs to Kids, not Nature")
	}

	// primaryType agreeing with the row's own category is not a mismatch,
	// regardless of which subtype it resolves to within that category.
	botanicalGarden := placesmap.Place{PrimaryType: "botanical_garden", Types: []string{"botanical_garden"}}
	if venueWrongCategory(natureRow, botanicalGarden) {
		t.Error("venueWrongCategory = true, want false — botanical_garden belongs to Nature, same as the row")
	}

	// A primaryType CategoryForType can't map at all must not be treated as
	// a mismatch — the row is still the best signal available, same
	// fallback shape as subtypeFor trusting the row when Subtype yields "".
	unmappable := placesmap.Place{PrimaryType: "point_of_interest", Types: []string{"point_of_interest"}}
	if venueWrongCategory(natureRow, unmappable) {
		t.Error("venueWrongCategory = true, want false — an unmappable primaryType must fall back to trusting the row")
	}

	// A TextQuery row (Types empty) must never be arbitrated away, even when
	// primaryType maps to a plainly different category. escape_room has no
	// Table A type — Google commonly returns "amusement_center" (Kids' own
	// type) for an escape room — and it's the only row that can ever produce
	// this subtype, so arbitrating it here would make escape_room permanently
	// unfillable.
	escapeRoomRow := placesmap.DiscoveryRow{Category: activitiessvc.CategoryEntertainment, Subtype: "escape_room", TextQuery: "escape room"}
	escapeRoom := placesmap.Place{PrimaryType: "amusement_center", Types: []string{"amusement_center"}}
	if venueWrongCategory(escapeRoomRow, escapeRoom) {
		t.Error("venueWrongCategory = true, want false — a TextQuery row must never be arbitrated away")
	}
}

// The two tests below call syncGoogleRow directly (sanctioned — see
// googleDueRows/subtypeFor above) rather than going through Query. Query's
// due-row selection always schedules up to maxGoogleRowsPerQuery (8) rows
// per sweep whenever more than 8 of the 53 DiscoveryRows are stale, which is
// true for every unfiltered request against a fakeRepo with an empty
// syncedAtOut. Since fakeGooglePlaces returns the same fixture place for any
// row, going through Query here would call Upsert 8 times instead of the 1
// these tests need to isolate.

// TestActivities_Query_GoogleSync_ResolvesNoProvisionalPhoto is T5's
// (places-api-cost-reduction) acceptance criterion: a sync sweep must never
// call PhotoMediaURL, since most discovered venues are never opened. A
// venue lands with zero photos at discovery time; GetPhotos resolves the
// full set on first detail view instead (see photos_test.go).
func TestActivities_Query_GoogleSync_ResolvesNoProvisionalPhoto(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{
		nearbyOut: []placesmap.Place{{ID: "p1", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/p1"}},
		photosOut: []activitiessvc.Photo{{URL: "https://photos/1.jpg", Provider: activitiessvc.ProviderGoogle}},
	}
	svc := New(repo).WithPlaces(gp)
	job := googleSyncJob{
		anchor: activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		row:    placesmap.DiscoveryRow{Category: activitiessvc.CategoryNightlife, Subtype: "nightclub", Types: []string{"nightclub"}},
	}
	svc.syncGoogleRow(context.Background(), job, cellLocation{}, NearbyRadiusKM)

	if len(repo.gotUpserts) == 0 {
		t.Fatal("no upserts")
	}
	if len(repo.gotUpserts[0].Photos) != 0 {
		t.Errorf("photos = %d, want 0 — no photo resolve at discovery time (GetPhotos resolves on first detail view)",
			len(repo.gotUpserts[0].Photos))
	}
	if gp.resolvePhotoCalls != 0 {
		t.Errorf("ResolvePhotos calls = %d, want 0 — a sync sweep must issue zero photo-media calls", gp.resolvePhotoCalls)
	}
}

// TestActivities_Query_GoogleSync_PassesRadiusAndTypesToClient pins the
// three values that ARE the cost model item 1's concurrency cap is sized
// against (see googleSyncConcurrency's doc): a regression that silently
// widened RadiusM, MaxResults or dropped IncludedTypes filtering would blow
// past that budget without any test noticing, since fakeGooglePlaces.gotNearby
// was previously recorded but never asserted on.
func TestActivities_Query_GoogleSync_PassesRadiusAndTypesToClient(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{{ID: "p1", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/p1"}}}
	svc := New(repo).WithPlaces(gp)
	job := googleSyncJob{
		anchor: activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		row:    placesmap.DiscoveryRow{Category: activitiessvc.CategoryNightlife, Subtype: "nightclub", Types: []string{"night_club"}},
	}
	svc.syncGoogleRow(context.Background(), job, cellLocation{}, NearbyRadiusKM)

	if gp.nearbyCalls != 1 {
		t.Fatalf("nearbyCalls = %d, want 1", gp.nearbyCalls)
	}
	got := gp.gotNearby[0]
	if got.RadiusM != NearbyRadiusKM*1000 {
		t.Errorf("RadiusM = %v, want %v (the radiusKM param passed in, * 1000)", got.RadiusM, NearbyRadiusKM*1000)
	}
	if got.MaxResults != 20 {
		t.Errorf("MaxResults = %d, want 20", got.MaxResults)
	}
	if !slices.Equal(got.IncludedTypes, job.row.Types) {
		t.Errorf("IncludedTypes = %v, want the row's own types %v passed through unchanged", got.IncludedTypes, job.row.Types)
	}
}

// TestGoogleSyncRadiusKM pins D2's resolution table directly: Nearby always
// syncs its own fixed NearbyRadiusKM regardless of any distance value on the
// request; Anywhere passes 5/10/25/50km straight through; Anywhere requests
// wider than Places' 50km ceiling (100km, 200km) or with no limit at all
// ("Any") all clamp to that ceiling.
func TestGoogleSyncRadiusKM(t *testing.T) {
	tests := []struct {
		name string
		req  Request
		want float64
	}{
		{"nearby ignores a set max distance", Request{Scope: activitiessvc.ScopeNearby, MaxDistanceKM: 200}, NearbyRadiusKM},
		{"nearby with no max distance set", Request{Scope: activitiessvc.ScopeNearby}, NearbyRadiusKM},
		{"anywhere 5km passes through unchanged", Request{Scope: activitiessvc.ScopeAnywhere, MaxDistanceKM: 5}, 5},
		{"anywhere 10km passes through unchanged", Request{Scope: activitiessvc.ScopeAnywhere, MaxDistanceKM: 10}, 10},
		{"anywhere 25km passes through unchanged", Request{Scope: activitiessvc.ScopeAnywhere, MaxDistanceKM: 25}, 25},
		{"anywhere 50km passes through, exactly at the ceiling", Request{Scope: activitiessvc.ScopeAnywhere, MaxDistanceKM: 50}, googleMaxSyncRadiusKM},
		{"anywhere 100km clamps to the 50km ceiling", Request{Scope: activitiessvc.ScopeAnywhere, MaxDistanceKM: 100}, googleMaxSyncRadiusKM},
		{"anywhere 200km clamps to the 50km ceiling", Request{Scope: activitiessvc.ScopeAnywhere, MaxDistanceKM: 200}, googleMaxSyncRadiusKM},
		{"anywhere with no limit (Any) resolves to the 50km ceiling", Request{Scope: activitiessvc.ScopeAnywhere}, googleMaxSyncRadiusKM},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := googleSyncRadiusKM(tt.req); got != tt.want {
				t.Errorf("googleSyncRadiusKM() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestActivities_Query_GoogleSync_AnywhereWidensRadiusToPlacesCall is the
// end-to-end wiring proof for D2: an Anywhere query's resolved radius
// actually reaches the Places call's RadiusM (not just googleSyncRadiusKM's
// own unit test above) and the same radius is what gets written back via
// MarkSynced.
func TestActivities_Query_GoogleSync_AnywhereWidensRadiusToPlacesCall(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{{ID: "p1", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/p1"}}}
	svc := New(repo).WithPlaces(gp)
	req := Request{
		Scope:           activitiessvc.ScopeAnywhere,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		MaxDistanceKM:   50,
	}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	if gp.nearbyCalls == 0 {
		t.Fatal("nearbyCalls = 0, want at least one sync call")
	}
	for _, call := range gp.gotNearby {
		if call.RadiusM != 50*1000 {
			t.Errorf("RadiusM = %v, want 50000 — an Anywhere 50km request, not the old fixed 10km", call.RadiusM)
		}
	}
	if len(repo.markSyncedRadius) == 0 {
		t.Fatal("no MarkSynced calls recorded")
	}
	for key, r := range repo.markSyncedRadius {
		if r != 50 {
			t.Errorf("MarkSynced radius for %q = %v, want 50 (the resolved Anywhere sync radius written back)", key, r)
		}
	}
}

// TestActivities_Query_GoogleSync_FreshButTooNarrowStillSyncs is T4
// (places-api-cost-reduction)'s acceptance criterion: widening googleSyncTTL
// must not let a cell synced at a smaller radius than the current request
// needs pass as fresh. The (cell, nature, beach) row here is marked synced
// moments ago (well within any TTL) but only at a 10km radius — an Anywhere
// request needing 50km must still treat it as due and re-sync at 50km,
// proving MarkSynced's radius_km bookkeeping still gates freshness
// independently of the TTL widening.
func TestActivities_Query_GoogleSync_FreshButTooNarrowStillSyncs(t *testing.T) {
	cell := syncCellKey(44.81, 20.46)
	key := syncKey(ProviderGoogle, cell, "nature", "beach")
	repo := &fakeRepo{
		syncedAtOut: map[string]time.Time{key: time.Now()},
		radiusOut:   map[string]float64{key: 10},
	}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{{ID: "beach-1", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/beach-1"}}}
	svc := New(repo).WithPlaces(gp)
	req := Request{
		Scope:           activitiessvc.ScopeAnywhere,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		MaxDistanceKM:   50,
		Categories:      []activitiessvc.Category{activitiessvc.CategoryNature},
		Subcategories:   []string{"beach"},
	}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	foundBeachCall := false
	for _, call := range gp.gotNearby {
		if slices.Contains(call.IncludedTypes, "beach") {
			foundBeachCall = true
			if call.RadiusM != 50*1000 {
				t.Errorf("beach row RadiusM = %v, want 50000 — the request's actual need, not the stale 10km mark", call.RadiusM)
			}
		}
	}
	if !foundBeachCall {
		t.Fatal("no searchNearby call for the beach row — a 10km mark within TTL must not satisfy a 50km request")
	}
	if r := repo.markSyncedRadius[key]; r != 50 {
		t.Errorf("MarkSynced radius for %q = %v, want 50 — re-sync must overwrite the narrower mark", key, r)
	}
}

func TestActivities_Query_GoogleSync_PhotoFailureStillUpserts(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{
		nearbyOut: []placesmap.Place{{ID: "p1", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/p1"}},
		photosErr: errors.New("photo media 500"),
	}
	svc := New(repo).WithPlaces(gp)
	job := googleSyncJob{
		anchor: activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		row:    placesmap.DiscoveryRow{Category: activitiessvc.CategoryNightlife, Subtype: "nightclub", Types: []string{"nightclub"}},
	}
	svc.syncGoogleRow(context.Background(), job, cellLocation{}, NearbyRadiusKM)

	if len(repo.gotUpserts) != 1 {
		t.Fatalf("upserts = %d, want 1 — a venue with no photo is still worth ingesting", len(repo.gotUpserts))
	}
}

// The four tests below cover item 3's arbitration rule end to end through
// syncGoogleRow (venueWrongCategory itself is unit-tested directly in
// TestVenueWrongCategory above) — same "call syncGoogleRow directly" reason
// as the photo tests above: isolating one row's ingestion decisions from
// Query's 8-row budget.

func TestActivities_SyncGoogleRow_SkipsVenueWithMismatchedPrimaryType(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{
		// The motivating bug: a Nature row's includedTypes happen to also
		// catch a children's playroom, whose own primaryType says Kids.
		{ID: "playroom", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/playroom",
			PrimaryType: "amusement_center", Types: []string{"amusement_center"}},
	}}
	svc := New(repo).WithPlaces(gp)
	job := googleSyncJob{
		anchor: activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		row:    placesmap.DiscoveryRow{Category: activitiessvc.CategoryNature, Subtype: "botanical_garden", Types: []string{"botanical_garden"}},
	}
	svc.syncGoogleRow(context.Background(), job, cellLocation{}, NearbyRadiusKM)

	if len(repo.gotUpserts) != 0 {
		t.Errorf("upserts = %v, want none — the venue's own primaryType belongs to Kids, not this Nature row", repo.gotUpserts)
	}
}

func TestActivities_SyncGoogleRow_IngestsVenueMatchingRowCategory(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{
		{ID: "garden", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/garden",
			PrimaryType: "botanical_garden", Types: []string{"botanical_garden"}},
	}}
	svc := New(repo).WithPlaces(gp)
	job := googleSyncJob{
		anchor: activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		row:    placesmap.DiscoveryRow{Category: activitiessvc.CategoryNature, Subtype: "botanical_garden", Types: []string{"botanical_garden"}},
	}
	svc.syncGoogleRow(context.Background(), job, cellLocation{}, NearbyRadiusKM)

	if len(repo.gotUpserts) != 1 {
		t.Fatalf("upserts = %d, want 1 — the venue's primaryType agrees with the row's own category", len(repo.gotUpserts))
	}
	if repo.gotUpserts[0].Category != activitiessvc.CategoryNature {
		t.Errorf("category = %s, want nature", repo.gotUpserts[0].Category)
	}
}

func TestActivities_SyncGoogleRow_IngestsVenueWithUnmappablePrimaryType(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{
		{ID: "poi", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/poi",
			PrimaryType: "point_of_interest", Types: []string{"point_of_interest"}},
	}}
	svc := New(repo).WithPlaces(gp)
	job := googleSyncJob{
		anchor: activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		row:    placesmap.DiscoveryRow{Category: activitiessvc.CategoryNature, Subtype: "botanical_garden", Types: []string{"botanical_garden"}},
	}
	svc.syncGoogleRow(context.Background(), job, cellLocation{}, NearbyRadiusKM)

	if len(repo.gotUpserts) != 1 {
		t.Fatalf("upserts = %d, want 1 — an unmappable primaryType must fall back to trusting the row", len(repo.gotUpserts))
	}
	if repo.gotUpserts[0].Category != activitiessvc.CategoryNature {
		t.Errorf("category = %s, want nature (the row's own category)", repo.gotUpserts[0].Category)
	}
}

// TestActivities_SyncGoogleRow_TextQueryRowIngestsDespiteMismatchedPrimaryType
// covers Fix 1: a phrase-discovered row (Types empty) must ingest under its
// own category even when the venue's primaryType maps to a different one —
// the exact escape_room/amusement_center collision that made the subtype
// permanently unfillable before this fix.
func TestActivities_SyncGoogleRow_TextQueryRowIngestsDespiteMismatchedPrimaryType(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{
		{ID: "escape-room", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/escape-room",
			PrimaryType: "amusement_center", Types: []string{"amusement_center"}},
	}}
	svc := New(repo).WithPlaces(gp)
	job := googleSyncJob{
		anchor: activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		row:    placesmap.DiscoveryRow{Category: activitiessvc.CategoryEntertainment, Subtype: "escape_room", TextQuery: "escape room"},
	}
	svc.syncGoogleRow(context.Background(), job, cellLocation{}, NearbyRadiusKM)

	if len(repo.gotUpserts) != 1 {
		t.Fatalf("upserts = %d, want 1 — a TextQuery row is stronger evidence than an incidental type overlap", len(repo.gotUpserts))
	}
	if repo.gotUpserts[0].Category != activitiessvc.CategoryEntertainment {
		t.Errorf("category = %s, want entertainment (the row's own category, not amusement_center's Kids)", repo.gotUpserts[0].Category)
	}
}

func TestActivities_SyncGoogleRow_AllSkippedStillMarksSynced(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{
		{ID: "playroom", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/playroom",
			PrimaryType: "amusement_center", Types: []string{"amusement_center"}},
	}}
	svc := New(repo).WithPlaces(gp)
	job := googleSyncJob{
		anchor: activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		row:    placesmap.DiscoveryRow{Category: activitiessvc.CategoryNature, Subtype: "botanical_garden", Types: []string{"botanical_garden"}},
	}
	svc.syncGoogleRow(context.Background(), job, cellLocation{}, NearbyRadiusKM)

	if len(repo.gotUpserts) != 0 {
		t.Fatalf("upserts = %v, want none", repo.gotUpserts)
	}
	wantKey := syncKey(ProviderGoogle, syncCellKey(job.anchor.Lat, job.anchor.Lng), string(activitiessvc.CategoryNature), "botanical_garden")
	if !slices.Contains(repo.markSynced, wantKey) {
		t.Errorf("markSynced = %v, want it to contain %q — a row whose every venue is skipped has nothing to ingest through no fault of its own, exactly like an all-below-floor row", repo.markSynced, wantKey)
	}
}

// The two tests below cover item 1's concurrency fix: an unbounded goroutine
// per Query, with no per-cell in-flight guard, let two concurrent queries
// against the same uncovered cell both see fresh()==false for the same rows
// and both sync them — doubling every search/upsert/photo call for that
// sweep. Both tests rely on cell claiming (claimGoogleSyncCells) happening
// synchronously on the calling goroutine, inside syncGoogleIfNeeded, before
// its sweep goroutine is even spawned — so a second call for an
// already-claimed cell is dropped deterministically, not merely "usually" if
// timing lines up. fakeGooglePlaces.blockNearby holds the first sweep
// provably in flight (never returned from SearchNearby, so its defer
// hasn't released the cell/semaphore) while the test issues the calls that
// must be dropped, removing any dependence on goroutine scheduling.

func TestSyncGoogleIfNeeded_ConcurrentSameCellOnlyOneSweep(t *testing.T) {
	newFixture := func() (*Activities, *fakeGooglePlaces) {
		repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
		gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{{ID: "x", Rating: 4.5, UserRatingCount: 20, GoogleMapsURI: "https://maps.google/x"}}}
		return New(repo).WithPlaces(gp), gp
	}
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}

	// Reference: exactly one sweep's worth of SearchNearby calls for this
	// (unfiltered, so budget-capped) request. Not hardcoded, since which of
	// the capped rows are Types-based (SearchNearby) vs TextQuery-based
	// (SearchTextInArea) is placesmap.DiscoveryRows' concern, not this
	// test's.
	refSvc, refGP := newFixture()
	refSvc.syncGoogleIfNeeded(context.Background(), req)
	refSvc.waitForGoogleSync()
	wantCalls := refGP.nearbyCalls
	if wantCalls == 0 {
		t.Fatal("reference sweep made 0 SearchNearby calls; test fixture is broken")
	}

	block := make(chan struct{})
	svc, gp := newFixture()
	gp.blockNearby = block

	// Sweep 1: claims the cell synchronously, then its goroutine blocks
	// inside its first SearchNearby call until we close(block) below — so
	// the cell claim is guaranteed still held for every line until then.
	svc.syncGoogleIfNeeded(context.Background(), req)

	// Sweep 2 and 3: same cell. The in-flight guard must drop these
	// synchronously, before ever touching SyncedAt or the Places client —
	// a saturated guard should keep dropping, not let a later call slip
	// through once one is already denied.
	svc.syncGoogleIfNeeded(context.Background(), req)
	svc.syncGoogleIfNeeded(context.Background(), req)

	close(block)
	svc.waitForGoogleSync()

	if gp.nearbyCalls != wantCalls {
		t.Errorf("nearbyCalls = %d, want %d (one sweep's worth) — the concurrent calls for the same cell should have been dropped by the in-flight guard, not started their own sweeps", gp.nearbyCalls, wantCalls)
	}
}

func TestSyncGoogleIfNeeded_SaturatedSemaphoreDropsWithoutBlockingCaller(t *testing.T) {
	block := make(chan struct{})
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	gp := &fakeGooglePlaces{
		nearbyOut:   []placesmap.Place{{ID: "x", Rating: 4.5, UserRatingCount: 20, GoogleMapsURI: "https://maps.google/x"}},
		blockNearby: block,
	}
	svc := New(repo).WithPlaces(gp)

	// Fill every concurrency slot with a sweep against its own distinct
	// cell, so the per-cell guard above isn't what's under test here. Each
	// call's cell claim + semaphore acquire happens synchronously before
	// this loop moves on, so by the time it exits, all googleSyncConcurrency
	// slots are held — regardless of whether any sweep goroutine has
	// actually been scheduled yet.
	for i := range googleSyncConcurrency {
		req := Request{
			Scope:           activitiessvc.ScopeNearby,
			CurrentLocation: &activitiessvc.Point{Lat: 10 + float64(i), Lng: 10},
		}
		svc.syncGoogleIfNeeded(context.Background(), req)
	}

	// One more, a distinct cell again: the semaphore is full, so this must
	// be dropped rather than queued, and — the "without blocking" half of
	// item 1's fix — syncGoogleIfNeeded itself must return immediately
	// rather than waiting for a slot to free up.
	const extraLat = 999.0
	extraReq := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: extraLat, Lng: 10},
	}
	done := make(chan struct{})
	go func() {
		svc.syncGoogleIfNeeded(context.Background(), extraReq)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("syncGoogleIfNeeded blocked the caller instead of dropping the sweep when the semaphore was saturated")
	}

	close(block)
	svc.waitForGoogleSync()

	for _, r := range gp.gotNearby {
		if r.Lat == extraLat {
			t.Error("the semaphore-saturated sweep's cell was processed anyway — it should have been dropped, never run")
		}
	}
}

// TestSubtypeFor_NameOverride pins the three-way precedence subtypeFor now
// implements: a local keyword beats Google, Google beats a generic keyword,
// and a generic keyword beats the row's own fallback subtype.
func TestSubtypeFor_NameOverride(t *testing.T) {
	tests := []struct {
		name string
		row  placesmap.DiscoveryRow
		p    placesmap.Place
		want string
	}{
		{
			name: "local keyword overrides a valid google answer",
			row:  placesmap.DiscoveryRow{Category: activitiessvc.CategoryNightlife, Subtype: "lounge"},
			p:    placeNamed("Hookah House | Lounge Bar", "night_club", nil),
			want: "shisha_lounge",
		},
		{
			name: "google wins when no local keyword matches",
			row:  placesmap.DiscoveryRow{Category: activitiessvc.CategoryNightlife, Subtype: "lounge"},
			p:    placeNamed("Club Drugstore", "night_club", nil),
			want: "nightclub",
		},
		{
			name: "row fallback when neither google nor a keyword resolves",
			row:  placesmap.DiscoveryRow{Category: activitiessvc.CategoryNightlife, Subtype: "lounge"},
			p:    placeNamed("Some Venue", "", nil),
			want: "lounge",
		},
		{
			name: "kafana overrides google's nightclub",
			row:  placesmap.DiscoveryRow{Category: activitiessvc.CategoryNightlife, Subtype: "lounge"},
			p:    placeNamed("Kafana Moskva", "night_club", nil),
			want: "kafana_live",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := subtypeFor(tt.row, tt.p); got != tt.want {
				t.Errorf("subtypeFor() = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestSubtypeFor_Idempotent guards the C4 hazard: Upsert overwrites
// subcategory unconditionally, so classifying a venue twice must produce the
// same answer or every re-sync would undo the backfill.
func TestSubtypeFor_Idempotent(t *testing.T) {
	row := placesmap.DiscoveryRow{Category: activitiessvc.CategoryNightlife, Subtype: "lounge"}
	p := placeNamed("Muar Lounge Nargila&Bar", "night_club", nil)
	first := subtypeFor(row, p)
	if second := subtypeFor(row, p); first != second {
		t.Errorf("subtypeFor not idempotent: %q then %q", first, second)
	}
	if first != "shisha_lounge" {
		t.Errorf("subtypeFor() = %q, want shisha_lounge", first)
	}
}

// placeNamed builds the minimal placesmap.Place the subtype tests need.
func placeNamed(name, primaryType string, types []string) placesmap.Place {
	var p placesmap.Place
	p.DisplayName.Text = name
	p.PrimaryType = primaryType
	p.Types = types
	return p
}
