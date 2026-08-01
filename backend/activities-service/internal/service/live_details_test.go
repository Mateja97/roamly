package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"activities-service/internal/placesmap"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
)

// TestActivities_GetByID_NeverLiveMerges is the regression the review round
// 1 finding named directly: GetByID (used by the admin GetActivity RPC and
// every other internal read) must never make a live Places call or merge
// live data, even for a Places-sourced row with everything configured to
// make GetByIDWithLiveDetails's live path fire — an admin edit form
// round-trips whatever GetByID returns straight back into a PATCH, so a
// live merge here would re-persist Places content T4's migration exists to
// keep out of the DB.
func TestActivities_GetByID_NeverLiveMerges(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryCafes, City: "Belgrade",
		Source: "google_places", ExternalID: "place-1", Description: "", Rating: 4.2,
	}
	places := &fakePlaces{detailOut: placesmap.PlaceDetail{Rating: 4.9}}
	repo := &fakeRepo{getOut: stored}
	svc := New(repo).WithPlaces(places)

	got, err := svc.GetByID(context.Background(), "1")
	if err != nil {
		t.Fatalf("GetByID() unexpected error: %v", err)
	}
	if places.detailCalls != 0 {
		t.Errorf("places.PlaceDetails calls = %d, want 0 — GetByID must never make a live call", places.detailCalls)
	}
	// Activity contains slice fields (Photos, GoogleReviews, ...), not
	// comparable with == — check the fields a live merge would have
	// touched instead of the whole struct.
	if got.Description != stored.Description || got.Rating != stored.Rating ||
		string(got.Details) != string(stored.Details) || len(got.GoogleReviews) != 0 {
		t.Errorf("GetByID() = %+v, want the bare stored row %+v unchanged", got, stored)
	}
}

