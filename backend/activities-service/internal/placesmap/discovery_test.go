package placesmap

import (
	"testing"

	"backend/shared/models/activitiessvc"
)

// TestDiscoveryRows_CoversEveryGoogleSubtype is the guarantee this whole
// design rests on: adding a subtype to BUSINESS_STANDARDS.md without giving
// it a discovery source turns the build red.
func TestDiscoveryRows_CoversEveryGoogleSubtype(t *testing.T) {
	covered := map[string]int{}
	for _, r := range DiscoveryRows {
		covered[string(r.Category)+"|"+r.Subtype]++
	}
	for _, cat := range GoogleCategories {
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
