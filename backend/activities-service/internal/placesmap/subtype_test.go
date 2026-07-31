package placesmap

import (
	"testing"

	"backend/shared/models/activitiessvc"
)

// TestSubtype_AllMappedEntriesValid is T2's runnable check that every
// curated (primaryType -> subtype) entry actually passes
// activitiessvc.ValidSubcategory for the category Subtype would be called
// with in practice — a typo here would otherwise silently never fire (the
// ValidSubcategory gate in Subtype would just skip it), not error loudly.
//
// typeToSubtype (discovery.go) replaced placeTypeToSubtype as Subtype's data
// source; this test now validates that index instead. Reaching into an
// unexported package var from a test is a deliberate, human-approved
// exception to GO_STANDARDS' "test through exported APIs" rule for this
// package — see task-1-brief.md.
func TestSubtype_AllMappedEntriesValid(t *testing.T) {
	for placeType, sub := range typeToSubtype {
		var owner activitiessvc.Category
		for cat, subs := range activitiessvc.Subcategories {
			for _, s := range subs {
				if s == sub {
					owner = cat
				}
			}
		}
		if owner == "" {
			t.Errorf("placeTypeToSubtype[%q] = %q, which is not in any category's Subcategories list", placeType, sub)
			continue
		}
		if !activitiessvc.ValidSubcategory(owner, sub) {
			t.Errorf("ValidSubcategory(%q, %q) = false, want true", owner, sub)
		}
	}
}

func TestSubtype(t *testing.T) {
	tests := []struct {
		name        string
		cat         activitiessvc.Category
		primaryType string
		types       []string
		want        string
	}{
		{
			name:        "mapped primaryType yields its subtype",
			cat:         activitiessvc.CategoryRestaurants,
			primaryType: "fine_dining_restaurant",
			want:        "fine_dining",
		},
		{
			name:        "mapped primaryType for its category, bars",
			cat:         activitiessvc.CategoryBars,
			primaryType: "cocktail_bar",
			want:        "cocktail_bar",
		},
		{
			name:        "unmapped primaryType, no types fallback, yields empty",
			cat:         activitiessvc.CategoryRestaurants,
			primaryType: "restaurant",
			want:        "",
		},
		{
			name:        "empty primaryType and types yields empty",
			cat:         activitiessvc.CategoryRestaurants,
			primaryType: "",
			want:        "",
		},
		{
			name:        "unmapped primaryType falls back to first mappable types entry",
			cat:         activitiessvc.CategoryBars,
			primaryType: "bar",
			types:       []string{"bar", "wine_bar", "point_of_interest"},
			want:        "wine_bar",
		},
		{
			name:        "primaryType maps but not for this category, falls through to empty",
			cat:         activitiessvc.CategoryRestaurants,
			primaryType: "cocktail_bar", // cocktail_bar belongs to CategoryBars, not Restaurants
			want:        "",
		},
		{
			name:        "primaryType maps but not for this category, types fallback also rejected",
			cat:         activitiessvc.CategoryRestaurants,
			primaryType: "cocktail_bar",
			types:       []string{"cocktail_bar", "wine_bar"}, // both bars-only subtypes
			want:        "",
		},
		{
			name:        "specific museum type resolves the generic museum ambiguity",
			cat:         activitiessvc.CategoryArt,
			primaryType: "art_museum",
			want:        "art_museum",
		},
		{
			name:        "generic museum type is deliberately unmapped",
			cat:         activitiessvc.CategoryCulture,
			primaryType: "museum",
			want:        "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Subtype(tc.cat, tc.primaryType, tc.types); got != tc.want {
				t.Errorf("Subtype(%q, %q, %v) = %q, want %q", tc.cat, tc.primaryType, tc.types, got, tc.want)
			}
		})
	}
}
