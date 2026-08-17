package service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"activities-service/internal/placesmap"
	"activities-service/internal/tripadvisor"

	"backend/shared/models/activitiessvc"
)

func TestActivities_Query_TripadvisorSync_TriggersWhenAreaNeverSynced(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111", Name: "Ambar Beograd", WebURL: "https://ta/Restaurant_Review-1"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {
				LocationID: "111", Name: "Ambar Beograd", Lat: 44.81, Lng: 20.46, Rating: 4.5,
				City: "Belgrade", Country: "Serbia", Phone: "+381 11 328 6637",
				WebURL: "https://ta/Restaurant_Review-1", RatingImageURL: "https://ta/img/4.5.svg", ReviewCount: 1204,
				Subratings: tripadvisor.Subratings{
					Food:       &tripadvisor.Aspect{Rating: 4.5, IconURL: "https://ta/food.svg"},
					Service:    &tripadvisor.Aspect{Rating: 4.0, IconURL: "https://ta/service.svg"},
					Value:      &tripadvisor.Aspect{Rating: 4.0, IconURL: "https://ta/value.svg"},
					Atmosphere: &tripadvisor.Aspect{Rating: 4.5, IconURL: "https://ta/atmosphere.svg"},
				},
				Rankings:   []tripadvisor.Ranking{{DisplayText: "#12 of 1,780 Restaurants in Belgrade", Rank: 12, Total: 1780, Category: "restaurants"}},
				Award:      &tripadvisor.Award{Name: "Travelers' Choice", Year: 2026},
				PriceLevel: "Mid Range",
				Categories: []tripadvisor.Category{{DisplayName: "Fine Dining", Hierarchy: "restaurants > fine_dining"}},
			},
		},
		reviewsOut: map[string][]tripadvisor.Review{
			"111": {
				{Rating: 4, Date: "2026-01-01", Text: "It was fine."},
				{Rating: 5, Date: "2026-03-03", Text: "Loved it."},
				{Rating: 5, Date: "2026-02-02", Text: "Great rakia."},
			},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if ta.nearbyCalls != 1 {
		t.Errorf("NearbySearch calls = %d, want 1", ta.nearbyCalls)
	}
	if len(ta.gotNearbySearch) != 1 {
		t.Fatalf("NearbySearch recorded calls = %d, want 1", len(ta.gotNearbySearch))
	}
	if got := ta.gotNearbySearch[0]; got.lat != 44.81 || got.lng != 20.46 || got.radiusKM != tripadvisorSyncRadiusKM || got.category != "RESTAURANT" {
		t.Errorf("NearbySearch call = %+v, want lat=44.81 lng=20.46 radiusKM=%v category=RESTAURANT (Terra has no bars-specific category)", got, float64(tripadvisorSyncRadiusKM))
	}
	if repo.upsertCalls != 1 {
		t.Errorf("Upsert calls = %d, want 1", repo.upsertCalls)
	}
	if repo.gotUpsert.Source != "tripadvisor" || repo.gotUpsert.ExternalID != "111" || repo.gotUpsert.Status != activitiessvc.StatusPublished {
		t.Errorf("Upsert input = %+v, want Source=tripadvisor ExternalID=111 Status=published", repo.gotUpsert)
	}
	if repo.gotUpsert.City != "Belgrade" || repo.gotUpsert.Country != "Serbia" {
		t.Errorf("Upsert input City/Country = %q/%q, want Belgrade/Serbia", repo.gotUpsert.City, repo.gotUpsert.Country)
	}
	if len(repo.markSynced) != 1 || repo.markSynced[0] != "44.8,20.5|restaurants" {
		t.Errorf("markSynced = %v, want exactly one call for cell 44.8,20.5/restaurants", repo.markSynced)
	}
	// D3: Tripadvisor's covered radius never varies by request, but every
	// sync_regions row it writes still records radius_km for schema
	// consistency with Google's per-request column (T1, rating-and-anywhere-radius).
	if r := repo.markSyncedRadius["44.8,20.5|restaurants"]; r != tripadvisorSyncRadiusKM {
		t.Errorf("markSynced radius = %v, want %v (tripadvisorSyncRadiusKM, unconditionally)", r, float64(tripadvisorSyncRadiusKM))
	}

	var details activitiessvc.RestaurantDetails
	if err := json.Unmarshal(repo.gotUpsert.Details, &details); err != nil {
		t.Fatalf("unmarshaling upserted details: %v", err)
	}
	if details.Tripadvisor == nil {
		t.Fatal("details.Tripadvisor = nil, want the attribution block populated")
	}
	wantRankingText := "#12 of 1,780 Restaurants in Belgrade, as rated by Tripadvisor travelers as of " + time.Now().Format("January 2006")
	if details.Tripadvisor.WebURL != "https://ta/Restaurant_Review-1" || details.Tripadvisor.RatingImageURL != "https://ta/img/4.5.svg" ||
		details.Tripadvisor.ReviewCount != 1204 || details.Tripadvisor.RankingText != wantRankingText {
		t.Errorf("details.Tripadvisor = %+v, want WebURL/RatingImageURL/ReviewCount matching the fixture and RankingText = %q (Terra's display_text + dated suffix, rule 05)", details.Tripadvisor, wantRankingText)
	}
	if details.Tripadvisor.Phone != "+381 11 328 6637" {
		t.Errorf("details.Tripadvisor.Phone = %q, want +381 11 328 6637", details.Tripadvisor.Phone)
	}
	if details.Tripadvisor.Award == nil || *details.Tripadvisor.Award != (activitiessvc.TripadvisorAward{Name: "Travelers' Choice", Year: 2026}) {
		t.Errorf("details.Tripadvisor.Award = %+v, want Travelers' Choice 2026", details.Tripadvisor.Award)
	}
	if details.Tripadvisor.PriceLevel != "Mid Range" {
		t.Errorf("details.Tripadvisor.PriceLevel = %q, want Mid Range", details.Tripadvisor.PriceLevel)
	}
	if details.Tripadvisor.Cuisine != "Fine Dining" {
		t.Errorf("details.Tripadvisor.Cuisine = %q, want Fine Dining", details.Tripadvisor.Cuisine)
	}
	// No Places client is configured on this svc, so Google's type and the
	// name keywords both yield nothing; but the fixture's PriceLevel ("Mid
	// Range") is still threaded through to ResolveTripadvisorSubtype's price
	// fallback (T2), so the price tier alone resolves this to casual_dining.
	// TestActivities_Query_TripadvisorSync_SubtypeResolvedFromGooglePlaceType
	// below covers the Google-resolved case, which wins over price.
	if repo.gotUpsert.Subcategory != "casual_dining" {
		t.Errorf("gotUpsert.Subcategory = %q, want casual_dining (from the Mid Range price tier)", repo.gotUpsert.Subcategory)
	}
	wantSubratings := &activitiessvc.TripadvisorSubratings{
		Food:       &activitiessvc.TripadvisorAspectRating{Rating: 4.5, IconURL: "https://ta/food.svg"},
		Service:    &activitiessvc.TripadvisorAspectRating{Rating: 4.0, IconURL: "https://ta/service.svg"},
		Value:      &activitiessvc.TripadvisorAspectRating{Rating: 4.0, IconURL: "https://ta/value.svg"},
		Atmosphere: &activitiessvc.TripadvisorAspectRating{Rating: 4.5, IconURL: "https://ta/atmosphere.svg"},
	}
	if !reflect.DeepEqual(details.Tripadvisor.Subratings, wantSubratings) {
		t.Errorf("details.Tripadvisor.Subratings = %+v, want %+v", details.Tripadvisor.Subratings, wantSubratings)
	}

	wantReviews := []activitiessvc.TripadvisorReview{
		{Rating: 5, Date: "2026-03-03", Text: "Loved it."},
		{Rating: 5, Date: "2026-02-02", Text: "Great rakia."},
	}
	if len(details.Reviews) != len(wantReviews) {
		t.Fatalf("details.Reviews = %+v, want %+v — proves Reviews survives the actual json.Marshal/tripadvisorDetailsPayload upsert path, not just the isolated tripadvisorReviews() unit test", details.Reviews, wantReviews)
	}
	for i := range wantReviews {
		if details.Reviews[i] != wantReviews[i] {
			t.Errorf("details.Reviews[%d] = %+v, want %+v", i, details.Reviews[i], wantReviews[i])
		}
	}
}

