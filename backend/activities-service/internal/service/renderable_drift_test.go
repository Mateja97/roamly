package service_test

import (
	"encoding/json"
	"testing"

	"activities-service/internal/placesmap"
	"activities-service/internal/service"

	"backend/shared/models/activitiessvc"
)

// liveMappedCategories are the categories placesmap.BuildLiveDetails has a
// case for, plus the three it deliberately doesn't (restaurants, bars,
// tours_experiences) — listing all 13 means a new category with a new body
// field is covered the moment it is added, without editing this test.
var liveMappedCategories = []activitiessvc.Category{
	activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes, activitiessvc.CategoryBars,
	activitiessvc.CategoryNightlife, activitiessvc.CategoryNature, activitiessvc.CategorySport,
	activitiessvc.CategoryKids, activitiessvc.CategoryCulture, activitiessvc.CategoryArt,
	activitiessvc.CategoryWellness, activitiessvc.CategoryShopping, activitiessvc.CategoryEntertainment,
	activitiessvc.CategoryToursExperiences,
}

// fullyPopulatedDetail turns on every field BuildLiveDetails reads, so the
// union of keys it emits across all categories is as wide as the mapper can
// make it.
//
// opening_hours is the one exception this fixture cannot reach:
// buildOpeningHours only emits it when RegularOpeningHours.Periods is
// non-empty, and Periods is []placePeriod, an unexported type — an external
// service_test package cannot construct a value for it. This guard therefore
// gives no drift protection for opening_hours; a reader must not rely on it
// to catch a future opening_hours-shaped key.
func fullyPopulatedDetail() placesmap.PlaceDetail {
	var d placesmap.PlaceDetail
	d.WebsiteURI = "https://example.com"
	d.PrimaryTypeDisplayName.Text = "Museum"
	d.RegularOpeningHours.WeekdayDescriptions = []string{"Monday: 9 AM – 5 PM"}
	d.GoodForChildren = true
	d.GoodForGroups = true
	d.AllowsDogs = true
	d.Restroom = true
	d.OutdoorSeating = true
	d.LiveMusic = true
	d.ParkingOptions = map[string]bool{"freeParkingLot": true}
	d.AccessibilityOptions = map[string]bool{"wheelchairAccessibleEntrance": true}
	d.ServesCoffee = true
	d.ServesVegetarianFood = true
	d.MenuForChildren = true
	d.DineIn = true
	d.Takeout = true
	d.Reservable = true
	return d
}

// TestRenderability_ScorerClassifiesEveryLiveDetailKey is the drift guard.
// If placesmap.BuildLiveDetails gains a key the scorer doesn't classify,
// rows carrying it score zero for it and get drafted despite rendering
// fine. Fixing a failure here means deciding whether the new key is a body
// block (real content, 2 points) or presentational (furniture, shares 1)
// and adding it to the matching list in renderable.go.
func TestRenderability_ScorerClassifiesEveryLiveDetailKey(t *testing.T) {
	known := map[string]bool{}
	for _, k := range service.KnownDetailKeys() {
		known[k] = true
	}

	detail := fullyPopulatedDetail()
	for _, category := range liveMappedCategories {
		raw := placesmap.BuildLiveDetails(category, "RS", detail)

		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			t.Fatalf("BuildLiveDetails(%s) produced undecodable JSON: %v", category, err)
		}
		for key := range fields {
			if !known[key] {
				t.Errorf("BuildLiveDetails(%s) emits details key %q, which service.Renderability does not classify — "+
					"add it to bodyBlockKeys (real content) or presentationalKeys (furniture) in renderable.go",
					category, key)
			}
		}
	}
}

// TestKnownDetailKeys_HasNoDuplicates guards the lists themselves: a key in
// both bodyBlockKeys and presentationalKeys would score 3 instead of 2,
// silently moving the bar for every row that carries it.
func TestKnownDetailKeys_HasNoDuplicates(t *testing.T) {
	seen := map[string]bool{}
	for _, k := range service.KnownDetailKeys() {
		if seen[k] {
			t.Errorf("details key %q appears in more than one scorer list — it would score twice", k)
		}
		seen[k] = true
	}
}
