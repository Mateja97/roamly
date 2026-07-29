package service

import (
	"context"
	"encoding/json"
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
				WebURL: "https://ta/1", RatingImageURL: "https://ta/img/4.5.svg", ReviewCount: 1204,
				RankingString: "#12 of 1,780 Restaurants in Belgrade",
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
	if repo.upsertCalls != 1 {
		t.Errorf("Upsert calls = %d, want 1", repo.upsertCalls)
	}
	if repo.gotUpsert.Source != "tripadvisor" || repo.gotUpsert.ExternalID != "111" || repo.gotUpsert.Status != activitiessvc.StatusPublished {
		t.Errorf("Upsert input = %+v, want Source=tripadvisor ExternalID=111 Status=published", repo.gotUpsert)
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
	wantRanking := "#12 of 1,780 Restaurants in Belgrade, as rated by Tripadvisor travelers as of " + time.Now().Format("January 2006")
	if details.Tripadvisor.WebURL != "https://ta/1" || details.Tripadvisor.RatingImageURL != "https://ta/img/4.5.svg" ||
		details.Tripadvisor.ReviewCount != 1204 || details.Tripadvisor.RankingText != wantRanking {
		t.Errorf("details.Tripadvisor = %+v, want WebURL/RatingImageURL/ReviewCount matching the fixture and RankingText = %q", details.Tripadvisor, wantRanking)
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

func TestActivities_Query_TripadvisorSync_UnfilteredQuerySyncsBothCategories(t *testing.T) {
	repo := &fakeRepo{syncedAtOut: map[string]time.Time{}}
	ta := &fakeTripadvisor{}
	svc := New(repo).WithTripadvisor(ta)

	req := Request{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46}} // no Categories = "All"
	if _, err := svc.Query(context.Background(), req); err != nil {
		t.Fatalf("Query() error: %v", err)
	}
	if ta.nearbyCalls != 2 {
		t.Errorf("NearbySearch calls = %d, want 2 (restaurants + bars, unfiltered query)", ta.nearbyCalls)
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
			"good": {LocationID: "good", Name: "Fine Place", Rating: 4.0, WebURL: "https://ta/good"},
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

func TestFeaturedReview_OnlyForRatingAtLeast4WithA5BubbleReview(t *testing.T) {
	tests := []struct {
		name    string
		rating  float64
		reviews []tripadvisor.Review
		want    *activitiessvc.TripadvisorReview
	}{
		{"below 4.0 never calls reviews", 3.5, []tripadvisor.Review{{Rating: 5, Date: "2026-01-01", Text: "x"}}, nil},
		{"4.0 with a 5-bubble review", 4.0, []tripadvisor.Review{{Rating: 4, Date: "2026-01-01", Text: "ok"}, {Rating: 5, Date: "2026-02-02", Text: "great"}}, &activitiessvc.TripadvisorReview{Rating: 5, Date: "2026-02-02", Text: "great"}},
		{"rated high but no 5-bubble review", 4.8, []tripadvisor.Review{{Rating: 4, Date: "2026-01-01", Text: "ok"}}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			ta := &fakeTripadvisor{reviewsOut: map[string][]tripadvisor.Review{"x": tt.reviews}}
			svc := New(repo).WithTripadvisor(ta)

			got := svc.featuredReview(context.Background(), tripadvisor.LocationDetails{LocationID: "x", Rating: tt.rating})
			if (got == nil) != (tt.want == nil) {
				t.Fatalf("featuredReview() = %v, want %v", got, tt.want)
			}
			if got != nil && *got != *tt.want {
				t.Errorf("featuredReview() = %+v, want %+v", *got, *tt.want)
			}
		})
	}
}