func TestActivities_Query_TripadvisorSync_SkipsWhenFresh(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{"44.8,20.5|restaurants": time.Now().Add(-time.Hour)}}
	ta := &fakeTripadvisor{}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if ta.nearbyCalls != 0 {
		t.Errorf("NearbySearch calls = %d, want 0 (synced an hour ago, within the 14-day TTL)", ta.nearbyCalls)
	}
}

func TestActivities_Query_TripadvisorSync_ReSyncsWhenStale(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{"44.8,20.5|restaurants": time.Now().Add(-15 * 24 * time.Hour)}}
	ta := &fakeTripadvisor{}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if ta.nearbyCalls != 1 {
		t.Errorf("NearbySearch calls = %d, want 1 (synced 15 days ago, past the 14-day TTL)", ta.nearbyCalls)
	}
}

func TestActivities_Query_TripadvisorSync_NoClientConfiguredNeverSyncs(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	svc := New(repo) // no WithTripadvisor

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	if repo.upsertCalls != 0 {
		t.Errorf("Upsert calls = %d, want 0", repo.upsertCalls)
	}
}

func TestActivities_Query_TripadvisorSync_NonTripadvisorCategoryNeverSyncs(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryCulture}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	if ta.nearbyCalls != 0 {
		t.Errorf("NearbySearch calls = %d, want 0 (query only asked for culture)", ta.nearbyCalls)
	}
}

func TestActivities_Query_TripadvisorSync_UnfilteredQuerySyncsOneSearchOneRow(t *testing.T) {
	// Restaurants, Cafés and Bars are all due for the one anchor here. Terra
	// has no per-category search distinction, so a NearbySearch(RESTAURANT)
	// covers all three — but the venue's name (namemap.Category)
	// decides its one true category, so it gets exactly one Upsert, not one
	// per due category.
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111", Name: "Ambar Beograd", WebURL: "https://ta/Restaurant_Review-1"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Ambar Beograd", WebURL: "https://ta/Restaurant_Review-1", PriceLevel: "Mid Range"},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}} // no Categories = "All"
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()
	if ta.nearbyCalls != 1 {
		t.Errorf("NearbySearch calls = %d, want 1 (restaurants + cafes + bars share one search, unfiltered query)", ta.nearbyCalls)
	}
	if repo.upsertCalls != 1 {
		t.Errorf("Upsert calls = %d, want 1 (exactly one row per venue, regardless of how many categories were due)", repo.upsertCalls)
	}
	if repo.gotUpsert.Category != activitiessvc.CategoryRestaurants {
		t.Errorf("Category = %q, want restaurants ('Ambar Beograd' matches no cafe/bar keyword)", repo.gotUpsert.Category)
	}
}

func TestActivities_Query_TripadvisorSync_OneVenueOneRowInvariant(t *testing.T) {
	// The core bug fix: before, a Restaurants sync and a Bars sync for the
	// same anchor each upserted the same venue under their own category, so
	// one real-world venue produced two rows with the same source_url. Now
	// namemap.Category derives the venue's one true category from its
	// name, so even when both Restaurants and Bars are due, a bar-named
	// venue produces exactly one row, filed as Bars.
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111", Name: "Gradska Pivnica Terazije", WebURL: "https://ta/Restaurant_Review-1"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Gradska Pivnica Terazije", WebURL: "https://ta/Restaurant_Review-1", PriceLevel: "Mid Range"},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryRestaurants, activitiessvc.CategoryBars},
	}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if ta.nearbyCalls != 1 {
		t.Errorf("NearbySearch calls = %d, want 1", ta.nearbyCalls)
	}
	if len(repo.gotUpserts) != 1 {
		t.Fatalf("Upsert calls = %d, want exactly 1 — one venue must produce exactly one row", len(repo.gotUpserts))
	}
	if repo.gotUpserts[0].Category != activitiessvc.CategoryBars {
		t.Errorf("Category = %q, want bars ('Gradska Pivnica Terazije' matches the pivnica keyword)", repo.gotUpserts[0].Category)
	}
	// MarkSynced still runs for every due category — this anchor's search
	// did cover both, even though only one produced a row.
	if len(repo.markSynced) != 2 {
		t.Errorf("markSynced calls = %d, want 2 (one per due category, not per candidate)", len(repo.markSynced))
	}
}

