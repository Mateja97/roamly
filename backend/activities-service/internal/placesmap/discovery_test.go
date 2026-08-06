package placesmap

import (
	"testing"

	"backend/shared/models/activitiessvc"
)

// TestDiscoveryRows_CoversEveryGoogleSubtype is the guarantee this whole
// design rests on: adding a subtype to BUSINESS_STANDARDS.md without giving
// it a discovery source turns the build red.
//
// The two directions cover different sets on purpose: classification
// (asserted here) spans every category except tours_experiences, including
// Restaurants and Bars, while discovery (TestGoogleDueRows_
// NeverSchedulesRestaurantsOrBars, service package) stays limited to
// GoogleCategories. This test's job is only the classification side.
func TestDiscoveryRows_CoversEveryGoogleSubtype(t *testing.T) {
	covered := map[string]int{}
	for _, r := range DiscoveryRows {
		covered[string(r.Category)+"|"+r.Subtype]++
	}
	classifyCategories := append(append([]activitiessvc.Category{}, GoogleCategories...),
		activitiessvc.CategoryRestaurants, activitiessvc.CategoryBars)
	for _, cat := range classifyCategories {
		for _, sub := range activitiessvc.Subcategories[cat] {
			key := string(cat) + "|" + sub
			if covered[key] != 1 {
				t.Errorf("subtype %s/%s has %d discovery rows, want exactly 1", cat, sub, covered[key])
			}
		}
		if covered[string(cat)+"|"] != 1 {
			t.Errorf("category %s has %d category-level (subtype \"\") rows, want exactly 1", cat, covered[string(cat)+"|"])
		}
	}

	// tours_experiences stays deliberately unsourced: no row at all, not
	// even a category-level one.
	for _, sub := range activitiessvc.Subcategories[activitiessvc.CategoryToursExperiences] {
		key := string(activitiessvc.CategoryToursExperiences) + "|" + sub
		if covered[key] != 0 {
			t.Errorf("tours_experiences/%s has %d discovery rows, want 0 — no provider yet", sub, covered[key])
		}
	}
	if n := covered[string(activitiessvc.CategoryToursExperiences)+"|"]; n != 0 {
		t.Errorf("tours_experiences has %d category-level rows, want 0 — no provider yet", n)
	}
}

// TestDiscoveryRows_EveryCategoryHasASource catches the same bug one level
// up: a new category added to the taxonomy and left silently without a
// provider.
func TestDiscoveryRows_EveryCategoryHasASource(t *testing.T) {
	sourced := map[activitiessvc.Category]bool{}
	for _, c := range GoogleCategories {
		sourced[c] = true
	}
	for _, c := range []activitiessvc.Category{
		activitiessvc.CategoryRestaurants, activitiessvc.CategoryBars, // Tripadvisor-exclusive
		activitiessvc.CategoryToursExperiences, // knowingly unsourced, see spec
	} {
		if sourced[c] {
			t.Errorf("category %s is both Google-sourced and listed as non-Google", c)
		}
		sourced[c] = true
	}
	for cat := range activitiessvc.Subcategories {
		if !sourced[cat] {
			t.Errorf("category %s has no declared data source", cat)
		}
	}
}

// TestDiscoveryRows_SubtypesAreValid catches slug typos at test time rather
// than as a silently empty subcategory in production.
func TestDiscoveryRows_SubtypesAreValid(t *testing.T) {
	for _, r := range DiscoveryRows {
		if !activitiessvc.ValidSubcategory(r.Category, r.Subtype) {
			t.Errorf("row %s/%s: subtype not valid for its category", r.Category, r.Subtype)
		}
	}
}

// TestDiscoveryRows_TypesAreUnambiguous protects the inverted (classification)
// direction: a Google type on two rows would make Subtype pick whichever came
// first, which is a guess.
func TestDiscoveryRows_TypesAreUnambiguous(t *testing.T) {
	owner := map[string]string{}
	for _, r := range DiscoveryRows {
		for _, ty := range r.Types {
			key := string(r.Category) + "/" + r.Subtype
			if prev, ok := owner[ty]; ok {
				t.Errorf("Google type %q claimed by both %s and %s", ty, prev, key)
			}
			owner[ty] = key
		}
	}
}

// TestCategoryForType_RestaurantsAndBarsTypesDoNotMap pins the fix for the
// critical review finding on this table: typeToCategory (unlike
// typeToSubtype) must stay scoped to GoogleCategories. If it indexed
// Restaurants/Bars rows too, a Google-discovered venue whose primaryType is
// one of these would get arbitrated OUT of its Google-discovered category by
// venueWrongCategory (googlesync.go) — into a category Google never
// discovers, with no row left to ever re-ingest it.
func TestCategoryForType_RestaurantsAndBarsTypesDoNotMap(t *testing.T) {
	for _, ty := range []string{
		"bar", "pub", "cocktail_bar", "wine_bar", "brewery", "sports_bar", "beer_garden",
		"fine_dining_restaurant", "fast_food_restaurant", "family_restaurant",
		"ice_cream_shop", "candy_store", "pastry_shop", "meal_takeaway",
	} {
		if cat, ok := CategoryForType(ty); ok {
			t.Errorf("CategoryForType(%q) = (%q, true), want ok=false — Restaurants/Bars types classify via Subtype only, never via CategoryForType", ty, cat)
		}
	}
}

