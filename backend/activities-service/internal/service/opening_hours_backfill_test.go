package service

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	"backend/shared/models/activitiessvc"
)

// backfillTitleCategory mirrors migrations/0012_backfill_opening_hours.sql's
// title -> category, so this test can validate each row's opening_hours
// against the same per-category struct the real API decodes into.
var backfillTitleCategory = map[string]activitiessvc.Category{
	"Skadarlija Food Walk":                 activitiessvc.CategoryRestaurants,
	"Eiffel Tower Sunset Picnic":           activitiessvc.CategoryRestaurants,
	"Shibuya Street Food Crawl":            activitiessvc.CategoryRestaurants,
	"Ambar":                                activitiessvc.CategoryRestaurants,
	"Pečat Restoran":                       activitiessvc.CategoryRestaurants,
	"Kafana Pavle Korcagin":                activitiessvc.CategoryRestaurants,
	"MAMA'S Bistro":                        activitiessvc.CategoryRestaurants,
	"Mezestoran Dvorište":                  activitiessvc.CategoryRestaurants,
	"Zavicaj Restaurant":                   activitiessvc.CategoryRestaurants,
	"Curry Souls":                          activitiessvc.CategoryRestaurants,
	"Gradska":                              activitiessvc.CategoryRestaurants,
	"To Je To":                             activitiessvc.CategoryRestaurants,
	"Tri Sesira":                           activitiessvc.CategoryRestaurants,
	"Koi Bar • Sushi And Cocktail":         activitiessvc.CategoryRestaurants,
	"Coffee Dictionary Skadarlija":         activitiessvc.CategoryCafes,
	"Koffein":                              activitiessvc.CategoryCafes,
	"Coffee Dream Dorćol":                  activitiessvc.CategoryCafes,
	"Cafe Moskva":                          activitiessvc.CategoryCafes,
	"NEGRO caffe":                          activitiessvc.CategoryCafes,
	"uzitak coffee selection and delights": activitiessvc.CategoryCafes,
	"Coffee Room Serbia":                   activitiessvc.CategoryCafes,
	"Kafe Supa":                            activitiessvc.CategoryCafes,
	"Cafe&Factory":                         activitiessvc.CategoryCafes,
	"Belgrade Fortress & Kalemegdan Park":  activitiessvc.CategoryCulture,
	"Colosseum Guided Tour":                activitiessvc.CategoryCulture,
	"Nikola Tesla Museum":                  activitiessvc.CategoryCulture,
	"Church of Saint Sava":                 activitiessvc.CategoryCulture,
	"Republic Square":                      activitiessvc.CategoryCulture,
	"National Museum Belgrade":             activitiessvc.CategoryCulture,
	"Nebojša Tower":                        activitiessvc.CategoryCulture,
	"Street Art Tour Savamala":             activitiessvc.CategoryArt,
	"Sagrada Familia Art Walk":             activitiessvc.CategoryArt,
	"Museum of Contemporary Art Belgrade":  activitiessvc.CategoryArt,
	"Art for All":                          activitiessvc.CategoryArt,
	"Green Door - Gallery & Art Gift Shop": activitiessvc.CategoryArt,
	"Eugster Belgrade":                     activitiessvc.CategoryArt,
	"O3ONE Art Space":                      activitiessvc.CategoryArt,
	"Knez Mihailova Shopping Walk":         activitiessvc.CategoryShopping,
	"UŠĆE Shopping Center":                 activitiessvc.CategoryShopping,
	"Delta City":                           activitiessvc.CategoryShopping,
	"Big Fashion":                          activitiessvc.CategoryShopping,
	"Rajiceva Shopping Center":             activitiessvc.CategoryShopping,
	"Kalenić Pijaca":                       activitiessvc.CategoryShopping,
	"Mercator Center Belgrade":             activitiessvc.CategoryShopping,
}

// TestBackfillMigration_OpeningHoursValid runs every row of
// 0012_backfill_opening_hours.sql's opening_hours payload through the real
// ValidateDetails path (the same one a live PATCH request hits), so a typo
// in the hand-converted hours data fails CI instead of silently shipping a
// wrong Open/Closed status.
func TestBackfillMigration_OpeningHoursValid(t *testing.T) {
	data, err := os.ReadFile("../repository/migrations/0012_backfill_opening_hours.sql")
	if err != nil {
		t.Fatalf("reading migration file: %v", err)
	}

	re := regexp.MustCompile(`(?m)^UPDATE activities SET details = details \|\| '(.+)'::jsonb WHERE title = '(.+)';$`)
	matches := re.FindAllStringSubmatch(string(data), -1)
	if len(matches) != len(backfillTitleCategory) {
		t.Fatalf("found %d UPDATE statements in migration, want %d (keep this test's map in sync with the migration)", len(matches), len(backfillTitleCategory))
	}

	seen := make(map[string]bool, len(matches))
	for _, m := range matches {
		jsonPayload, rawTitle := m[1], m[2]
		title := strings.ReplaceAll(rawTitle, "''", "'")
		seen[title] = true

		cat, ok := backfillTitleCategory[title]
		if !ok {
			t.Errorf("title %q from migration has no entry in backfillTitleCategory", title)
			continue
		}
		if err := ValidateDetails(cat, json.RawMessage(jsonPayload)); err != nil {
			t.Errorf("title %q: opening_hours failed ValidateDetails: %v", title, err)
		}
	}
	for title := range backfillTitleCategory {
		if !seen[title] {
			t.Errorf("backfillTitleCategory has %q but it wasn't found in the migration file", title)
		}
	}
}
