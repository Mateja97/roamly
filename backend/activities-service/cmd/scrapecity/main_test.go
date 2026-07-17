package main

import (
	"encoding/json"
	"testing"

	"backend/shared/models/activitiessvc"
)

func TestPassesFilter(t *testing.T) {
	mk := func(rating float64, reviews int) place {
		var p place
		p.Rating = rating
		p.UserRatingCount = reviews
		return p
	}
	cases := []struct {
		name string
		p    place
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

func TestPriceTier(t *testing.T) {
	for in, want := range map[string]string{
		"PRICE_LEVEL_INEXPENSIVE":    "$",
		"PRICE_LEVEL_MODERATE":       "$$",
		"PRICE_LEVEL_EXPENSIVE":      "$$$",
		"PRICE_LEVEL_VERY_EXPENSIVE": "$$$",
		"":                           "",
		"PRICE_LEVEL_UNSPECIFIED":    "",
	} {
		if got := priceTier(in); got != want {
			t.Errorf("priceTier(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildDetails(t *testing.T) {
	var p place
	p.PriceLevel = "PRICE_LEVEL_MODERATE"
	p.RegularOpeningHours.WeekdayDescriptions = []string{"Monday: 9AM-5PM", "Tuesday: 9AM-5PM"}

	// Restaurant carries both hours and price_tier.
	var got map[string]any
	if err := json.Unmarshal(buildDetails(activitiessvc.CategoryRestaurants, p), &got); err != nil {
		t.Fatalf("restaurant details invalid json: %v", err)
	}
	if got["price_tier"] != "$$" {
		t.Errorf("restaurant price_tier = %v, want $$", got["price_tier"])
	}
	if _, ok := got["hours"]; !ok {
		t.Error("restaurant details missing hours")
	}

	// Nature carries hours but no price_tier (price only applies to food/drink).
	var nat map[string]any
	if err := json.Unmarshal(buildDetails(activitiessvc.CategoryNature, p), &nat); err != nil {
		t.Fatalf("nature details invalid json: %v", err)
	}
	if _, ok := nat["price_tier"]; ok {
		t.Error("nature details should not carry price_tier")
	}
}
