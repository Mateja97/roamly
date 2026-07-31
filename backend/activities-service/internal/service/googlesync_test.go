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
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{{
		ID: "monument-1", Rating: 4.4, UserRatingCount: 30,
		GoogleMapsURI: "https://maps.google/monument-1",
		PrimaryType:   "monument",
		Types:         []string{"monument", "historical_place", "tourist_attraction"},
		AddressComponents: []placesmap.AddressComponent{
			{LongText: "Belgrade", Types: []string{"locality", "political"}},
			{LongText: "Serbia", Types: []string{"country", "political"}},
		},
	}}}
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
	// City/Country come from the place's own address components, not the
	// discovery row — without this, BuildLiveDetails' opening-hours timezone
	// lookup (keyed on City) always misses for a sweep-ingested row.
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

func TestActivities_Query_GoogleSync_GeocodeFailureFallsBackPerVenue(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	p := placesmap.Place{ID: "a", Rating: 4.4, UserRatingCount: 30, GoogleMapsURI: "https://maps.google/a"}
	p.AddressComponents = []placesmap.AddressComponent{
		{LongText: "Beograd", Types: []string{"locality"}},
		{LongText: "Serbia", Types: []string{"country"}},
	}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{p}, geocodeErr: errors.New("geocode 503")}
	svc := New(repo).WithPlaces(gp)
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForGoogleSync()

	if len(repo.gotUpserts) == 0 {
		t.Fatal("no upserts — a geocode failure must degrade, not drop the sweep")
	}
	if repo.gotUpserts[0].City != "Beograd" {
		t.Errorf("city = %q, want the per-venue fallback Beograd", repo.gotUpserts[0].City)
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

// The two tests below call syncGoogleRow directly (sanctioned — see
// googleDueRows/subtypeFor above) rather than going through Query. Query's
// due-row selection always schedules up to maxGoogleRowsPerQuery (8) rows
// per sweep whenever more than 8 of the 53 DiscoveryRows are stale, which is
// true for every unfiltered request against a fakeRepo with an empty
// syncedAtOut. Since fakeGooglePlaces returns the same fixture place for any
// row, going through Query here would call ResolvePhotos/Upsert 8 times
// instead of the 1 these tests need to isolate.

func TestActivities_Query_GoogleSync_ResolvesOneProvisionalPhoto(t *testing.T) {
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
	svc.syncGoogleRow(context.Background(), job, cellLocation{})

	if len(repo.gotUpserts) == 0 {
		t.Fatal("no upserts")
	}
	if len(repo.gotUpserts[0].Photos) != 1 {
		t.Errorf("photos = %d, want exactly 1 provisional photo (the full set resolves on detail view)",
			len(repo.gotUpserts[0].Photos))
	}
	if gp.resolvePhotoCalls != 1 {
		t.Errorf("ResolvePhotos calls = %d, want 1 — one per newly discovered venue", gp.resolvePhotoCalls)
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
	svc.syncGoogleRow(context.Background(), job, cellLocation{})

	if gp.nearbyCalls != 1 {
		t.Fatalf("nearbyCalls = %d, want 1", gp.nearbyCalls)
	}
	got := gp.gotNearby[0]
	if got.RadiusM != googleSyncRadiusKM*1000 {
		t.Errorf("RadiusM = %v, want %v (googleSyncRadiusKM * 1000)", got.RadiusM, googleSyncRadiusKM*1000)
	}
	if got.MaxResults != 20 {
		t.Errorf("MaxResults = %d, want 20", got.MaxResults)
	}
	if !slices.Equal(got.IncludedTypes, job.row.Types) {
		t.Errorf("IncludedTypes = %v, want the row's own types %v passed through unchanged", got.IncludedTypes, job.row.Types)
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
	svc.syncGoogleRow(context.Background(), job, cellLocation{})

	if len(repo.gotUpserts) != 1 {
		t.Fatalf("upserts = %d, want 1 — a venue with no photo is still worth ingesting", len(repo.gotUpserts))
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
