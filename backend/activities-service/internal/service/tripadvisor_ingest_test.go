package service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"activities-service/internal/tripadvisor"

	"backend/shared/models/activitiessvc"
)

func TestRankingText(t *testing.T) {
	tests := []struct {
		name     string
		rankings []tripadvisor.Ranking
		want     string
	}{
		{"no rankings returns empty, never invented", nil, ""},
		{"ranking present but display_text empty returns empty", []tripadvisor.Ranking{{Rank: 12, Total: 1780}}, ""},
		{
			"display_text without a date gets the dated suffix appended",
			[]tripadvisor.Ranking{{DisplayText: "#12 of 1,780 Restaurants in Belgrade"}},
			"#12 of 1,780 Restaurants in Belgrade, as rated by Tripadvisor travelers as of " + time.Now().Format("January 2006"),
		},
		{
			"display_text already carrying a date is passed through unchanged",
			[]tripadvisor.Ranking{{DisplayText: "#12 of 1,780 Restaurants in Belgrade as of July 2026"}},
			"#12 of 1,780 Restaurants in Belgrade as of July 2026",
		},
		{
			"only the first ranking entry is used",
			[]tripadvisor.Ranking{{DisplayText: "#12 of 1,780 Restaurants in Belgrade"}, {DisplayText: "#3 of 90 Steakhouses in Belgrade"}},
			"#12 of 1,780 Restaurants in Belgrade, as rated by Tripadvisor travelers as of " + time.Now().Format("January 2006"),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rankingText(tt.rankings); got != tt.want {
				t.Errorf("rankingText(%+v) = %q, want %q", tt.rankings, got, tt.want)
			}
		})
	}
}

func TestToAspectRating(t *testing.T) {
	if got := toAspectRating(nil); got != nil {
		t.Errorf("toAspectRating(nil) = %+v, want nil", got)
	}
	got := toAspectRating(&tripadvisor.Aspect{Rating: 4.5, IconURL: "https://ta/food.svg"})
	want := &activitiessvc.TripadvisorAspectRating{Rating: 4.5, IconURL: "https://ta/food.svg"}
	if got == nil || *got != *want {
		t.Errorf("toAspectRating(...) = %+v, want %+v", got, want)
	}
}

// TestTripadvisorIngestActivity_AbsentOptionalFieldsStayAbsent proves the
// "never a fabricated value" contract for every optional Tripadvisor field
// this task added: a LocationDetails with none of them set must produce an
// attribution block with all of them nil/empty, not zero-valued structs.
func TestTripadvisorIngestActivity_AbsentOptionalFieldsStayAbsent(t *testing.T) {
	d := tripadvisor.LocationDetails{LocationID: "1", Name: "Bare Bones", WebURL: "https://ta/1"}

	ingest := tripadvisorIngestActivity(activitiessvc.CategoryRestaurants, "", d, nil, nil, cellLocation{})

	var details activitiessvc.RestaurantDetails
	if err := json.Unmarshal(ingest.Details, &details); err != nil {
		t.Fatalf("unmarshaling details: %v", err)
	}
	if details.Tripadvisor == nil {
		t.Fatal("Tripadvisor attribution = nil, want a populated (but mostly empty) block")
	}
	if details.Tripadvisor.RankingText != "" {
		t.Errorf("RankingText = %q, want empty (no rankings supplied)", details.Tripadvisor.RankingText)
	}
	if details.Tripadvisor.Award != nil {
		t.Errorf("Award = %+v, want nil (no award supplied)", details.Tripadvisor.Award)
	}
	if details.Tripadvisor.PriceLevel != "" {
		t.Errorf("PriceLevel = %q, want empty", details.Tripadvisor.PriceLevel)
	}
	if details.Tripadvisor.Cuisine != "" {
		t.Errorf("Cuisine = %q, want empty (no categories supplied)", details.Tripadvisor.Cuisine)
	}
	if details.Tripadvisor.Subratings != nil {
		t.Errorf("Subratings = %+v, want nil (no subratings supplied)", details.Tripadvisor.Subratings)
	}
	if ingest.Subcategory != "" {
		t.Errorf("Subcategory = %q, want empty (caller passed no resolved subtype)", ingest.Subcategory)
	}
	if ingest.Description != "" {
		t.Errorf("Description = %q, want empty (no description supplied)", ingest.Description)
	}
	if details.Tripadvisor.Attributes != nil {
		t.Errorf("Attributes = %+v, want nil (none supplied)", details.Tripadvisor.Attributes)
	}
	if details.Tripadvisor.RecommendedVisitLength != 0 {
		t.Errorf("RecommendedVisitLength = %d, want 0 (none supplied)", details.Tripadvisor.RecommendedVisitLength)
	}
}

