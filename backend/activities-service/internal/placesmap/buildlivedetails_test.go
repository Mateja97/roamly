// External (black-box) test package deliberately: this file imports
// activities-service/internal/service (for the ValidateDetails strict-decode
// check below), and T2 makes service import placesmap to call
// BuildLiveDetails. An in-package `package placesmap` test file importing
// service would then form an import cycle in the test binary; package
// placesmap_test isn't placesmap itself, so it can import both with no
// cycle.
package placesmap_test

import (
	"encoding/json"
	"testing"

	"activities-service/internal/placesmap"
	"activities-service/internal/service"

	"backend/shared/models/activitiessvc"
)

// fullPlaceDetail is a PlaceDetail with every field BuildLiveDetails reads
// populated, for the one-case-per-category table below. Built via JSON
// (matching how places_test.go already builds PlaceDetail fixtures) rather
// than a Go struct literal: RegularOpeningHours.Periods' element type is
// unexported, so an external test package can't construct it directly.
func fullPlaceDetail(t *testing.T) placesmap.PlaceDetail {
	t.Helper()
	raw := []byte(`{
		"primaryTypeDisplayName": {"text": "Museum"},
		"regularOpeningHours": {
			"weekdayDescriptions": ["Monday: 9AM-5PM"],
			"periods": [{"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 17, "minute": 0}}]
		},
		"goodForChildren": true,
		"goodForGroups": true,
		"allowsDogs": true,
		"restroom": true,
		"outdoorSeating": true,
		"servesCoffee": true,
		"servesVegetarianFood": true,
		"menuForChildren": true,
		"dineIn": true,
		"takeout": true,
		"reservable": true,
		"parkingOptions": {"freeParkingLot": true},
		"accessibilityOptions": {"wheelchairAccessibleEntrance": true}
	}`)
	var d placesmap.PlaceDetail
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	return d
}

func parseDetails(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("invalid json: %v (%s)", err, raw)
	}
	return m
}

func TestBuildLiveDetails_OneCasePerCategory(t *testing.T) {
	d := fullPlaceDetail(t)

	tests := []struct {
		cat      activitiessvc.Category
		wantKeys []string
	}{
		{activitiessvc.CategoryCafes, []string{"hours", "opening_hours", "known_for"}},
		{activitiessvc.CategoryNightlife, []string{"venue_type", "opening_hours"}},
		{activitiessvc.CategoryNature, []string{"good_to_know"}},
		{activitiessvc.CategorySport, nil},
		{activitiessvc.CategoryKids, []string{"facilities"}},
		{activitiessvc.CategoryCulture, []string{"hours", "venue_type", "opening_hours"}},
		{activitiessvc.CategoryArt, []string{"hours", "venue_type", "opening_hours"}},
		{activitiessvc.CategoryWellness, []string{"venue_type"}},
		{activitiessvc.CategoryShopping, []string{"hours", "venue_type", "opening_hours"}},
		{activitiessvc.CategoryEntertainment, nil},
		// Not a Places-sourced category (Tripadvisor / no bespoke UI) -> always "{}".
		{activitiessvc.CategoryRestaurants, nil},
		{activitiessvc.CategoryBars, nil},
		{activitiessvc.CategoryToursExperiences, nil},
	}

	for _, tt := range tests {
		t.Run(string(tt.cat), func(t *testing.T) {
			raw := placesmap.BuildLiveDetails(tt.cat, "Belgrade", d)
			m := parseDetails(t, raw)
			if len(m) != len(tt.wantKeys) {
				t.Fatalf("keys = %v, want exactly %v", m, tt.wantKeys)
			}
			for _, k := range tt.wantKeys {
				if _, ok := m[k]; !ok {
					t.Errorf("missing key %q in %v", k, m)
				}
			}
			// ToursExperiences has no activitiessvc details struct at all
			// (service.detailsTarget's switch has no case for it, pre-existing,
			// not a T1 concern) — every other category's output must strict-decode
			// into its own struct, catching a renamed/misspelled json key that a
			// plain map[string]any comparison above wouldn't.
			if tt.cat == activitiessvc.CategoryToursExperiences {
				return
			}
			if err := service.ValidateDetails(tt.cat, raw); err != nil {
				t.Errorf("%s: ValidateDetails(%s) = %v", tt.cat, raw, err)
			}
		})
	}
}

func TestBuildLiveDetails_AmenitiesAllFalse_OmitsSection(t *testing.T) {
	var d placesmap.PlaceDetail // every amenity explicitly false (zero value)
	d.ParkingOptions = map[string]bool{"freeParkingLot": false}
	d.AccessibilityOptions = map[string]bool{"wheelchairAccessibleEntrance": false}

	for _, cat := range []activitiessvc.Category{
		activitiessvc.CategoryNature, activitiessvc.CategoryKids, activitiessvc.CategoryCafes,
	} {
		raw := placesmap.BuildLiveDetails(cat, "Belgrade", d)
		if string(raw) != "{}" {
			t.Errorf("%s: all-amenities-false = %s, want {} (section omitted, not empty)", cat, raw)
		}
	}
}

func TestBuildLiveDetails_AmenitiesAbsent_OmitsSection(t *testing.T) {
	var d placesmap.PlaceDetail // amenities entirely absent: bool zero value, nil maps

	for _, cat := range []activitiessvc.Category{
		activitiessvc.CategoryNature, activitiessvc.CategoryKids, activitiessvc.CategoryCafes,
	} {
		raw := placesmap.BuildLiveDetails(cat, "Belgrade", d)
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("%s: invalid json: %v", cat, err)
		}
		for _, key := range []string{"good_to_know", "facilities", "known_for"} {
			if _, ok := m[key]; ok {
				t.Errorf("%s: amenities absent, %q must be omitted, got %v", cat, key, m)
			}
		}
	}
}

func TestBuildLiveDetails_NoCityTimezone_OmitsOpeningHours(t *testing.T) {
	d := fullPlaceDetail(t)
	raw := placesmap.BuildLiveDetails(activitiessvc.CategoryCafes, "Atlantis", d)
	m := parseDetails(t, raw)
	if _, ok := m["opening_hours"]; ok {
		t.Errorf("unknown city: opening_hours must be omitted, got %v", m)
	}
	// hours (free text) and known_for don't depend on timezone -> still present.
	if _, ok := m["hours"]; !ok {
		t.Errorf("unknown city: hours (free text) should still be present, got %v", m)
	}
}

func TestBuildLiveDetails_NeverPersistedShape_IsValidJSON(t *testing.T) {
	// Sanity: every category returns parseable JSON, never nil/malformed,
	// even for a zero-value PlaceDetail.
	for cat := range activitiessvc.Subcategories {
		raw := placesmap.BuildLiveDetails(cat, "Belgrade", placesmap.PlaceDetail{})
		if !json.Valid(raw) {
			t.Errorf("%s: BuildLiveDetails returned invalid JSON: %s", cat, raw)
		}
	}
}