func TestActivities_Query_TripadvisorSync_CandidateSkippedWhenClassifiedCategoryNotDue(t *testing.T) {
	// Only Bars is due at this anchor (Restaurants/Cafés are still fresh).
	// The single NearbySearch still finds a restaurant-named candidate, but
	// it must be skipped rather than upserted under a category that wasn't
	// due — that category's cached row is already fresh.
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111", Name: "Inferno Pizza", WebURL: "https://ta/Restaurant_Review-1"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Inferno Pizza", WebURL: "https://ta/Restaurant_Review-1", PriceLevel: "Mid Range"},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryBars},
	}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if ta.nearbyCalls != 1 {
		t.Errorf("NearbySearch calls = %d, want 1", ta.nearbyCalls)
	}
	if repo.upsertCalls != 0 {
		t.Errorf("Upsert calls = %d, want 0 ('Inferno Pizza' classifies as restaurants, not the due bars)", repo.upsertCalls)
	}
	if len(repo.markSynced) != 1 || repo.markSynced[0] != "44.8,20.5|bars" {
		t.Errorf("markSynced = %v, want exactly one call for cell 44.8,20.5/bars", repo.markSynced)
	}
}

func TestActivities_Query_TripadvisorSync_CapsAnchorsPerQuery(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{
		Scope: activitiessvc.ScopeAnywhere,
		Cities: []activitiessvc.Point{
			{Lat: 1, Lng: 1}, {Lat: 2, Lng: 2}, {Lat: 3, Lng: 3}, {Lat: 4, Lng: 4}, {Lat: 5, Lng: 5},
		},
		Categories: []activitiessvc.Category{activitiessvc.CategoryBars},
	}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()
	if ta.nearbyCalls != maxSyncAnchorsPerQuery {
		t.Errorf("NearbySearch calls = %d, want %d (5 cities, capped)", ta.nearbyCalls, maxSyncAnchorsPerQuery)
	}
}

func TestActivities_Query_TripadvisorSync_StaleAnchorNotStarvedByEarlierFreshAnchors(t *testing.T) {
	// Anchors 1-3 are already fresh; anchor 4 has never been synced. The
	// maxSyncAnchorsPerQuery cap (3) must apply to the anchors that still
	// need a sync, not to the raw anchor list before staleness is known —
	// otherwise a cap-then-check order would truncate to anchors 1-3, all
	// fresh, and anchor 4 would never get synced no matter how many times
	// this exact request repeats.
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{
		"1.0,1.0|restaurants": time.Now().Add(-time.Hour),
		"2.0,2.0|restaurants": time.Now().Add(-time.Hour),
		"3.0,3.0|restaurants": time.Now().Add(-time.Hour),
		// "4.0,4.0|restaurants" intentionally absent: never synced.
	}}
	ta := &fakeTripadvisor{}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{
		Scope: activitiessvc.ScopeAnywhere,
		Cities: []activitiessvc.Point{
			{Lat: 1, Lng: 1}, {Lat: 2, Lng: 2}, {Lat: 3, Lng: 3}, {Lat: 4, Lng: 4},
		},
		Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants},
	}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if ta.nearbyCalls != 1 {
		t.Fatalf("NearbySearch calls = %d, want 1 (only the never-synced 4th anchor is due)", ta.nearbyCalls)
	}
	if len(ta.gotNearbySearch) != 1 || ta.gotNearbySearch[0].lat != 4 || ta.gotNearbySearch[0].lng != 4 {
		t.Errorf("NearbySearch call = %+v, want the stale anchor (4,4), not one of the earlier fresh anchors", ta.gotNearbySearch)
	}
	if len(repo.markSynced) != 1 || repo.markSynced[0] != "4.0,4.0|restaurants" {
		t.Errorf("markSynced = %v, want exactly one call for cell 4.0,4.0/restaurants", repo.markSynced)
	}
}

func TestActivities_Query_TripadvisorSync_NearbySearchErrorFallsThrough(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{nearbyErr: context.DeadlineExceeded}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v, want the search to fail silently and Query to still succeed", err)
	}
	svc.waitForTripadvisorSync()
	if repo.upsertCalls != 0 {
		t.Errorf("Upsert calls = %d, want 0", repo.upsertCalls)
	}
	if len(repo.markSynced) != 0 {
		t.Errorf("markSynced = %v, want no mark when the search itself failed", repo.markSynced)
	}
}

func TestActivities_Query_TripadvisorSync_OneBadDetailsCallDoesNotSinkTheRest(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{
			{LocationID: "bad", Name: "Bad Place", WebURL: "https://ta/Restaurant_Review-bad"},
			{LocationID: "good", Name: "Fine Place", WebURL: "https://ta/Restaurant_Review-good"},
		},
		detailsErrs: map[string]error{"bad": context.DeadlineExceeded},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"good": {LocationID: "good", Name: "Fine Place", Rating: 4.0, WebURL: "https://ta/Restaurant_Review-good", PriceLevel: "Mid Range"},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()
	if repo.upsertCalls != 1 {
		t.Errorf("Upsert calls = %d, want 1 — \"bad\"'s LocationDetails failure skips only that candidate, \"good\" still upserts", repo.upsertCalls)
	}
	if repo.gotUpsert.ExternalID != "good" {
		t.Errorf("gotUpsert.ExternalID = %q, want %q", repo.gotUpsert.ExternalID, "good")
	}
	if len(repo.markSynced) != 1 {
		t.Errorf("markSynced = %v, want the area still marked synced despite one bad candidate", repo.markSynced)
	}
}

