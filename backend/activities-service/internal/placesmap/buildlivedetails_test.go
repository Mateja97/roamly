package placesmap

import (
	"encoding/json"
	"testing"

	"backend/shared/models/activitiessvc"
)

// fullPlaceDetail is a PlaceDetail with every field BuildLiveDetails reads
// populated, for the one-case-per-category table below.
func fullPlaceDetail() PlaceDetail {
	var d PlaceDetail
	d.PrimaryTypeDisplayName.Text = "Museum"
	d.RegularOpeningHours.WeekdayDescriptions = []string{"Monday: 9AM-5PM"}
	d.RegularOpeningHours.Periods = []placePeriod{
		{Open: placeDayTime{Day: 1, Hour: 9, Minute: 0}, Close: &placeDayTime{Day: 1, Hour: 17, Minute: 0}},
	}
	d.GoodForChildren = true
	d.GoodForGroups = true
	d.AllowsDogs = true
	d.Restroom = true
	d.OutdoorSeating = true
	d.ServesCoffee = true
	d.ServesVegetarianFood = true
	d.MenuForChildren = true
	d.DineIn = true
	d.Takeout = true
	d.Reservable = true
	d.ParkingOptions = amenityBooleans{"freeParkingLot": true}
	d.AccessibilityOptions = amenityBooleans{"wheelchairAccessibleEntrance": true}
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
	d := fullPlaceDetail()

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
			raw := BuildLiveDetails(tt.cat, "Belgrade", d)
			m := parseDetails(t, raw)
			if len(m) != len(tt.wantKeys) {
				t.Fatalf("keys = %v, want exactly %v", m, tt.wantKeys)
			}
			for _, k := range tt.wantKeys {
				if _, ok := m[k]; !ok {
					t.Errorf("missing key %q in %v", k, m)
				}
			}
		})
	}
}

func TestBuildLiveDetails_AmenitiesAllFalse_OmitsSection(t *testing.T) {
	var d PlaceDetail // every amenity explicitly false (zero value)
	d.ParkingOptions = amenityBooleans{"freeParkingLot": false}
	d.AccessibilityOptions = amenityBooleans{"wheelchairAccessibleEntrance": false}

	for _, cat := range []activitiessvc.Category{
		activitiessvc.CategoryNature, activitiessvc.CategoryKids, activitiessvc.CategoryCafes,
	} {
		raw := BuildLiveDetails(cat, "Belgrade", d)
		if string(raw) != "{}" {
			t.Errorf("%s: all-amenities-false = %s, want {} (section omitted, not empty)", cat, raw)
		}
	}
}

func TestBuildLiveDetails_AmenitiesAbsent_OmitsSection(t *testing.T) {
	var d PlaceDetail // amenities entirely absent: bool zero value, nil pointers

	for _, cat := range []activitiessvc.Category{
		activitiessvc.CategoryNature, activitiessvc.CategoryKids, activitiessvc.CategoryCafes,
	} {
		raw := BuildLiveDetails(cat, "Belgrade", d)
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
	d := fullPlaceDetail()
	raw := BuildLiveDetails(activitiessvc.CategoryCafes, "Atlantis", d)
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
		raw := BuildLiveDetails(cat, "Belgrade", PlaceDetail{})
		if !json.Valid(raw) {
			t.Errorf("%s: BuildLiveDetails returned invalid JSON: %s", cat, raw)
		}
	}
}
