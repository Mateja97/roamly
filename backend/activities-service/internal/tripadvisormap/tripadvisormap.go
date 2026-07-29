// Package tripadvisormap maps Tripadvisor Content API subcategory/cuisine
// tags to Roamly's own subtype taxonomy (BUSINESS_STANDARDS.md), the exact
// counterpart to internal/placesmap's Google Places mapping.
package tripadvisormap

import "backend/shared/models/activitiessvc"

// taTagToSubtype is the curated Tripadvisor subcategory/cuisine tag -> our
// subtype slug lookup. Only unambiguous tags belong here — verify names
// against a live Tripadvisor Content API location response before adding
// more; unlike Google's published Table A, Tripadvisor's own taxonomy
// isn't documented as a fixed enum, so this list is expected to grow as
// real sync results are observed.
var taTagToSubtype = map[string]string{
	"fine_dining":  "fine_dining",
	"quick_bites":  "fast_casual",
	"street_food":  "street_food",
	"dessert_shop": "bakery_dessert",
	"wine_bar":     "wine_bar",
	"brew_pub":     "brewery",
	"sports_bar":   "sports_bar",
	"pub":          "pub",
}

// Subtype derives a subcategory slug for cat from Tripadvisor's
// subcategory/cuisine tags, returning the first mappable, cat-valid entry.
// Returns "" when nothing maps — never a guess, matching
// activitiessvc.ValidSubcategory's contract that "" is always valid.
func Subtype(cat activitiessvc.Category, subcategories []string) string {
	for _, tag := range subcategories {
		if sub, ok := taTagToSubtype[tag]; ok && activitiessvc.ValidSubcategory(cat, sub) {
			return sub
		}
	}
	return ""
}