func TestActivities_Query_TripadvisorSync_NonFoodSummariesNeverCostDetailsCalls(t *testing.T) {
	// Terra's unfiltered nearby search buries the food venues in hotels,
	// apartments and attractions. The summary's own WebURL identifies those,
	// so junk candidates must be dropped before any LocationDetails call —
	// with paginated sweeps of ~100 candidates, paying a details call per
	// junk venue is most of the sweep's cost.
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{
			{LocationID: "hotel", Name: "Hotel Zelos", WebURL: "https://ta/Hotel_Review-hotel"},
			{LocationID: "monument", Name: "Njegos Monument", WebURL: "https://ta/Attraction_Review-monument"},
			{LocationID: "nourl", Name: "Tim Kombi Prevoz Putnika"},
			{LocationID: "food", Name: "Restoran Taverna", WebURL: "https://ta/Restaurant_Review-food"},
		},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"food": {LocationID: "food", Name: "Restoran Taverna", WebURL: "https://ta/Restaurant_Review-food", PriceLevel: "Mid Range"},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if ta.detailsCalls != 1 {
		t.Errorf("LocationDetails calls = %d, want 1 — only the Restaurant_Review candidate may cost a details call", ta.detailsCalls)
	}
	if repo.upsertCalls != 1 || repo.gotUpsert.ExternalID != "food" {
		t.Errorf("upserts = %d (ExternalID %q), want exactly the food venue", repo.upsertCalls, repo.gotUpsert.ExternalID)
	}
}

func TestActivities_Query_TripadvisorSync_DeadlineTruncatedSweepLeavesAreaUnmarked(t *testing.T) {
	// A sweep the deadline cuts short ingested only a prefix of its
	// candidates. Marking the area synced would freeze that prefix for the
	// whole 14-day TTL — exactly how Belgrade got stuck at 2 restaurants.
	// The partial upserts stay, but the cell must remain unmarked so the
	// next query resumes the sweep.
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{
			{LocationID: "111", Name: "Restoran Taverna", WebURL: "https://ta/Restaurant_Review-1"},
		},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Restoran Taverna", WebURL: "https://ta/Restaurant_Review-1", PriceLevel: "Mid Range"},
		},
		detailsDelay: 50 * time.Millisecond,
	}
	svc := New(repo).WithTripadvisor(ta)
	svc.syncTimeout = 10 * time.Millisecond

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if len(repo.markSynced) != 0 {
		t.Errorf("markSynced = %v, want none — a deadline-truncated sweep must leave the area unmarked to resume next query", repo.markSynced)
	}
	// The truncated sweep's partial work is kept, not rolled back — the
	// fake's details call outlives the deadline but still returns, so its
	// upsert must have landed.
	if repo.upsertCalls != 1 {
		t.Errorf("Upsert calls = %d, want 1 — partial results survive a truncated sweep", repo.upsertCalls)
	}
}

// TestActivities_Query_TripadvisorSync_SlowTripadvisorNeverBlocksOrFailsQuery
// is the T1 regression guard: before, syncTripadvisorIfNeeded ran inline and
// awaited, so a slow/degraded Tripadvisor pushed real Query latency toward
// tripadvisorSyncTotalTimeout, and a client that gave up first (its request
// context cancelled) turned into a failed query, not merely a stale one.
// This proves both halves: Query returns promptly despite a slow
// LocationDetails call, and the backgrounded sweep still completes even
// after the request's own context is cancelled the moment the "client"
// gives up — exactly the failure mode reported in logs/Fl1, logs/Fl2.
func TestActivities_Query_TripadvisorSync_SlowTripadvisorNeverBlocksOrFailsQuery(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{
			{LocationID: "111", Name: "Restoran Taverna", WebURL: "https://ta/Restaurant_Review-1"},
		},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Restoran Taverna", WebURL: "https://ta/Restaurant_Review-1", PriceLevel: "Mid Range"},
		},
		detailsDelay: 2 * time.Second, // stands in for a slow/degraded Terra call
	}
	svc := New(repo).WithTripadvisor(ta)

	// The request's own context — cancelled right after Query returns, the
	// same way a client giving up cancels the inbound gRPC/HTTP context.
	reqCtx, cancel := context.WithCancel(context.Background())
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}

	start := time.Now()
	if _, err := svc.Query(reqCtx, req); err != nil {
		t.Fatalf("Query() error: %v, want a slow Tripadvisor to never fail the query", err)
	}
	// Bound against the injected delay itself, not a fixed wall-clock
	// number — a fixed bound is flake-prone under -race on a loaded runner;
	// well under the delay is only possible if the sweep is backgrounded.
	if elapsed := time.Since(start); elapsed >= ta.detailsDelay {
		t.Errorf("Query() took %v with a %v-slow Tripadvisor client, want it to return well under that — the sync must run backgrounded, not inline", elapsed, ta.detailsDelay)
	}
	cancel() // the client has already "given up" by the time this fires

	svc.waitForTripadvisorSync()
	if repo.upsertCalls != 1 {
		t.Errorf("Upsert calls = %d, want 1 — the backgrounded sweep must finish even after the request context is cancelled", repo.upsertCalls)
	}
	if len(repo.markSynced) != 1 {
		t.Errorf("markSynced = %v, want the area marked synced once the backgrounded sweep completes", repo.markSynced)
	}
}

// The two tests below cover the concurrency guards syncTripadvisorIfNeeded's
// backgrounded sweep must carry, the same way syncGoogleIfNeeded already
// does (see TestSyncGoogleIfNeeded_ConcurrentSameCellOnlyOneSweep /
// TestSyncGoogleIfNeeded_SaturatedSemaphoreDropsWithoutBlockingCaller,
// whose shape these mirror exactly): detaching the sweep from the request
// context without an in-flight cell claim and a concurrency cap would trade
// the original "slow query" bug for "unbounded concurrent load on Terra",
// triggered by exactly the degraded-Tripadvisor condition this fix targets.
// fakeTripadvisor.blockNearby holds a sweep provably in flight (never
// returned from NearbySearch, so its defer hasn't released the cell/
// semaphore) while the test issues the calls that must be dropped, removing
// any dependence on goroutine scheduling.

