package placesmap

import "backend/shared/models/activitiessvc"

// placeTypeToSubtype is the curated Google Places (New) primaryType -> our
// subtype slug lookup (T2, BUSINESS_STANDARDS.md taxonomy). Only unambiguous
// mappings belong here: a Places type that could plausibly mean more than
// one subtype (e.g. the generic "museum", when Places also exposes the more
// specific art_museum/history_museum) is deliberately left out rather than
// guessed. Slugs verified against
// https://developers.google.com/maps/documentation/places/web-service/place-types.
var placeTypeToSubtype = map[string]string{
	"fine_dining_restaurant":  "fine_dining",
	"coffee_shop":             "coffee_shop",
	"tea_house":               "tea_house",
	"cocktail_bar":            "cocktail_bar",
	"wine_bar":                "wine_bar",
	"brewery":                 "brewery",
	"night_club":              "nightclub",
	"art_gallery":             "art_gallery",
	"art_museum":              "art_museum",
	"history_museum":          "heritage_museum",
	"spa":                     "spa",
	"golf_course":             "golf_course",
	"playground":              "playground",
	"casino":                  "casino",
	"movie_theater":           "cinema",
	"performing_arts_theater": "theater",
	"zoo":                     "zoo_aquarium",
	"aquarium":                "zoo_aquarium",
	"botanical_garden":        "botanical_garden",
	"shopping_mall":           "mall",
	"bowling_alley":           "bowling_arcade",
}

// Subtype derives a subcategory slug for cat from a Places primaryType (T2),
// falling back to the first mappable entry in types when primaryType itself
// doesn't map or its mapped subtype doesn't belong to cat. Returns "" when
// nothing maps — never a guess, matching ValidSubcategory's contract that ""
// is always a valid subcategory.
func Subtype(cat activitiessvc.Category, primaryType string, types []string) string {
	if sub, ok := placeTypeToSubtype[primaryType]; ok && activitiessvc.ValidSubcategory(cat, sub) {
		return sub
	}
	for _, t := range types {
		if sub, ok := placeTypeToSubtype[t]; ok && activitiessvc.ValidSubcategory(cat, sub) {
			return sub
		}
	}
	return ""
}
