package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"activities-service/internal/places"
	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

// TestFieldMask_RequestsMachineTypes proves the field mask asks Google for
// the machine-readable type fields, not just the localized display label —
// the T1 gap: primaryTypeDisplayName alone can't be mapped to a subtype.
func TestFieldMask_RequestsMachineTypes(t *testing.T) {
	for _, want := range []string{"places.primaryType", "places.types", "places.primaryTypeDisplayName"} {
		if !strings.Contains(fieldMask, want) {
			t.Errorf("fieldMask = %q, want it to contain %q", fieldMask, want)
		}
	}
}

// TestToOutputRow_CarriesPrimaryTypeAndTypes is the runnable check for T1's
// acceptance criterion: a place with a Places machine type must land on the
// output row with a non-empty primary_type, not dropped between parse and
// persist; an absent type must stay empty, not invented.
func TestToOutputRow_CarriesPrimaryTypeAndTypes(t *testing.T) {
	cases := []struct {
		name        string
		primaryType string
		types       []string
	}{
		{"known type flows through", "fine_dining_restaurant", []string{"fine_dining_restaurant", "restaurant", "food"}},
		{"absent type stays empty", "", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var p placesmap.Place
			p.ID = "places/abc123"
			p.PrimaryType = tc.primaryType
			p.Types = tc.types

			row := toOutputRow(activitiessvc.CategoryRestaurants, "Belgrade", "Serbia", p, nil)
			if row.PrimaryType != tc.primaryType {
				t.Errorf("row.PrimaryType = %q, want %q", row.PrimaryType, tc.primaryType)
			}
			if len(row.Types) != len(tc.types) {
				t.Errorf("row.Types = %v, want %v", row.Types, tc.types)
			}
		})
	}
}

func TestPassesFilter(t *testing.T) {
	mk := func(rating float64, reviews int) placesmap.Place {
		var p placesmap.Place
		p.Rating = rating
		p.UserRatingCount = reviews
		return p
	}
	cases := []struct {
		name string
		p    placesmap.Place
		keep bool
	}{
		{"good", mk(4.5, 300), true},
		{"exactly at floor", mk(4.0, 50), true},
		{"rating too low", mk(3.9, 500), false},
		{"too few reviews", mk(4.8, 49), false},
		{"5 stars but noise", mk(5.0, 3), false},
	}
	for _, tc := range cases {
		if got := passesFilter(tc.p, 4.0, 50); got != tc.keep {
			t.Errorf("%s: passesFilter = %v, want %v", tc.name, got, tc.keep)
		}
	}
}

// TestPhotoURIs_CapsToMax proves the provisional-photo cap: even when a venue
// has multiple photo resource names, photoURIs makes at most `max` metered
// media calls (the T1 requirement — one provisional photo per venue, not up
// to 3).
func TestPhotoURIs_CapsToMax(t *testing.T) {
	cases := []struct {
		name      string
		names     []string
		max       int
		wantCalls int
		wantURLs  int
	}{
		{"three names, capped to 1", []string{"places/a", "places/b", "places/c"}, 1, 1, 1},
		{"three names, capped to 2", []string{"places/a", "places/b", "places/c"}, 2, 2, 2},
		{"no names", nil, 1, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var calls int
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Write([]byte(`{"photoUri":"http://img/x.jpg"}`))
			}))
			defer srv.Close()

			c := places.NewWithBase("k", srv.URL)
			got := photoURIs(context.Background(), c, tc.names, tc.max)

			if calls != tc.wantCalls {
				t.Errorf("media calls = %d, want %d", calls, tc.wantCalls)
			}
			if len(got) != tc.wantURLs {
				t.Errorf("resolved URLs = %d, want %d", len(got), tc.wantURLs)
			}
		})
	}
}
