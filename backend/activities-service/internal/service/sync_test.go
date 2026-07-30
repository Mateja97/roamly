package service

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"activities-service/internal/tripadvisor"

	"backend/shared/models/activitiessvc"
)

func TestActivities_Query_TripadvisorSync_TriggersWhenAreaNeverSynced(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111", Name: "Ambar Beograd"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {
				LocationID: "111", Name: "Ambar Beograd", Lat: 44.81, Lng: 20.46, Rating: 4.5,
				City: "Belgrade", Country: "Serbia", Phone: "+381 11 328 6637",
				WebURL: "https://ta/1", RatingImageURL: "https://ta/img/4.5.svg", ReviewCount: 1204,
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

	var details activitiessvc.RestaurantDetails
	if err := json.Unmarshal(repo.gotUpsert.Details, &details); err != nil {
		t.Fatalf("unmarshaling upserted details: %v", err)
	}
	if details.Tripadvisor == nil {
		t.Fatal("details.Tripadvisor = nil, want the attribution block populated")
	}
	wantRankingText := "#12 of 1,780 Restaurants in Belgrade, as rated by Tripadvisor travelers as of " + time.Now().Format("January 2006")
	if details.Tripadvisor.WebURL != "https://ta/1" || details.Tripadvisor.RatingImageURL != "https://ta/img/4.5.svg" ||
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
	if repo.gotUpsert.Subcategory != "fine_dining" {
		t.Errorf("gotUpsert.Subcategory = %q, want fine_dining (mapped from categories[]'s hierarchy)", repo.gotUpsert.Subcategory)
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

func TestActivities_Query_TripadvisorSync_UnfilteredQuerySyncsBothCategoriesWithOneSearch(t *testing.T) {
	// Restaurants and Bars are both due for the one anchor here. Terra has no
	// bars-specific category, so a NearbySearch(RESTAURANT) covers both — the
	// fix under test is that this now costs exactly one NearbySearch call
	// (not one per due category) fanned out into one Upsert per category, so
	// the two categories' rows don't collide on (source_url, category).
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Ambar Beograd", WebURL: "https://ta/1", PriceLevel: "Mid Range"},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}} // no Categories = "All"
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	if ta.nearbyCalls != 1 {
		t.Errorf("NearbySearch calls = %d, want 1 (restaurants + bars share one search, unfiltered query)", ta.nearbyCalls)
	}
	if repo.upsertCalls != 2 {
		t.Errorf("Upsert calls = %d, want 2 (one per due category for the one candidate)", repo.upsertCalls)
	}
}

func TestActivities_Query_TripadvisorSync_BothCategoriesDueShareOneSearchButUpsertSeparately(t *testing.T) {
	// The core bug fix: before, a Restaurants sync and a Bars sync for the
	// same anchor each ran their own NearbySearch and their own Upsert
	// keyed only on source_url, so the second upsert clobbered the first's
	// category. Now one NearbySearch serves both due categories and each
	// gets its own Upsert call, so both rows survive with the same
	// ExternalID/SourceURL but a different Category.
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{
		nearbyOut: []tripadvisor.LocationSummary{{LocationID: "111"}},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"111": {LocationID: "111", Name: "Ambar Beograd", WebURL: "https://ta/1", PriceLevel: "Mid Range"},
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

	if ta.nearbyCalls != 1 {
		t.Errorf("NearbySearch calls = %d, want 1", ta.nearbyCalls)
	}
	if len(repo.gotUpserts) != 2 {
		t.Fatalf("Upsert calls = %d, want 2", len(repo.gotUpserts))
	}

	first, second := repo.gotUpserts[0], repo.gotUpserts[1]
	if first.ExternalID != second.ExternalID || first.ExternalID != "111" {
		t.Errorf("ExternalID mismatch: %q, %q, want both = 111", first.ExternalID, second.ExternalID)
	}
	if first.SourceURL != second.SourceURL || first.SourceURL != "https://ta/1" {
		t.Errorf("SourceURL mismatch: %q, %q, want both = https://ta/1", first.SourceURL, second.SourceURL)
	}
	if first.Category == second.Category {
		t.Errorf("Category = %q for both upserts, want one Restaurants and one Bars", first.Category)
	}
	gotCategories := map[activitiessvc.Category]bool{first.Category: true, second.Category: true}
	if !gotCategories[activitiessvc.CategoryRestaurants] || !gotCategories[activitiessvc.CategoryBars] {
		t.Errorf("categories = %v, want exactly {restaurants, bars}", gotCategories)
	}
	if len(repo.markSynced) != 2 {
		t.Errorf("markSynced calls = %d, want 2 (one per due category, not per candidate)", len(repo.markSynced))
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
		nearbyOut:   []tripadvisor.LocationSummary{{LocationID: "bad"}, {LocationID: "good"}},
		detailsErrs: map[string]error{"bad": context.DeadlineExceeded},
		detailsOut: map[string]tripadvisor.LocationDetails{
			"good": {LocationID: "good", Name: "Fine Place", Rating: 4.0, WebURL: "https://ta/good", PriceLevel: "Mid Range"},
		},
	}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}, Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants}}
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
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
