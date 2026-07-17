package main

import (
	"testing"

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
