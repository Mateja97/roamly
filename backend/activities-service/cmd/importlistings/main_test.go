package main

import (
	"encoding/json"
	"strings"
	"testing"

	"backend/shared/models/activitiessvc"
)

func TestMapCategory(t *testing.T) {
	tests := []struct {
		in   string
		want activitiessvc.Category
	}{
		{"restaurants", activitiessvc.CategoryRestaurants},
		{"restaurants-bakery-dessert", activitiessvc.CategoryRestaurants},
		{"cafes-coffee-shop", activitiessvc.CategoryCafes},
		{"culture-religious-site", activitiessvc.CategoryCulture},
		{"nightlife", activitiessvc.CategoryNightlife},
		{"totally-unknown-thing", activitiessvc.CategoryEntertainment},
		{"", activitiessvc.CategoryEntertainment},
	}
	for _, tt := range tests {
		if got := mapCategory(tt.in); got != tt.want {
			t.Errorf("mapCategory(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestParseRating(t *testing.T) {
	tests := []struct {
		in   string
		want float64
	}{
		{"4.6", 4.6},
		{"", 0},
		{"not-a-number", 0},
	}
	for _, tt := range tests {
		if got := parseRating(tt.in); got != tt.want {
			t.Errorf("parseRating(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestDetailsJSON(t *testing.T) {
	// Every category returns valid JSON that round-trips as an object.
	all := []activitiessvc.Category{
		activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes,
		activitiessvc.CategoryBars, activitiessvc.CategoryNightlife,
		activitiessvc.CategoryNature, activitiessvc.CategorySport,
		activitiessvc.CategoryKids, activitiessvc.CategoryCulture,
		activitiessvc.CategoryArt, activitiessvc.CategoryWellness,
		activitiessvc.CategoryShopping, activitiessvc.CategoryEntertainment,
	}
	for _, c := range all {
		got := detailsJSON(c)
		var m map[string]any
		if err := json.Unmarshal([]byte(got), &m); err != nil {
			t.Errorf("detailsJSON(%q) = %q, not valid JSON: %v", c, got, err)
		}
	}

	// A restaurant payload decodes back into the real struct with a cuisine.
	var rd activitiessvc.RestaurantDetails
	if err := json.Unmarshal([]byte(detailsJSON(activitiessvc.CategoryRestaurants)), &rd); err != nil {
		t.Fatalf("decoding restaurant details: %v", err)
	}
	if rd.Cuisine == "" {
		t.Errorf("restaurant details missing cuisine: %+v", rd)
	}

	// Unknown category yields empty object.
	if got := detailsJSON(activitiessvc.Category("bogus")); strings.TrimSpace(got) != "{}" {
		t.Errorf("detailsJSON(bogus) = %q, want {}", got)
	}
}

func TestFormatInsertSQL(t *testing.T) {
	rows := []listing{
		{
			Title: "Ambar", Description: "Balkan restaurant",
			Category: activitiessvc.CategoryRestaurants,
			Lat:      44.819824, Lng: 20.448128,
			City: "Belgrade", Country: "Serbia",
			Rating: 4.6, NeedsReview: true,
		},
		{
			Title: "O'Hara's", Description: "Corner pub",
			Category: activitiessvc.CategoryBars,
			Lat:      44.8, Lng: 20.46,
			City: "Belgrade", Country: "Serbia",
			Rating: 0, NeedsReview: false,
		},
	}
	got := formatInsertSQL(rows)

	wants := []string{
		"INSERT INTO activities (title, description, category, location, country, city, rating, tags, details) VALUES",
		"'Ambar'",
		"'restaurants'",
		"ST_SetSRID(ST_MakePoint(20.448128, 44.819824), 4326)::geography",
		"ARRAY['needs-review']", // low-confidence row
		"'O''Hara''s'",          // embedded quote escaped
		"ARRAY[]::TEXT[]",       // confident row, no review tag
		"::jsonb",               // details cast
	}
	for _, w := range wants {
		if !strings.Contains(got, w) {
			t.Errorf("formatInsertSQL() missing %q\n---\n%s", w, got)
		}
	}
	if !strings.HasSuffix(strings.TrimSpace(got), ";") {
		t.Errorf("formatInsertSQL() should end with ';', got:\n%s", got)
	}
}

func TestFormatInsertSQLEmpty(t *testing.T) {
	if got := formatInsertSQL(nil); got != "" {
		t.Errorf("formatInsertSQL(nil) = %q, want empty", got)
	}
}

func TestNeedsReview(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"0.4", true},
		{"0.49", true},
		{"0.5", false},
		{"0.6", false},
		{"", false},
		{"bad", false},
	}
	for _, tt := range tests {
		if got := needsReview(tt.in); got != tt.want {
			t.Errorf("needsReview(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}