// TestActivities_GetByID_LiveDetails covers GetByIDWithLiveDetails' (T2,
// places-live-details) fallback-on-error contract: an unconfigured places
// client, a PlaceDetails error, and a timeout must all fall back to the
// bare stored row with no error surfaced; success must merge
// Details/Description/Rating/ReviewCount/GoogleReviews. Every case also
// asserts the live result is never persisted (repo.updateCalls stays 0) —
// the one deliberate deviation from GetPhotos' otherwise-identical pattern.
func TestActivities_GetByID_LiveDetails(t *testing.T) {
	cafe := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryCafes, City: "Belgrade", Country: "Serbia",
		Status: activitiessvc.StatusPublished, Source: "google_places", ExternalID: "place-1",
	}

	review := placesmap.Review{
		AuthorAttribution: placesmap.AuthorAttribution{
			DisplayName: "Ana", PhotoURI: "https://example.com/ana.jpg", URI: "https://maps.google.com/ana",
		},
		Rating:      5,
		PublishTime: "2026-06-01T00:00:00Z",
	}
	review.Text.Text = "Lovely spot."
	detail := placesmap.PlaceDetail{Reviews: []placesmap.Review{review}, ServesCoffee: true, Rating: 4.7, UserRatingCount: 214}
	detail.EditorialSummary.Text = "A cozy cafe with great coffee."
	wantDetailsJSON := string(placesmap.BuildLiveDetails(activitiessvc.CategoryCafes, "Serbia", detail))

	tests := []struct {
		name            string
		activity        activitiessvc.Activity
		places          *fakePlaces
		noPlaces        bool
		useShortCtx     bool
		wantPlaceCalls  int
		wantDescription string
		wantDetailsJSON string
		wantReviews     int
		wantRating      float64
		wantReviewCount int
	}{
		{
			name:     "unconfigured places client falls back to bare row",
			activity: cafe,
			noPlaces: true,
		},
		{
			name:           "places error falls back to bare row, no error surfaced",
			activity:       cafe,
			places:         &fakePlaces{detailErr: errors.New("places is down")},
			wantPlaceCalls: 1,
		},
		{
			name:           "timeout falls back to bare row",
			activity:       cafe,
			places:         &fakePlaces{detailBlock: true},
			useShortCtx:    true,
			wantPlaceCalls: 1,
		},
		{
			name:            "success merges details, description, rating, review count, reviews",
			activity:        cafe,
			places:          &fakePlaces{detailOut: detail},
			wantPlaceCalls:  1,
			wantDescription: "A cozy cafe with great coffee.",
			wantDetailsJSON: wantDetailsJSON,
			wantReviews:     1,
			wantRating:      4.7,
			wantReviewCount: 214,
		},
		{
			name: "zero live rating leaves stored rating and review count untouched",
			activity: activitiessvc.Activity{
				ID: "5", Category: activitiessvc.CategoryCafes, City: "Belgrade",
				Status: activitiessvc.StatusPublished, Source: "google_places", ExternalID: "place-5", Rating: 4.2, ReviewCount: 87,
			},
			// Details is still replaced (the Rating guard only covers
			// Rating/ReviewCount) — a zero-value PlaceDetail maps to "{}"
			// for Cafes (no amenities, no hours).
			places:          &fakePlaces{detailOut: placesmap.PlaceDetail{Rating: 0, UserRatingCount: 0}},
			wantPlaceCalls:  1,
			wantDetailsJSON: "{}",
			wantRating:      4.2,
			wantReviewCount: 87,
		},
		{
			name:     "tripadvisor source never calls places",
			activity: activitiessvc.Activity{ID: "2", Category: activitiessvc.CategoryRestaurants, Status: activitiessvc.StatusPublished, Source: "tripadvisor", ExternalID: "loc-1"},
			places:   &fakePlaces{detailOut: detail},
		},
		{
			name:     "admin-created (empty source) row never calls places",
			activity: activitiessvc.Activity{ID: "3", Category: activitiessvc.CategoryNature, Status: activitiessvc.StatusPublished, Source: "", ExternalID: "place-3"},
			places:   &fakePlaces{detailOut: detail},
		},
		{
			name:     "no external_id never calls places",
			activity: activitiessvc.Activity{ID: "4", Category: activitiessvc.CategoryCafes, Status: activitiessvc.StatusPublished, Source: "google_places", ExternalID: ""},
			places:   &fakePlaces{detailOut: detail},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{getOut: tt.activity}
			svc := New(repo)
			if !tt.noPlaces {
				svc = svc.WithPlaces(tt.places)
			}

			ctx := context.Background()
			if tt.useShortCtx {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 10*time.Millisecond)
				defer cancel()
			}

			got, err := svc.GetByIDWithLiveDetails(ctx, tt.activity.ID)
			if err != nil {
				t.Fatalf("GetByIDWithLiveDetails() unexpected error: %v", err)
			}

			if !tt.noPlaces && tt.places.detailCalls != tt.wantPlaceCalls {
				t.Errorf("places.PlaceDetails calls = %d, want %d", tt.places.detailCalls, tt.wantPlaceCalls)
			}
			if got.Description != tt.wantDescription {
				t.Errorf("Description = %q, want %q", got.Description, tt.wantDescription)
			}
			if string(got.Details) != tt.wantDetailsJSON {
				t.Errorf("Details = %s, want %s", got.Details, tt.wantDetailsJSON)
			}
			if len(got.GoogleReviews) != tt.wantReviews {
				t.Errorf("GoogleReviews len = %d, want %d", len(got.GoogleReviews), tt.wantReviews)
			}
			if got.Rating != tt.wantRating {
				t.Errorf("Rating = %v, want %v", got.Rating, tt.wantRating)
			}
			if got.ReviewCount != tt.wantReviewCount {
				t.Errorf("ReviewCount = %v, want %v", got.ReviewCount, tt.wantReviewCount)
			}
			if repo.updateCalls != 0 {
				t.Errorf("repo.Update called %d times, want 0 — the live-merged result must never be persisted", repo.updateCalls)
			}
		})
	}
}

// TestActivities_GetByID_LiveDetails_ReviewMapping asserts toGoogleReviews'
// field-for-field mapping precisely, separate from the table above (which
// only checks the count).
func TestActivities_GetByID_LiveDetails_ReviewMapping(t *testing.T) {
	review := placesmap.Review{
		AuthorAttribution: placesmap.AuthorAttribution{
			DisplayName: "Ana", PhotoURI: "https://example.com/ana.jpg", URI: "https://maps.google.com/ana",
		},
		Rating:      5,
		PublishTime: "2026-06-01T00:00:00Z",
	}
	review.Text.Text = "Lovely spot."
	detail := placesmap.PlaceDetail{Reviews: []placesmap.Review{review}}

	activity := activitiessvc.Activity{ID: "1", Category: activitiessvc.CategoryCafes, Status: activitiessvc.StatusPublished, Source: "google_places", ExternalID: "place-1"}
	repo := &fakeRepo{getOut: activity}
	svc := New(repo).WithPlaces(&fakePlaces{detailOut: detail})

	got, err := svc.GetByIDWithLiveDetails(context.Background(), "1")
	if err != nil {
		t.Fatalf("GetByIDWithLiveDetails() unexpected error: %v", err)
	}
	if len(got.GoogleReviews) != 1 {
		t.Fatalf("GoogleReviews = %+v, want 1 entry", got.GoogleReviews)
	}
	want := activitiessvc.GoogleReview{
		AuthorAttribution: activitiessvc.GoogleAuthorAttribution{
			DisplayName: "Ana", PhotoURI: "https://example.com/ana.jpg", URI: "https://maps.google.com/ana",
		},
		Rating:      5,
		Text:        "Lovely spot.",
		PublishTime: "2026-06-01T00:00:00Z",
	}
	if got.GoogleReviews[0] != want {
		t.Errorf("GoogleReviews[0] = %+v, want %+v", got.GoogleReviews[0], want)
	}
}