func TestSyncTripadvisorIfNeeded_ConcurrentSameCellOnlyOneSweep(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	block := make(chan struct{})
	ta := &fakeTripadvisor{blockNearby: block}
	svc := New(repo).WithTripadvisor(ta)
	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}

	// Sweep 1: claims the anchor's cell synchronously, then its goroutine
	// blocks inside its NearbySearch call until we close(block) below — so
	// the cell claim is guaranteed still held for every line until then.
	// Tripadvisor issues exactly one NearbySearch per anchor (unlike
	// Google's per-subtype fan-out), so no reference sweep is needed to know
	// what "one sweep's worth" of calls looks like.
	svc.syncTripadvisorIfNeeded(context.Background(), req)

	// Sweep 2 and 3: same anchor. The in-flight guard must drop these
	// synchronously — a saturated guard should keep dropping, not let a
	// later call slip through once one is already denied.
	svc.syncTripadvisorIfNeeded(context.Background(), req)
	svc.syncTripadvisorIfNeeded(context.Background(), req)

	close(block)
	svc.waitForTripadvisorSync()

	if ta.nearbyCalls != 1 {
		t.Errorf("NearbySearch calls = %d, want 1 — the concurrent calls for the same anchor should have been dropped by the in-flight guard, not started their own sweeps", ta.nearbyCalls)
	}
}

func TestSyncTripadvisorIfNeeded_SaturatedSemaphoreDropsWithoutBlockingCaller(t *testing.T) {
	block := make(chan struct{})
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{blockNearby: block}
	svc := New(repo).WithTripadvisor(ta)

	// Fill every concurrency slot with a sweep against its own distinct
	// anchor, so the per-cell guard above isn't what's under test here. Each
	// call's cell claim + semaphore acquire happens synchronously before
	// this loop moves on, so by the time it exits, all
	// tripadvisorSyncConcurrency slots are held — regardless of whether any
	// sweep goroutine has actually been scheduled yet.
	for i := range tripadvisorSyncConcurrency {
		req := Request{
			Scope:           activitiessvc.ScopeNearby,
			CurrentLocation: &activitiessvc.Point{Lat: 10 + float64(i), Lng: 10},
			Categories:      []activitiessvc.Category{activitiessvc.CategoryRestaurants},
		}
		svc.syncTripadvisorIfNeeded(context.Background(), req)
	}

	// One more, a distinct anchor again: the semaphore is full, so this must
	// be dropped rather than queued, and — the "without blocking" half of
	// the fix — syncTripadvisorIfNeeded itself must return immediately
	// rather than waiting for a slot to free up.
	const extraLat = 999.0
	extraReq := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: extraLat, Lng: 10},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryRestaurants},
	}
	done := make(chan struct{})
	go func() {
		svc.syncTripadvisorIfNeeded(context.Background(), extraReq)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("syncTripadvisorIfNeeded blocked the caller instead of dropping the sweep when the semaphore was saturated")
	}

	close(block)
	svc.waitForTripadvisorSync()

	for _, c := range ta.gotNearbySearch {
		if c.lat == extraLat {
			t.Error("the semaphore-saturated sweep's anchor was processed anyway — it should have been dropped, never run")
		}
	}
}