// TestTripadvisorIngestActivity_DescriptionAttributesVisitLengthCarried
// proves the three newly-decoded fields actually reach the ingested
// activity/attribution block, not just the tripadvisor.LocationDetails
// struct they're decoded into.
func TestTripadvisorIngestActivity_DescriptionAttributesVisitLengthCarried(t *testing.T) {
	d := tripadvisor.LocationDetails{
		LocationID:             "1",
		Name:                   "Mosaic Restaurant",
		WebURL:                 "https://ta/1",
		Description:            "Here, at the heart of the city, food is prepared heartily.",
		Attributes:             []string{"Free Wi-Fi", "Outdoor Seating"},
		RecommendedVisitLength: 2,
	}

	ingest := tripadvisorIngestActivity(activitiessvc.CategoryRestaurants, "fine_dining", d, nil, nil, cellLocation{})

	if ingest.Subcategory != "fine_dining" {
		t.Errorf("Subcategory = %q, want the caller-resolved subtype carried straight through", ingest.Subcategory)
	}
	if ingest.Description != d.Description {
		t.Errorf("Description = %q, want %q", ingest.Description, d.Description)
	}

	var details activitiessvc.RestaurantDetails
	if err := json.Unmarshal(ingest.Details, &details); err != nil {
		t.Fatalf("unmarshaling details: %v", err)
	}
	if details.Tripadvisor == nil {
		t.Fatal("Tripadvisor attribution = nil, want a populated block")
	}
	if !reflect.DeepEqual(details.Tripadvisor.Attributes, d.Attributes) {
		t.Errorf("Attributes = %+v, want %+v", details.Tripadvisor.Attributes, d.Attributes)
	}
	if details.Tripadvisor.RecommendedVisitLength != d.RecommendedVisitLength {
		t.Errorf("RecommendedVisitLength = %d, want %d", details.Tripadvisor.RecommendedVisitLength, d.RecommendedVisitLength)
	}
}

// TestActivities_RefreshTripadvisorLocation_Success proves the
// direct-by-ID path (no NearbySearch discovery) resolves and upserts one
// location — the mechanism cmd/backfilltripadvisor relies on.
func TestActivities_RefreshTripadvisorLocation_Success(t *testing.T) {
	repo := &fakeRepo{}
	ta := &fakeTripadvisor{
		detailsOut: map[string]tripadvisor.LocationDetails{
			"7678207": {LocationID: "7678207", Name: "Mosaic Restaurant", WebURL: "https://ta/7678207", Description: "Here, at the heart of the city, food is prepared heartily."},
		},
		// Set to prove it's never even read (see below) — a real caller
		// would leave this unset since RefreshTripadvisorLocation never
		// calls LocationPhotos at all.
		photosOut: []activitiessvc.Photo{{URL: "https://ta/photo.jpg"}},
	}
	svc := New(repo).WithTripadvisor(ta)

	if err := svc.RefreshTripadvisorLocation(context.Background(), activitiessvc.CategoryRestaurants, "7678207"); err != nil {
		t.Fatalf("RefreshTripadvisorLocation: %v", err)
	}
	if repo.upsertCalls != 1 {
		t.Fatalf("Upsert calls = %d, want 1", repo.upsertCalls)
	}
	if repo.gotUpsert.Description != "Here, at the heart of the city, food is prepared heartily." {
		t.Errorf("Description = %q, want the fetched description carried through", repo.gotUpsert.Description)
	}
	if repo.gotUpsert.Category != activitiessvc.CategoryRestaurants {
		t.Errorf("Category = %q, want %q", repo.gotUpsert.Category, activitiessvc.CategoryRestaurants)
	}
	if repo.gotUpsert.ExternalID != "7678207" {
		t.Errorf("ExternalID = %q, want %q", repo.gotUpsert.ExternalID, "7678207")
	}
	if ta.photosCalls != 0 {
		t.Errorf("photosCalls = %d, want 0 — refreshing an already-stored row must never fetch a photo Upsert would just discard", ta.photosCalls)
	}
}

