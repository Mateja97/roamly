package placesmap

import (
	"slices"

	"backend/shared/models/activitiessvc"
)

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

// DiscoveryRows is the table. Exactly one row per (category, subtype) pair
// for every category except Tours & Experiences (still deliberately
// unsourced), plus one subtype-"" row per category for its un-subtyped
// venues — enforced by TestDiscoveryRows_CoversEveryGoogleSubtype.
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
// string used here against it — zero corrections were needed. The
// Restaurants and Bars rows below were verified the same way on 2026-08-01
// (footer unchanged, still 2026-07-28 UTC) — zero corrections needed there
// either.
//
// Restaurants and Bars are NOT in GoogleCategories (see below), so these
// rows are never read forward — no searchNearby ever runs for them, keeping
// discovery Tripadvisor-exclusive for both. They exist purely for the
// backward (classification) direction: Subtype resolves a Tripadvisor
// venue's Google primaryType/types against these rows, same as any other
// category's.
//
// Same "leave it out" rule below: the generic "restaurant" type is left
// unmapped (family_restaurant/diner/bistro/buffet_restaurant already cover
// casual_dining without guessing which subtype a bare "restaurant" means),
// as are bar_and_grill, gastropub, brewpub, oyster_bar_restaurant and
// snack_bar — Table A types that could plausibly fit more than one row
// below.
var DiscoveryRows = []DiscoveryRow{
	// Restaurants (classification-only — see the file comment above).
	// street_food is a TextQuery row with no Table A equivalent; since
	// Restaurants is never read forward, it never runs and never yields —
	// that's expected coverage-test bookkeeping, not a bug.
	{activitiessvc.CategoryRestaurants, "fine_dining", []string{"fine_dining_restaurant"}, ""},
	{activitiessvc.CategoryRestaurants, "casual_dining", []string{"family_restaurant", "diner", "bistro", "buffet_restaurant"}, ""},
	// Service-FORMAT types only. cafeteria, meal_takeaway and food_court
	// describe how a venue serves, so they belong on a format row;
	// hamburger_restaurant and every other cuisine type deliberately do not,
	// because cuisine does not report format — a gourmet burger restaurant is
	// an ordinary sit-down venue.
	//
	// They live here so placesmap.Subtype resolves them before the price layer
	// is consulted (see service.SubtypeFromPriceLevel). That ordering is what
	// lets "Cheap Eats" safely yield nothing: a cheap venue whose format Google
	// actually knows has already been classified by the time price is reached.
	{activitiessvc.CategoryRestaurants, "fast_casual", []string{"fast_food_restaurant", "cafeteria", "meal_takeaway", "food_court"}, ""},
	{activitiessvc.CategoryRestaurants, "street_food", nil, "street food"},
	{activitiessvc.CategoryRestaurants, "bakery_dessert", []string{"dessert_restaurant", "dessert_shop", "donut_shop", "ice_cream_shop", "chocolate_shop", "candy_store", "confectionery", "pastry_shop", "cake_shop"}, ""},
	{activitiessvc.CategoryRestaurants, "", []string{"meal_delivery"}, ""},

	// Cafés
	{activitiessvc.CategoryCafes, "coffee_shop", []string{"coffee_shop"}, ""},
	{activitiessvc.CategoryCafes, "tea_house", []string{"tea_house"}, ""},
	{activitiessvc.CategoryCafes, "bakery_cafe", []string{"bakery"}, ""},
	{activitiessvc.CategoryCafes, "", []string{"cafe", "cat_cafe", "dog_cafe", "internet_cafe"}, ""},

	// Bars (classification-only — see the file comment above)
	{activitiessvc.CategoryBars, "cocktail_bar", []string{"cocktail_bar"}, ""},
	{activitiessvc.CategoryBars, "wine_bar", []string{"wine_bar"}, ""},
	{activitiessvc.CategoryBars, "brewery", []string{"brewery", "beer_garden"}, ""},
	{activitiessvc.CategoryBars, "sports_bar", []string{"sports_bar"}, ""},
	{activitiessvc.CategoryBars, "pub", []string{"pub", "irish_pub"}, ""},
	// shisha and kafana are filled by namemap.Subtype, not by a Google type.
	// hookah_bar is the precise Table A type for these venues, but a type may
	// appear on exactly one row and Bars never runs discovery, so it lives on
	// the Nightlife shisha_lounge row below where it actually finds venues.
	// These two TextQuery rows therefore never run and never yield — expected
	// coverage-test bookkeeping, same as the street_food row above.
	{activitiessvc.CategoryBars, "shisha", nil, "shisha bar"},
	{activitiessvc.CategoryBars, "kafana", nil, "kafana"},
	{activitiessvc.CategoryBars, "", []string{"bar"}, ""},

	// Nightlife
	{activitiessvc.CategoryNightlife, "nightclub", []string{"night_club"}, ""},
	{activitiessvc.CategoryNightlife, "live_music_venue", []string{"concert_hall", "amphitheatre"}, ""},
	{activitiessvc.CategoryNightlife, "lounge", nil, "cocktail lounge"},
	// Verified live 2026-08-05: searchNearby on includedTypes ["hookah_bar"]
	// in Belgrade returned three exact hits, every one with primaryType
	// hookah_bar, none of them already stored. Nightlife is in
	// GoogleCategories, so unlike the Bars shisha row this one runs forward
	// and discovers new venues rather than only labelling known ones.
	{activitiessvc.CategoryNightlife, "shisha_lounge", []string{"hookah_bar"}, ""},
	// This TextQuery row runs forward in every Google-synced cell worldwide,
	// not just Serbia — searchText "kafana" is a fuzzy match with no locale
	// gate. When a returned venue's primaryType maps to no subtype, subtypeFor
	// falls back to row.Subtype (see subtypeFor's doc), which can stamp
	// "kafana_live" on a non-Serbian venue this row happened to return.
	// Same accepted failure mode as the "lounge" row above (495 rows) — ships
	// anyway, but a future reader should know the fallback isn't precise here.
	{activitiessvc.CategoryNightlife, "kafana_live", nil, "kafana"},
	{activitiessvc.CategoryNightlife, "", []string{"karaoke", "comedy_club", "dance_hall"}, ""},

	// Nature
	{activitiessvc.CategoryNature, "hiking_trail", []string{"hiking_area", "national_park", "state_park"}, ""},
	{activitiessvc.CategoryNature, "park", []string{"park", "dog_park", "picnic_ground"}, ""},
	{activitiessvc.CategoryNature, "beach", []string{"beach"}, ""},
	{activitiessvc.CategoryNature, "botanical_garden", []string{"botanical_garden"}, ""},
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
	return m
}()

