package placesmap

import "backend/shared/models/activitiessvc"

// DiscoveryRow is one unit of Google-sourced discovery: the (category,
// subtype) pair it fills, and the Places Table A types used to find it.
//
// Read forward, DiscoveryRows drives discovery — one searchNearby per row,
// so category and subtype are known by construction rather than inferred
// from the response. Read backward (typeToSubtype, below) the same data
// drives classification. One table, two directions, so the two can't drift.
type DiscoveryRow struct {
	Category activitiessvc.Category
	// Subtype is the subcategory slug this row fills. "" means the
	// category's un-subtyped venues — real places that belong to the
	// category but match no subtype.
	Subtype string
	// Types are Table A types passed as searchNearby's includedTypes.
	// Empty exactly when TextQuery is set.
	Types []string
	// TextQuery is the searchText fallback for a subtype Table A cannot
	// express. Empty exactly when Types is set.
	TextQuery string
}

// GoogleCategories are the categories sourced from Google Places.
// Restaurants and Bars are Tripadvisor-exclusive; Tours & Experiences has no
// provider yet (see the spec's Deferred section). Cafés appear here *and* in
// the Tripadvisor sync: Tripadvisor's café coverage is far too thin to stand
// alone (a Belgrade sync yielded 2 cafés against 58 from Google).
var GoogleCategories = []activitiessvc.Category{
	activitiessvc.CategoryCafes,
	activitiessvc.CategoryNightlife,
	activitiessvc.CategoryNature,
	activitiessvc.CategorySport,
	activitiessvc.CategoryKids,
	activitiessvc.CategoryCulture,
	activitiessvc.CategoryArt,
	activitiessvc.CategoryWellness,
	activitiessvc.CategoryShopping,
	activitiessvc.CategoryEntertainment,
}

// DiscoveryRows is the table. Exactly one row per (Google category, subtype)
// pair, plus one subtype-"" row per category for its un-subtyped venues —
// enforced by TestDiscoveryRows_CoversEveryGoogleSubtype.
//
// A Table A type that could plausibly mean two different subtypes is
// deliberately left out rather than guessed (e.g. the generic "museum", when
// Places also exposes art_museum and history_museum). That preserves
// ValidSubcategory's contract that "" is always valid.
//
// Every Types entry below was verified against Table A at
// https://developers.google.com/maps/documentation/places/web-service/place-types
// (page footer: "Last updated 2026-07-28 UTC") on 2026-07-31 by scraping the
// live page's Table A section (478 distinct types) and diffing every type
// string used here against it — zero corrections were needed.
var DiscoveryRows = []DiscoveryRow{
	// Cafés
	{activitiessvc.CategoryCafes, "coffee_shop", []string{"coffee_shop"}, ""},
	{activitiessvc.CategoryCafes, "tea_house", []string{"tea_house"}, ""},
	{activitiessvc.CategoryCafes, "bakery_cafe", []string{"bakery"}, ""},
	{activitiessvc.CategoryCafes, "", []string{"cafe", "cat_cafe", "dog_cafe", "internet_cafe"}, ""},

	// Nightlife
	{activitiessvc.CategoryNightlife, "nightclub", []string{"night_club"}, ""},
	{activitiessvc.CategoryNightlife, "live_music_venue", []string{"concert_hall", "amphitheatre"}, ""},
	{activitiessvc.CategoryNightlife, "lounge", nil, "cocktail lounge"},
	{activitiessvc.CategoryNightlife, "", []string{"karaoke", "comedy_club", "dance_hall"}, ""},

	// Nature
	{activitiessvc.CategoryNature, "hiking_trail", []string{"hiking_area", "national_park", "state_park"}, ""},
	{activitiessvc.CategoryNature, "park", []string{"park", "dog_park", "picnic_ground"}, ""},
	{activitiessvc.CategoryNature, "beach", []string{"beach"}, ""},
	{activitiessvc.CategoryNature, "botanical_garden", []string{"botanical_garden", "garden"}, ""},
	{activitiessvc.CategoryNature, "viewpoint", []string{"observation_deck"}, ""},
	{activitiessvc.CategoryNature, "", []string{"wildlife_park", "wildlife_refuge", "marina"}, ""},

	// Sport
	{activitiessvc.CategorySport, "gym_fitness", []string{"gym", "fitness_center"}, ""},
	{activitiessvc.CategorySport, "climbing_gym", nil, "climbing gym"},
	{activitiessvc.CategorySport, "swimming_pool", []string{"swimming_pool"}, ""},
	{activitiessvc.CategorySport, "sports_court", []string{"athletic_field", "sports_complex", "sports_activity_location"}, ""},
	{activitiessvc.CategorySport, "golf_course", []string{"golf_course"}, ""},
	{activitiessvc.CategorySport, "extreme_sports", []string{"adventure_sports_center", "off_roading_area", "ski_resort"}, ""},
	{activitiessvc.CategorySport, "", []string{"arena", "stadium", "sports_club", "ice_skating_rink", "cycling_park", "skateboard_park"}, ""},

	// Kids
	{activitiessvc.CategoryKids, "playground", []string{"playground"}, ""},
	{activitiessvc.CategoryKids, "indoor_play_center", []string{"amusement_center", "video_arcade"}, ""},
	{activitiessvc.CategoryKids, "zoo_aquarium", []string{"zoo", "aquarium"}, ""},
	{activitiessvc.CategoryKids, "amusement_park", []string{"amusement_park", "water_park", "ferris_wheel", "roller_coaster"}, ""},
	{activitiessvc.CategoryKids, "kids_museum", nil, "children's museum"},
	{activitiessvc.CategoryKids, "", []string{"childrens_camp"}, ""},

	// Culture
	{activitiessvc.CategoryCulture, "historical_site", []string{"historical_place"}, ""},
	{activitiessvc.CategoryCulture, "monument_landmark", []string{"monument", "historical_landmark", "cultural_landmark"}, ""},
	{activitiessvc.CategoryCulture, "heritage_museum", []string{"history_museum"}, ""},
	{activitiessvc.CategoryCulture, "religious_site", []string{"church", "mosque", "synagogue", "hindu_temple"}, ""},
	{activitiessvc.CategoryCulture, "", []string{"cultural_center", "visitor_center", "planetarium"}, ""},

	// Art
	{activitiessvc.CategoryArt, "art_gallery", []string{"art_gallery"}, ""},
	{activitiessvc.CategoryArt, "art_museum", []string{"art_museum"}, ""},
	{activitiessvc.CategoryArt, "studio_workshop", []string{"art_studio"}, ""},
	{activitiessvc.CategoryArt, "public_art", []string{"sculpture"}, ""},
	{activitiessvc.CategoryArt, "", []string{"auditorium"}, ""},

	// Wellness
	{activitiessvc.CategoryWellness, "spa", []string{"spa", "massage"}, ""},
	{activitiessvc.CategoryWellness, "yoga_studio", []string{"yoga_studio"}, ""},
	{activitiessvc.CategoryWellness, "meditation_center", nil, "meditation center"},
	{activitiessvc.CategoryWellness, "thermal_bath", []string{"public_bath", "sauna"}, ""},
	{activitiessvc.CategoryWellness, "", []string{"wellness_center"}, ""},

	// Shopping
	{activitiessvc.CategoryShopping, "market_bazaar", []string{"market"}, ""},
	{activitiessvc.CategoryShopping, "boutique", []string{"clothing_store", "jewelry_store"}, ""},
	{activitiessvc.CategoryShopping, "mall", []string{"shopping_mall", "department_store"}, ""},
	{activitiessvc.CategoryShopping, "specialty_store", []string{"book_store", "gift_shop"}, ""},
	{activitiessvc.CategoryShopping, "", []string{"plaza"}, ""},

	// Entertainment
	{activitiessvc.CategoryEntertainment, "cinema", []string{"movie_theater"}, ""},
	{activitiessvc.CategoryEntertainment, "escape_room", nil, "escape room"},
	{activitiessvc.CategoryEntertainment, "bowling_arcade", []string{"bowling_alley"}, ""},
	{activitiessvc.CategoryEntertainment, "theater", []string{"performing_arts_theater", "opera_house", "philharmonic_hall"}, ""},
	{activitiessvc.CategoryEntertainment, "casino", []string{"casino"}, ""},
	{activitiessvc.CategoryEntertainment, "", []string{"event_venue", "convention_center", "banquet_hall"}, ""},
}