// TestActivities_GetByIDWithLiveDetails_UnpublishedNotFound is the T3
// review-round-1 regression: the public detail-page path must never serve
// a draft/pending row (QueryActivities' own published-only invariant,
// activitiessvc.Activity's doc: "draft/pending rows exist for the admin
// surface but never reach the app") or spend a billed Places call resolving
// one nobody should be able to see yet.
func TestActivities_GetByIDWithLiveDetails_UnpublishedNotFound(t *testing.T) {
	for _, status := range []activitiessvc.Status{activitiessvc.StatusDraft, activitiessvc.StatusPending} {
		t.Run(string(status), func(t *testing.T) {
			stored := activitiessvc.Activity{
				ID: "1", Category: activitiessvc.CategoryCafes, Status: status,
				Source: "google_places", ExternalID: "place-1",
			}
			places := &fakePlaces{detailOut: placesmap.PlaceDetail{Rating: 4.9}}
			repo := &fakeRepo{getOut: stored}
			svc := New(repo).WithPlaces(places)

			_, err := svc.GetByIDWithLiveDetails(context.Background(), "1")
			if !errors.Is(err, sharederrors.ErrNotFound) {
				t.Fatalf("GetByIDWithLiveDetails() error = %v, want ErrNotFound", err)
			}
			if places.detailCalls != 0 {
				t.Errorf("places.PlaceDetails calls = %d, want 0 — an unpublished row must never reach the live call", places.detailCalls)
			}
		})
	}
}

// fakePlaceDetail builds a placesmap.PlaceDetail via JSON, the only way an
// external field (PrimaryTypeDisplayName is the unexported localizedText
// type) can be set from outside the placesmap package — mirrors
// placesmap/buildlivedetails_test.go's own fullPlaceDetail fixture.
func fakePlaceDetail(t *testing.T, websiteURI, primaryType string) placesmap.PlaceDetail {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"websiteUri":             websiteURI,
		"primaryTypeDisplayName": map[string]string{"text": primaryType},
	})
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	var d placesmap.PlaceDetail
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	return d
}

// TestActivities_WithLiveDetails_MergesOntoStoredDetails is the regression
// this task exists to prevent: once a Wellness/Entertainment row carries
// website-scraped or admin-curated content (Treatments/GoodToKnow/
// UpcomingShows), a live-merge on detail-page view must not silently erase
// it. Only the Places-sourced keys (action_url/opening_hours/venue_type)
// may be overwritten by the live response; everything else on the stored
// row must survive.
func TestActivities_WithLiveDetails_MergesOntoStoredDetails(t *testing.T) {
	stored := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryWellness, City: "Belgrade",
		Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "place-1",
		Details: json.RawMessage(`{"treatments":[{"item":"Aroma massage","price":"€39"}],"venue_type":"Old stale value"}`),
	}
	places := &fakePlaces{detailOut: fakePlaceDetail(t, "https://example-spa.rs", "Spa")}
	repo := &fakeRepo{getOut: stored}
	svc := New(repo).WithPlaces(places)

	got, err := svc.GetByIDWithLiveDetails(context.Background(), "1")
	if err != nil {
		t.Fatalf("GetByIDWithLiveDetails() unexpected error: %v", err)
	}

	var details map[string]any
	if err := json.Unmarshal(got.Details, &details); err != nil {
		t.Fatalf("unmarshal merged details: %v", err)
	}
	if _, ok := details["treatments"]; !ok {
		t.Errorf("merged details lost stored `treatments`: %v", details)
	}
	if details["venue_type"] != "Spa" {
		t.Errorf("venue_type = %v, want the live value to win (\"Spa\")", details["venue_type"])
	}
	if details["action_url"] != "https://example-spa.rs" {
		t.Errorf("action_url = %v, want the live websiteUri", details["action_url"])
	}
}
