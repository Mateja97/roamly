package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"activities-service/internal/places"
	"activities-service/internal/placesmap"
)

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