func TestActivities_Query_TripadvisorSync_AllSummariesMissingWebURLAbortsUnmarked(t *testing.T) {
	// The junk gate reads the summary's WebURL. If Terra stops returning
	// urls.tripadvisor.main entirely, every candidate would drop silently
	// and an empty "successful" sweep would freeze the cell at zero venues
	// for the TTL. A result set with no URLs at all means the gate signal
	// is broken: abort before per-venue calls, leave the cell unmarked.
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{
			{LocationID: "1", Name: "Restoran Taverna"},
			{LocationID: "2", Name: "Kafana Znak Pitanja"},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	svc.waitForTripadvisorSync()

	if ta.detailsCalls != 0 {
		t.Errorf("LocationDetails calls = %d, want 0", ta.detailsCalls)
	}
	if len(repo.markSynced) != 0 {
		t.Errorf("markSynced = %v, want none — a URL-less result set must not stamp the cell synced", repo.markSynced)
	}
}

func TestTripadvisorReviews_FilterAndTruncation(t *testing.T) {
	tests := []struct {
		name    string
		rating  float64
		reviews []tripadvisor.Review
		want    []activitiessvc.TripadvisorReview
	}{
		{"below 4.0 never calls reviews", 3.5, []tripadvisor.Review{{Rating: 5, Date: "2026-01-01", Text: "x"}}, nil},
		{
			"4.0 with one 5-bubble review",
			4.0,
			[]tripadvisor.Review{{Rating: 4, Date: "2026-01-01", Text: "ok"}, {Rating: 5, Date: "2026-02-02", Text: "great"}},
			[]activitiessvc.TripadvisorReview{{Rating: 5, Date: "2026-02-02", Text: "great"}},
		},
		{"rated high but no 5-bubble review", 4.8, []tripadvisor.Review{{Rating: 4, Date: "2026-01-01", Text: "ok"}}, nil},
		{
			"non-5-bubble reviews are skipped, not just truncated off the end",
			4.5,
			[]tripadvisor.Review{
				{Rating: 5, Date: "2026-01-01", Text: "a"},
				{Rating: 3, Date: "2026-01-02", Text: "b"},
				{Rating: 5, Date: "2026-01-03", Text: "c"},
			},
			[]activitiessvc.TripadvisorReview{
				{Rating: 5, Date: "2026-01-01", Text: "a"},
				{Rating: 5, Date: "2026-01-03", Text: "c"},
			},
		},
		{
			"more than 3 eligible reviews truncates to 3, most-recent-first order preserved",
			4.5,
			[]tripadvisor.Review{
				{Rating: 5, Date: "2026-01-01", Text: "a"},
				{Rating: 5, Date: "2026-01-02", Text: "b"},
				{Rating: 5, Date: "2026-01-03", Text: "c"},
				{Rating: 5, Date: "2026-01-04", Text: "d"},
				{Rating: 5, Date: "2026-01-05", Text: "e"},
			},
			[]activitiessvc.TripadvisorReview{
				{Rating: 5, Date: "2026-01-01", Text: "a"},
				{Rating: 5, Date: "2026-01-02", Text: "b"},
				{Rating: 5, Date: "2026-01-03", Text: "c"},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			ta := &fakeTripadvisor{reviewsOut: map[string][]tripadvisor.Review{"x": tt.reviews}}
			svc := New(repo).WithTripadvisor(ta)

			got := svc.tripadvisorReviews(context.Background(), tripadvisor.LocationDetails{LocationID: "x", Rating: tt.rating})
			if len(got) != len(tt.want) {
				t.Fatalf("tripadvisorReviews() = %+v, want %+v", got, tt.want)
			}
			for i := range tt.want {
				if got[i] != tt.want[i] {
					t.Errorf("tripadvisorReviews()[%d] = %+v, want %+v", i, got[i], tt.want[i])
				}
			}
		})
	}
}

// TestActivities_Query_TripadvisorSync_CityResolution is the regression
// guard for the six-strings-one-city bug (Belgrade stored as Belgrade,
// Belgrade Waterfront, Stari Grad, Novi Beograd, Dorcol, Vozdovac — all
// Tripadvisor rows) that motivated resolveTripadvisorCity: Terra's own
// address field is neighbourhood-level, so the anchor's city must be
// resolved once via a.places.ReverseGeocodeCity (fakeGooglePlaces doubles
// as the placesClient fixture here, same as the Google sync tests) and
// applied to every venue the sweep upserts, rather than trusting Terra's
// per-venue value.
//
// Two candidates per case, deliberately given two DIFFERENT Terra cities
// ("Stari Grad" / "Novi Beograd") in the fixture: that's what proves the
// resolved city is shared across the whole sweep rather than merely passed
// through per venue.
//
// Calls syncTripadvisorIfNeeded directly rather than through Query (the
// same sanctioned exception googleDueRows' own tests use — see this file's
// package doc): configuring WithPlaces to exercise ReverseGeocodeCity would
// otherwise also arm Query's unrelated background Google discovery sync
// (syncGoogleIfNeeded doesn't gate on the request's categories), which
// races this test's own gp.geocodeCalls counter against waitForTripadvisorSync
// (a different WaitGroup) unless separately awaited too. Calling the
// Tripadvisor path directly sidesteps that entirely — the sweep it triggers
// is still backgrounded (see waitForTripadvisorSync below), but it's the
// only background sync in flight.
func TestActivities_Query_TripadvisorSync_CityResolution(t *testing.T) {
	tests := []struct {
		name           string
		withPlaces     bool
		geocodeCity    string
		geocodeCountry string
		geocodeErr     error
		wantCity       string
		wantCountry    string
	}{
		{
			name:           "places client configured resolves city from the anchor, overriding terra",
			withPlaces:     true,
			geocodeCity:    "Belgrade",
			geocodeCountry: "Serbia",
			wantCity:       "Belgrade",
			wantCountry:    "Serbia",
		},
		{
			name:        "no places client configured falls back to terra's per-venue value",
			withPlaces:  false,
			wantCity:    "", // set per-candidate below from the fixture
			wantCountry: "Serbia (Terra)",
		},
		{
			name:        "geocode failure degrades to terra's per-venue value",
			withPlaces:  true,
			geocodeErr:  errors.New("geocode 503"),
			wantCity:    "", // set per-candidate below from the fixture
			wantCountry: "Serbia (Terra)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
			ta := &fakeTripadvisor{
				nearbyOut: []tripadvisor.LocationSummary{
					{LocationID: "1", Name: "Restaurant One", WebURL: "https://ta/Restaurant_Review-1"},
					{LocationID: "2", Name: "Restaurant Two", WebURL: "https://ta/Restaurant_Review-2"},
				},
				detailsOut: map[string]tripadvisor.LocationDetails{
					"1": {LocationID: "1", Name: "Restaurant One", WebURL: "https://ta/Restaurant_Review-1", City: "Stari Grad", Country: "Serbia (Terra)"},
					"2": {LocationID: "2", Name: "Restaurant Two", WebURL: "https://ta/Restaurant_Review-2", City: "Novi Beograd", Country: "Serbia (Terra)"},
				},
			}
			gp := &fakeGooglePlaces{geocodeCity: tt.geocodeCity, geocodeCountry: tt.geocodeCountry, geocodeErr: tt.geocodeErr}
			svc := New(repo).WithTripadvisor(ta)
			if tt.withPlaces {
				svc = svc.WithPlaces(gp)
			}

			req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
			svc.syncTripadvisorIfNeeded(context.Background(), req)
			svc.waitForTripadvisorSync()

			if len(repo.gotUpserts) != 2 {
				t.Fatalf("upserts = %d, want 2", len(repo.gotUpserts))
			}
			wantByExternalID := map[string]string{"1": "Stari Grad", "2": "Novi Beograd"}
			for _, u := range repo.gotUpserts {
				wantCity := tt.wantCity
				if wantCity == "" {
					wantCity = wantByExternalID[u.ExternalID]
				}
				if u.City != wantCity || u.Country != tt.wantCountry {
					t.Errorf("upsert %s city/country = %q/%q, want %q/%q", u.ExternalID, u.City, u.Country, wantCity, tt.wantCountry)
				}
			}

			if tt.withPlaces && gp.geocodeCalls != 1 {
				t.Errorf("ReverseGeocodeCity calls = %d, want exactly 1 per sweep regardless of venue count", gp.geocodeCalls)
			}
			if !tt.withPlaces && gp.geocodeCalls != 0 {
				t.Errorf("ReverseGeocodeCity calls = %d, want 0 — no places client was configured", gp.geocodeCalls)
			}
		})
	}
}

