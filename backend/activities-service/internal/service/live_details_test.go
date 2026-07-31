package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

// TestActivities_GetByID_LiveDetails covers T2's (places-live-details)
// fallback-on-error contract for GetByID's live merge: an unconfigured
// places client, a PlaceDetails error, and a timeout must all fall back to
// the bare stored row with no error surfaced; success must merge
// Details/Description/GoogleReviews. Every case also asserts the live
// result is never persisted (repo.updateCalls stays 0) — the one
// deliberate deviation from GetPhotos' otherwise-identical pattern.
func TestActivities_GetByID_LiveDetails(t *testing.T) {
	cafe := activitiessvc.Activity{
		ID: "1", Category: activitiessvc.CategoryCafes, City: "Belgrade",
		Source: "google_places", ExternalID: "place-1",
	}

	review := placesmap.Review{
		AuthorAttribution: placesmap.AuthorAttribution{
			DisplayName: "Ana", PhotoURI: "https://example.com/ana.jpg", URI: "https://maps.google.com/ana",
		},
		Rating:      5,
		PublishTime: "2026-06-01T00:00:00Z",
	}
	review.Text.Text = "Lovely spot."
	detail := placesmap.PlaceDetail{Reviews: []placesmap.Review{review}, ServesCoffee: true}
	detail.EditorialSummary.Text = "A cozy cafe with great coffee."
	wantDetailsJSON := string(placesmap.BuildLiveDetails(activitiessvc.CategoryCafes, "Belgrade", detail))

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
			name:            "success merges details, description, reviews",
			activity:        cafe,
			places:          &fakePlaces{detailOut: detail},
			wantPlaceCalls:  1,
			wantDescription: "A cozy cafe with great coffee.",
			wantDetailsJSON: wantDetailsJSON,
			wantReviews:     1,
		},
		{
			name:     "tripadvisor source never calls places",
			activity: activitiessvc.Activity{ID: "2", Category: activitiessvc.CategoryRestaurants, Source: "tripadvisor", ExternalID: "loc-1"},
			places:   &fakePlaces{detailOut: detail},
		},
		{
			name:     "admin-created (empty source) row never calls places",
			activity: activitiessvc.Activity{ID: "3", Category: activitiessvc.CategoryNature, Source: "", ExternalID: "place-3"},
			places:   &fakePlaces{detailOut: detail},
		},
		{
			name:     "no external_id never calls places",
			activity: activitiessvc.Activity{ID: "4", Category: activitiessvc.CategoryCafes, Source: "google_places", ExternalID: ""},
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

			got, err := svc.GetByID(ctx, tt.activity.ID)
			if err != nil {
				t.Fatalf("GetByID() unexpected error: %v", err)
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

	activity := activitiessvc.Activity{ID: "1", Category: activitiessvc.CategoryCafes, Source: "google_places", ExternalID: "place-1"}
	repo := &fakeRepo{getOut: activity}
	svc := New(repo).WithPlaces(&fakePlaces{detailOut: detail})

	got, err := svc.GetByID(context.Background(), "1")
	if err != nil {
		t.Fatalf("GetByID() unexpected error: %v", err)
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