// CategoryForType resolves a Google primaryType to the one Google-discovered
// category whose discovery row(s) use it — the category-level analogue of
// Subtype, and the arbitration signal service.syncGoogleRow uses to decide
// whether a discovered venue belongs to the row that found it (see that
// function's doc for the tradeoff this exists to accept). Returns false when
// primaryType maps to nothing, matching Subtype's "never a guess" contract.
//
// Deliberately scoped to GoogleCategories, unlike typeToSubtype: its only
// caller is venueWrongCategory, arbitrating between rows that discovery
// actually runs. Indexing Restaurants/Bars types here too would let a
// Google-discovered venue (found by, say, a Nature row) get reclassified
// into Restaurants/Bars purely because its primaryType happens to also
// appear on a classification-only row — and since Google never discovers
// those two categories, venueWrongCategory would then skip the venue with no
// row left to ever re-ingest it. Restaurants/Bars types still classify fine
// through Subtype/typeToSubtype, which has a different, single caller
// (Tripadvisor venues, never Google-discovered ones).
func CategoryForType(primaryType string) (activitiessvc.Category, bool) {
	cat, ok := typeToCategory[primaryType]
	return cat, ok
}

// typeToCategory is DiscoveryRows read backward at the category level, but
// only over GoogleCategories rows (see CategoryForType's doc for why) —
// every Types entry on a Google-discovered row's category maps to it,
// including that category's category-level row (Subtype ""). Unlike
// typeToSubtype, there's no fallback-loop ambiguity to protect against here,
// since CategoryForType has no types[] fallback to short-circuit.
// TestDiscoveryRows_TypesAreUnambiguous already guarantees every Types
// string in the table belongs to exactly one row, so this mapping is total
// and unambiguous over its scoped rows — no separate uniqueness check needed
// here.
var typeToCategory = func() map[string]activitiessvc.Category {
	m := make(map[string]activitiessvc.Category)
	for _, r := range DiscoveryRows {
		if !slices.Contains(GoogleCategories, r.Category) {
			continue
		}
		for _, ty := range r.Types {
			m[ty] = r.Category
		}
	}
	return m
}()

// DiscoveryGroup merges every Types-based DiscoveryRow within one category
// into a single unit of search work, so one searchNearby call can carry
// every member row's includedTypes at once (T8, places-api-cost-reduction).
// subtypeFor (service/googlesync.go) already classifies a returned venue
// from its own primaryType via typeToSubtype before it ever falls back to a
// row's Subtype, so merging the type lists several rows search with does not
// change which subtype a mapped venue gets — it only cuts how many
// searchNearby calls find them.
//
// A TextQuery row (Types == nil) can't join a group: searchNearby has no
// phrase-search equivalent, so it stays its own single-row group, unchanged
// from today's one-call-per-row behaviour.
type DiscoveryGroup struct {
	Category activitiessvc.Category
	// Types is the union of every member row's Types, in DiscoveryRows
	// order. Empty exactly when this is a single TextQuery row's group.
	Types []string
	// Rows are the member DiscoveryRows this group's one search covers —
	// exactly one for a TextQuery group, one or more for a Types group.
	// Kept so the caller can mark every member (category, subtype) synced
	// after a shared search, not just a representative one.
	Rows []DiscoveryRow
}

// DiscoveryGroups is DiscoveryRows grouped by category for search execution:
// every Types-based row in a category shares one group (in the order its
// first row appears), every TextQuery row keeps its own single-row group.
// Built once at init from DiscoveryRows, same pattern as typeToSubtype, so
// the two tables cannot drift.
var DiscoveryGroups = func() []DiscoveryGroup {
	merged := map[activitiessvc.Category]int{} // category -> index into groups of its merged Types group
	var groups []DiscoveryGroup
	for _, r := range DiscoveryRows {
		if len(r.Types) == 0 {
			groups = append(groups, DiscoveryGroup{Category: r.Category, Rows: []DiscoveryRow{r}})
			continue
		}
		if i, ok := merged[r.Category]; ok {
			groups[i].Types = append(groups[i].Types, r.Types...)
			groups[i].Rows = append(groups[i].Rows, r)
			continue
		}
		merged[r.Category] = len(groups)
		groups = append(groups, DiscoveryGroup{
			Category: r.Category,
			Types:    append([]string{}, r.Types...),
			Rows:     []DiscoveryRow{r},
		})
	}
	return groups
}()

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