// TestActivities_ResolveTripadvisorSubtype covers ResolveTripadvisorSubtype's
// "never a guess" outcomes plus its one success path, per T2's acceptance
// criteria, and (tripadvisor-google-review-fallback T1) that its second
// return value — the matched candidate's own Google place id — comes back
// non-empty exactly when identity was actually confirmed (a single hit whose
// name matches), including the one case where the subtype itself is empty
// despite a confirmed identity match (cross-category primaryType): the venue
// was still found and identified, so its place id is real, just unmapped to
// a subtype for this category. Every place fixture below carries a
// DisplayName that matches "Some Venue" (case/punctuation-folded) unless the
// case is specifically testing the name-identity guard, so the other
// rejections aren't accidentally exercising it too.
func TestActivities_ResolveTripadvisorSubtype(t *testing.T) {
	tests := []struct {
		name        string
		category    activitiessvc.Category
		venue       string // defaults to "Some Venue" below when empty
		price       string
		places      []placesmap.Place
		err         error
		want        string
		wantPlaceID string
	}{
		{
			name:        "primaryType maps to a valid subtype for its category",
			category:    activitiessvc.CategoryBars,
			places:      []placesmap.Place{{ID: "place-1", PrimaryType: "wine_bar", DisplayName: displayName("Some Venue")}},
			want:        "wine_bar",
			wantPlaceID: "place-1",
		},
		{
			// Mutation-tested (see review-log.md T2): hoisting the price check
			// above the Google-type check makes this return casual_dining
			// instead — this case exists to fail exactly that mutation.
			name:        "a Google type outranks price even when both resolve",
			category:    activitiessvc.CategoryRestaurants,
			price:       "Mid Range",
			places:      []placesmap.Place{{ID: "place-7", PrimaryType: "fast_food_restaurant", DisplayName: displayName("Some Venue")}},
			want:        "fast_casual",
			wantPlaceID: "place-7",
		},
		{
			// The load-bearing negative (design D5): Google's generic
			// "restaurant" type deliberately maps to nothing (placesmap never
			// classifies it), so this must fall through to the price layer —
			// and Cheap Eats there is also deliberately "".
			name:        "cheap eats plus an unmapped Google type still yields nothing",
			category:    activitiessvc.CategoryRestaurants,
			price:       "Cheap Eats",
			places:      []placesmap.Place{{ID: "place-8", PrimaryType: "restaurant", DisplayName: displayName("Some Venue")}},
			want:        "",
			wantPlaceID: "place-8",
		},
		{
			// namemap's override (kafana) must win even over a Google type
			// that would otherwise resolve, and price (irrelevant here since
			// SubtypeFromPriceLevel is Restaurants-only, but included to
			// mirror the mutation shape) must not intervene either.
			name:        "a namemap override outranks both the Google type and price",
			category:    activitiessvc.CategoryBars,
			venue:       "Kafana Zavicaj",
			price:       "Mid Range",
			places:      []placesmap.Place{{ID: "place-9", PrimaryType: "cocktail_bar", DisplayName: displayName("Kafana Zavicaj")}},
			want:        "kafana",
			wantPlaceID: "place-9",
		},
		{
			name:        "primaryType maps to a subtype belonging to a different category yields an empty subtype, not a cross-category guess, but the confirmed match's place id still comes back",
			category:    activitiessvc.CategoryBars,
			places:      []placesmap.Place{{ID: "place-2", PrimaryType: "fine_dining_restaurant", DisplayName: displayName("Some Venue")}},
			want:        "",
			wantPlaceID: "place-2",
		},
		{
			name:     "no candidate in the tight radius resolves empty",
			category: activitiessvc.CategoryRestaurants,
			places:   nil,
			want:     "",
		},
		{
			name:     "ambiguous match (more than one candidate) resolves empty rather than guessing",
			category: activitiessvc.CategoryRestaurants,
			places: []placesmap.Place{
				{ID: "place-3", PrimaryType: "fine_dining_restaurant", DisplayName: displayName("Some Venue")},
				{ID: "place-4", PrimaryType: "restaurant", DisplayName: displayName("Some Venue")},
			},
			want: "",
		},
		{
			name:     "a Places error resolves empty, never propagated to the caller",
			category: activitiessvc.CategoryRestaurants,
			err:      errors.New("places 500"),
			want:     "",
		},
		{
			name:     "sole candidate's name doesn't match the Tripadvisor venue's — a relevance-ranked neighbour, not the venue itself — resolves empty",
			category: activitiessvc.CategoryRestaurants,
			places:   []placesmap.Place{{ID: "place-5", PrimaryType: "fine_dining_restaurant", DisplayName: displayName("Completely Different Place")}},
			want:     "",
		},
		{
			name:        "sole candidate's name loosely matches (a business-suffix Google appended) resolves normally",
			category:    activitiessvc.CategoryRestaurants,
			places:      []placesmap.Place{{ID: "place-6", PrimaryType: "fine_dining_restaurant", DisplayName: displayName("Some Venue Restaurant")}},
			want:        "fine_dining",
			wantPlaceID: "place-6",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			venue := tt.venue
			if venue == "" {
				venue = "Some Venue"
			}
			gp := &fakeGooglePlaces{nearbyOut: tt.places, nearbyErr: tt.err}
			svc := New(&fakeRepo{}).WithPlaces(gp)
			got, gotPlaceID := svc.ResolveTripadvisorSubtype(context.Background(), tt.category, venue, 44.81, 20.46, "111", tt.price)
			if got != tt.want {
				t.Errorf("ResolveTripadvisorSubtype(...) subtype = %q, want %q", got, tt.want)
			}
			if gotPlaceID != tt.wantPlaceID {
				t.Errorf("ResolveTripadvisorSubtype(...) place id = %q, want %q", gotPlaceID, tt.wantPlaceID)
			}
			if len(gp.gotSearchTextInArea) == 0 {
				return
			}
			searchCall := gp.gotSearchTextInArea[0]
			if searchCall.lat != 44.81 || searchCall.lng != 20.46 || searchCall.radiusKM != tripadvisorSubtypeRadiusKM {
				t.Errorf("SearchTextInArea args = lat=%v lng=%v radiusKM=%v, want lat=44.81 lng=20.46 radiusKM=%v (the venue's own coords, not the sync anchor's)", searchCall.lat, searchCall.lng, searchCall.radiusKM, tripadvisorSubtypeRadiusKM)
			}
		})
	}
}

// TestActivities_ResolveTripadvisorSubtype_NoClientConfigured proves the
// nil-safe degrade — no Places client attached must never panic or block.
func TestActivities_ResolveTripadvisorSubtype_NoClientConfigured(t *testing.T) {
	svc := New(&fakeRepo{})
	got, gotPlaceID := svc.ResolveTripadvisorSubtype(context.Background(), activitiessvc.CategoryRestaurants, "x", 0, 0, "111", "")
	if got != "" || gotPlaceID != "" {
		t.Errorf("ResolveTripadvisorSubtype() = (%q, %q), want empty subtype and place id with no places client configured", got, gotPlaceID)
	}
}