// typeToSubtype is DiscoveryRows read backward: Google type -> subtype slug,
// the classification direction. Built once at init so the two directions
// cannot disagree.
//
// Category-level rows (Subtype "") are deliberately NOT indexed. Indexing
// them would let a place whose primaryType is e.g. "wellness_center" resolve
// to "" and short-circuit Subtype's fallback loop before it ever reaches a
// more specific type like "yoga_studio" in the place's types[].
var typeToSubtype = func() map[string]string {
	m := make(map[string]string)
	for _, r := range DiscoveryRows {
		if r.Subtype == "" {
			continue
		}
		for _, ty := range r.Types {
			m[ty] = r.Subtype
		}
	}
	for ty, sub := range classifyOnlyTypes {
		m[ty] = sub
	}
	return m
}()

// classifyOnlyTypes covers subtypes we classify but never discover from
// Google — Restaurants and Bars are Tripadvisor-sourced, but a Tripadvisor
// venue can still carry Google types when the two providers overlap.
var classifyOnlyTypes = map[string]string{
	"fine_dining_restaurant": "fine_dining",
	"fast_food_restaurant":   "fast_casual",
	"cocktail_bar":           "cocktail_bar",
	"wine_bar":               "wine_bar",
	"brewery":                "brewery",
	"sports_bar":             "sports_bar",
	"pub":                    "pub",
}

// MinRating and MinReviews are the discovery quality floor, deliberately far
// below the old batch pipeline's 4.0/50. Those floors existed to compensate
// for vague text queries returning junk; includedTypes plus a hard circle
// plus Google's popularity ranking already do that job, and a 50-review floor
// deletes exactly the thin subtypes type-driven discovery exists to surface
// (a neighbourhood viewpoint or meditation centre rarely clears it).
//
// They live here, beside the table, so the dry-run CLI and the live sync
// cannot apply different floors and report numbers that don't match what
// gets ingested. Tune from real yields, not from guesswork.
const (
	MinRating  = 3.5
	MinReviews = 5
)

// PassesFloor is the quality gate. An unrated venue (rating 0) fails on the
// rating floor, which is intended: no signal is not the same as good.
func PassesFloor(p Place) bool {
	return p.Rating >= MinRating && p.UserRatingCount >= MinReviews
}
