package placesmap

import (
	"encoding/json"
	"testing"

	"backend/shared/models/activitiessvc"
)

func TestPriceTier(t *testing.T) {
	for in, want := range map[string]string{
		"PRICE_LEVEL_INEXPENSIVE":    "$",
		"PRICE_LEVEL_MODERATE":       "$$",
		"PRICE_LEVEL_EXPENSIVE":      "$$$",
		"PRICE_LEVEL_VERY_EXPENSIVE": "$$$",
		"":                           "",
		"PRICE_LEVEL_UNSPECIFIED":    "",
	} {
		if got := PriceTier(in); got != want {
			t.Errorf("PriceTier(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildDetails(t *testing.T) {
	var p Place
	p.PriceLevel = "PRICE_LEVEL_MODERATE"
	p.RegularOpeningHours.WeekdayDescriptions = []string{"Monday: 9AM-5PM", "Tuesday: 9AM-5PM"}
	p.PrimaryTypeDisplayName.Text = "Night club"

	parse := func(t *testing.T, cat activitiessvc.Category) map[string]any {
		t.Helper()
		var m map[string]any
		if err := json.Unmarshal(BuildDetails(cat, p), &m); err != nil {
			t.Fatalf("%s: invalid json: %v", cat, err)
		}
		return m
	}

	// Restaurants: hours + price_tier, no venue_type.
	r := parse(t, activitiessvc.CategoryRestaurants)
	if _, ok := r["hours"]; !ok {
		t.Error("restaurant missing hours")
	}
	if r["price_tier"] != "$$" {
		t.Errorf("restaurant price_tier = %v, want $$", r["price_tier"])
	}
	if _, ok := r["venue_type"]; ok {
		t.Error("restaurant should not carry venue_type")
	}

	// Culture: hours + venue_type, no price_tier.
	c := parse(t, activitiessvc.CategoryCulture)
	if _, ok := c["hours"]; !ok {
		t.Error("culture missing hours")
	}
	if c["venue_type"] != "Night club" {
		t.Errorf("culture venue_type = %v, want Night club", c["venue_type"])
	}
	if _, ok := c["price_tier"]; ok {
		t.Error("culture should not carry price_tier")
	}

	// Nightlife: venue_type only, no hours/price_tier.
	n := parse(t, activitiessvc.CategoryNightlife)
	if n["venue_type"] != "Night club" {
		t.Errorf("nightlife venue_type = %v, want Night club", n["venue_type"])
	}
	if _, ok := n["hours"]; ok {
		t.Error("nightlife should not carry hours")
	}

	// Bars and Nature: empty — no aligned Places source.
	for _, cat := range []activitiessvc.Category{activitiessvc.CategoryBars, activitiessvc.CategoryNature} {
		if got := parse(t, cat); len(got) != 0 {
			t.Errorf("%s details = %v, want empty", cat, got)
		}
	}
}
