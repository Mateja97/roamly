// Package tripadvisormap maps Tripadvisor Content API subcategory/cuisine
// tags to Roamly's own subtype taxonomy (BUSINESS_STANDARDS.md), the exact
// counterpart to internal/placesmap's Google Places mapping.
package tripadvisormap

import (
	"regexp"
	"strings"

	"backend/shared/models/activitiessvc"
)

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

// cafeRe / barRe hold the curated, English + Serbian/Latin-script keywords
// that decide Category below, matched as whole words (\b-bounded) so a
// keyword like "bar" doesn't false-positive inside an unrelated name that
// merely contains it as a substring (e.g. real Belgrade restaurant "Ambar
// Beograd"). Restaurants, Cafés and Bars are all sourced from Tripadvisor
// with each venue filed under exactly one of them (see
// service.syncTripadvisorAnchor), but Terra's categories[] field -- the one
// real signal that would separate them -- is documented but never returned
// on our API entitlement (verified live), and neither subratings (every
// food venue gets a Food subrating, cafes and bars included) nor
// price_level ("Cheap Eats"/"Mid Range"/"Fine Dining", same three buckets
// regardless of venue type) separate the three either. The venue name is
// the only signal left, so this is a keyword heuristic on name, done
// honestly rather than dressed up as something smarter. Replace with real
// category data if Tripadvisor ever grants the categories[] entitlement.
var (
	cafeRe = regexp.MustCompile(`\b(coffee|cafe|kafe|espresso|roastery|poslasticarnica|tea|tearoom)\b`)
	barRe  = regexp.MustCompile(`\b(bar|pub|pivnica|brewery|tavern|kafana|cocktail|wine)\b`)
)

// diacriticFold maps the accented letters actually seen in real Tripadvisor
// venue names -- Serbian Latin script (š, đ, č, ć, ž) plus "café" -- to
// their plain-ASCII form, so the keyword patterns above don't need an
// accented spelling of every keyword. Extend only when a real venue name
// needs another accented letter, not speculatively.
var diacriticFold = strings.NewReplacer(
	"š", "s", "đ", "dj", "č", "c", "ć", "c", "ž", "z", "é", "e",
)

// Category classifies a Tripadvisor venue into Restaurants/Cafés/Bars from
// its name alone (see the keyword doc above) -- case- and
// diacritic-insensitive whole-word match, Cafés checked before Bars.
// Restaurants is the explicit default when nothing matches: an honest
// documented fallback, never a guess beyond the curated lists.
func Category(name string) activitiessvc.Category {
	folded := diacriticFold.Replace(strings.ToLower(name))
	switch {
	case cafeRe.MatchString(folded):
		return activitiessvc.CategoryCafes
	case barRe.MatchString(folded):
		return activitiessvc.CategoryBars
	default:
		return activitiessvc.CategoryRestaurants
	}
}