// TestActivities_ResolveTripadvisorSubtype_NoCoordsOrName proves the
// coordinate/name guard skips the Places call entirely — no venue is ever
// searchable at lat=0,lng=0 or by an empty name, so paying for the call
// would be pure waste (or, for an empty textQuery, a guaranteed 400).
func TestActivities_ResolveTripadvisorSubtype_NoCoordsOrName(t *testing.T) {
	tests := []struct {
		name string
		lat  float64
		lng  float64
	}{
		{name: "", lat: 44.81, lng: 20.46},
		{name: "Some Venue", lat: 0, lng: 0},
	}
	for _, tt := range tests {
		gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{{ID: "place-1", PrimaryType: "wine_bar", DisplayName: displayName(tt.name)}}}
		svc := New(&fakeRepo{}).WithPlaces(gp)
		got, gotPlaceID := svc.ResolveTripadvisorSubtype(context.Background(), activitiessvc.CategoryBars, tt.name, tt.lat, tt.lng, "111", "")
		if got != "" || gotPlaceID != "" {
			t.Errorf("ResolveTripadvisorSubtype(name=%q, lat=%v, lng=%v) = (%q, %q), want empty subtype and place id", tt.name, tt.lat, tt.lng, got, gotPlaceID)
		}
		if len(gp.gotSearchTextInArea) != 0 {
			t.Errorf("SearchTextInArea calls = %d, want 0 — no name or no coords must skip the Places call", len(gp.gotSearchTextInArea))
		}
	}
}

// TestVenueNameMatches covers the identity guard directly — the fold,
// exact-match, containment, and short-string-false-positive-guard cases —
// without needing a full ResolveTripadvisorSubtype fixture per case.
func TestVenueNameMatches(t *testing.T) {
	tests := []struct {
		name            string
		tripadvisorName string
		candidateName   string
		want            bool
	}{
		{name: "exact match", tripadvisorName: "Ambar Beograd", candidateName: "Ambar Beograd", want: true},
		{name: "case/punctuation-insensitive exact match", tripadvisorName: "Ambar, Beograd!", candidateName: "ambar beograd", want: true},
		{name: "candidate has an added business suffix", tripadvisorName: "Ambar", candidateName: "Ambar Restaurant", want: true},
		{name: "tripadvisor name has an added suffix", tripadvisorName: "Ambar Restaurant", candidateName: "Ambar", want: true},
		{name: "unrelated venue names", tripadvisorName: "Ambar Beograd", candidateName: "Little Bay", want: false},
		{name: "short folded name does not false-positive via containment", tripadvisorName: "A", candidateName: "A Very Different Venue Entirely", want: false},
		{name: "empty candidate name never matches", tripadvisorName: "Ambar Beograd", candidateName: "", want: false},
		{name: "generic 3-letter venue name does not false-positive via containment", tripadvisorName: "Bar", candidateName: "Sky Bar", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := venueNameMatches(tt.tripadvisorName, tt.candidateName); got != tt.want {
				t.Errorf("venueNameMatches(%q, %q) = %v, want %v", tt.tripadvisorName, tt.candidateName, got, tt.want)
			}
		})
	}
}

// displayName builds a placesmap.Place's anonymous DisplayName field —
// Place declares it inline (no named type to construct directly), so tests
// that need to set it go through this helper instead of repeating the
// struct literal shape everywhere.
func displayName(text string) struct {
	Text string `json:"text"`
} {
	return struct {
		Text string `json:"text"`
	}{Text: text}
}

// TestActivities_Query_TripadvisorSync_SubtypeResolvedFromGooglePlaceType is
// the end-to-end proof that a resolved Google primaryType reaches the
// upserted row's Subcategory through the real sync path, not just the
// ResolveTripadvisorSubtype unit above — and (tripadvisor-google-review-fallback
// T1) that the matched place id reaches GooglePlaceID alongside it.
func TestActivities_Query_TripadvisorSync_SubtypeResolvedFromGooglePlaceType(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111", Name: "Ambar Beograd", WebURL: "https://ta/Restaurant_Review-1"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Ambar Beograd", Lat: 44.81, Lng: 20.46, WebURL: "https://ta/Restaurant_Review-1"},
		},
	}
	gp := &fakeGooglePlaces{nearbyOut: []placesmap.Place{{ID: "google-place-1", PrimaryType: "fine_dining_restaurant", DisplayName: displayName("Ambar Beograd")}}}
	svc := New(repo).WithTripadvisor(ta).WithPlaces(gp)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	svc.syncTripadvisorIfNeeded(context.Background(), req)
	svc.waitForTripadvisorSync()

	if repo.gotUpsert.Subcategory != "fine_dining" {
		t.Errorf("gotUpsert.Subcategory = %q, want fine_dining (resolved via the Places lookup)", repo.gotUpsert.Subcategory)
	}
	if repo.gotUpsert.GooglePlaceID != "google-place-1" {
		t.Errorf("gotUpsert.GooglePlaceID = %q, want google-place-1 (the same Places hit the subtype was resolved from)", repo.gotUpsert.GooglePlaceID)
	}
}

// TestActivities_Query_TripadvisorSync_PlacesErrorStillIngestsVenue proves a
// subtype resolve failure never fails the whole sync or skips the venue —
// it's stored with an empty subtype instead.
func TestActivities_Query_TripadvisorSync_PlacesErrorStillIngestsVenue(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111", Name: "Ambar Beograd", WebURL: "https://ta/Restaurant_Review-1"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Ambar Beograd", WebURL: "https://ta/Restaurant_Review-1"},
		},
	}
	gp := &fakeGooglePlaces{nearbyErr: errors.New("places 500")}
	svc := New(repo).WithTripadvisor(ta).WithPlaces(gp)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	svc.syncTripadvisorIfNeeded(context.Background(), req)
	svc.waitForTripadvisorSync()

	if repo.upsertCalls != 1 {
		t.Errorf("Upsert calls = %d, want 1 — a Places resolve error must not skip ingesting the venue", repo.upsertCalls)
	}
	if repo.gotUpsert.Subcategory != "" {
		t.Errorf("gotUpsert.Subcategory = %q, want empty on a Places resolve error", repo.gotUpsert.Subcategory)
	}
	if repo.gotUpsert.GooglePlaceID != "" {
		t.Errorf("gotUpsert.GooglePlaceID = %q, want empty on a Places resolve error", repo.gotUpsert.GooglePlaceID)
	}
}