// TestDiscoveryRows_ExactlyOneDiscoveryMethod: a row searches by type or by
// phrase, never both and never neither.
func TestDiscoveryRows_ExactlyOneDiscoveryMethod(t *testing.T) {
	for _, r := range DiscoveryRows {
		hasTypes, hasQuery := len(r.Types) > 0, r.TextQuery != ""
		if hasTypes == hasQuery {
			t.Errorf("row %s/%s: has types=%v textQuery=%v, want exactly one", r.Category, r.Subtype, hasTypes, hasQuery)
		}
	}
}

// TestPassesFloor is the dry run's and the live sync's shared quality gate,
// tuned from real neighbourhood venues rather than restaurant-era guesswork.
func TestPassesFloor(t *testing.T) {
	tests := []struct {
		name  string
		place Place
		want  bool
	}{
		{"clears both floors", Place{Rating: 4.2, UserRatingCount: 40}, true},
		{"exactly on both floors", Place{Rating: MinRating, UserRatingCount: MinReviews}, true},
		{"rating too low", Place{Rating: 3.4, UserRatingCount: 500}, false},
		{"too few reviews", Place{Rating: 4.9, UserRatingCount: 4}, false},
		{"unrated venue", Place{Rating: 0, UserRatingCount: 0}, false},
		// The old floors were 4.0/50, tuned for restaurants. A real
		// neighbourhood viewpoint looks like this and must survive, or
		// type-driven discovery surfaces subtypes the filter then deletes.
		{"thin-but-real viewpoint", Place{Rating: 4.4, UserRatingCount: 12}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PassesFloor(tt.place); got != tt.want {
				t.Errorf("PassesFloor(%+v) = %v, want %v", tt.place, got, tt.want)
			}
		})
	}
}

// TestToursExperiences_HasNoDiscoverySource makes a contractual constraint
// fail the build instead of living in a document someone skims.
//
// Tours & Experiences has no provider and cannot get one. GetYourGuide is the
// obvious candidate, and their Partner T&Cs §4.2.2(iii) forbid copying,
// storing, caching or building a database of their content, while §4.2.2(v)
// forbids intermixing it with other sources — so their tours can never become
// rows sorted and filtered beside Google and Tripadvisor venues. See
// BUSINESS_STANDARDS.md's "Tours & Experiences will stay row-less".
//
// The failure mode this guards against is specific and plausible: the category
// looks provider-less by omission rather than by contract, adding a provider is
// the obvious next feature, and internal/tripadvisor sits right there as a
// template. An autonomous pipeline run would reach for it immediately.
//
// Scope, stated plainly so this isn't mistaken for total coverage: it guards
// the Google discovery table and the sync schedule. A standalone provider
// package added the way internal/tripadvisor was — routed by the hardcoded
// category switches in internal/service/activity.go — would bypass it
// entirely and keep this test green. Extending the guard there would mean
// asserting against a switch statement, which is more brittle than it is
// worth; the backstop for that path is BUSINESS_STANDARDS.md and review.
//
// If this test ever fails, the fix is almost certainly to delete the new
// discovery row — not to relax the test. Changing it means someone has decided
// to breach the partner terms, which is a decision for a human with the
// contract in front of them.
func TestDiscoveryRows_NeverSourcesToursExperiences(t *testing.T) {
	for _, r := range DiscoveryRows {
		if r.Category == activitiessvc.CategoryToursExperiences {
			t.Errorf("DiscoveryRows contains a tours_experiences row (subtype %q): the category is "+
				"contractually row-less, see BUSINESS_STANDARDS.md", r.Subtype)
		}
	}

	for _, c := range GoogleCategories {
		if c == activitiessvc.CategoryToursExperiences {
			t.Error("GoogleCategories includes tours_experiences: it must never be scheduled for sync")
		}
	}

	// The subtypes stay in the taxonomy on purpose — they describe the
	// category and would be used by Roamly-authored editorial tours, which
	// carry no partner constraints. Their presence must not be read as a
	// gap waiting for a discovery row to fill.
	if len(activitiessvc.Subcategories[activitiessvc.CategoryToursExperiences]) == 0 {
		t.Error("tours_experiences lost its subtypes: they are the taxonomy, not a discovery TODO")
	}
}