// TestActivities_RefreshTripadvisorLocation_DetailsErrorNeverUpserts proves
// a failed live fetch never reaches Upsert — no partial/stale write.
func TestActivities_RefreshTripadvisorLocation_DetailsErrorNeverUpserts(t *testing.T) {
	repo := &fakeRepo{}
	ta := &fakeTripadvisor{detailsErrs: map[string]error{"1": errors.New("terra 500")}}
	svc := New(repo).WithTripadvisor(ta)

	err := svc.RefreshTripadvisorLocation(context.Background(), activitiessvc.CategoryRestaurants, "1")
	if err == nil {
		t.Fatal("RefreshTripadvisorLocation: want error, got nil")
	}
	if repo.upsertCalls != 0 {
		t.Errorf("Upsert calls = %d, want 0 — a failed details fetch must never upsert", repo.upsertCalls)
	}
}

// TestActivities_RefreshTripadvisorLocation_NoClientConfiguredErrors proves
// the method fails loudly (not a silent no-op) when no Tripadvisor client
// is attached — unlike the request-serving paths (GetPhotos, live-merge),
// which nil-safely fall back to stored data, this is a standalone backfill
// operation with nothing sensible to fall back to.
func TestActivities_RefreshTripadvisorLocation_NoClientConfiguredErrors(t *testing.T) {
	svc := New(&fakeRepo{})
	if err := svc.RefreshTripadvisorLocation(context.Background(), activitiessvc.CategoryRestaurants, "1"); err == nil {
		t.Fatal("RefreshTripadvisorLocation: want error with no tripadvisor client configured, got nil")
	}
}

// TestActivities_RefreshTripadvisorLocation_NeverFetchesAPhoto proves
// RefreshTripadvisorLocation skips LocationPhotos entirely — unlike
// syncTripadvisorAnchor's discovery sweep (which needs one on first
// insert), every row this method touches is already stored, and Upsert's
// ON CONFLICT ... DO UPDATE never writes the photos column, so a live
// photo call here would be resolved and then silently discarded. Even a
// LocationPhotos failure (which the sweep tolerates, logged) must have no
// bearing here since the call never happens.
func TestActivities_RefreshTripadvisorLocation_NeverFetchesAPhoto(t *testing.T) {
	repo := &fakeRepo{}
	ta := &fakeTripadvisor{
		detailsOut: map[string]tripadvisor.LocationDetails{"1": {LocationID: "1", Name: "Bare Bones", WebURL: "https://ta/1"}},
		photosErr:  errors.New("terra photos 500"),
	}
	svc := New(repo).WithTripadvisor(ta)

	if err := svc.RefreshTripadvisorLocation(context.Background(), activitiessvc.CategoryRestaurants, "1"); err != nil {
		t.Fatalf("RefreshTripadvisorLocation: %v, want nil", err)
	}
	if repo.upsertCalls != 1 {
		t.Errorf("Upsert calls = %d, want 1", repo.upsertCalls)
	}
	if ta.photosCalls != 0 {
		t.Errorf("photosCalls = %d, want 0", ta.photosCalls)
	}
}
