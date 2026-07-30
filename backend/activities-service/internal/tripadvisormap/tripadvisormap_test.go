package tripadvisormap_test

import (
	"testing"

	"activities-service/internal/tripadvisormap"

	"backend/shared/models/activitiessvc"
)

func TestSubtype(t *testing.T) {
	tests := []struct {
		name          string
		category      activitiessvc.Category
		subcategories []string
		want          string
	}{
		{"maps a known bar tag", activitiessvc.CategoryBars, []string{"wine_bar"}, "wine_bar"},
		{"maps a known restaurant tag", activitiessvc.CategoryRestaurants, []string{"fine_dining"}, "fine_dining"},
		{"skips a tag valid for the wrong category", activitiessvc.CategoryBars, []string{"fine_dining"}, ""},
		{"falls through multiple tags to the first mappable one", activitiessvc.CategoryBars, []string{"unknown_tag", "sports_bar"}, "sports_bar"},
		{"unmapped tag returns empty, never a guess", activitiessvc.CategoryBars, []string{"casual_hangout"}, ""},
		{"no tags returns empty", activitiessvc.CategoryRestaurants, nil, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tripadvisormap.Subtype(tt.category, tt.subcategories); got != tt.want {
				t.Errorf("Subtype(%q, %v) = %q, want %q", tt.category, tt.subcategories, got, tt.want)
			}
		})
	}
}

// TestCategory covers the nine real venues named in the classification task
// plus case and diacritic variants, proving the heuristic survives both.
func TestCategory(t *testing.T) {
	tests := []struct {
		name  string
		venue string
		want  activitiessvc.Category
	}{
		{"bar: Gradska Pivnica Terazije (pivnica)", "Gradska Pivnica Terazije", activitiessvc.CategoryBars},
		{"cafe: Aviator Coffee Explorer (coffee)", "Aviator Coffee Explorer", activitiessvc.CategoryCafes},
		{"restaurant: Inferno Pizza", "Inferno Pizza", activitiessvc.CategoryRestaurants},
		{"restaurant: John's Grill", "John's Grill", activitiessvc.CategoryRestaurants},
		{"restaurant: Tad's Steakhouse", "Tad's Steakhouse", activitiessvc.CategoryRestaurants},
		{"restaurant: Chips & Love", "Chips & Love", activitiessvc.CategoryRestaurants},
		{"restaurant: Mashallah Halal Pakistani Food Restaurant", "Mashallah Halal Pakistani Food Restaurant", activitiessvc.CategoryRestaurants},
		{"restaurant: O' By Claude Le Tohic", "O' By Claude Le Tohic", activitiessvc.CategoryRestaurants},
		{"restaurant: Bodega SF (no false 'bar' substring match)", "Bodega SF", activitiessvc.CategoryRestaurants},

		{"case-insensitive bar keyword", "GRADSKA PIVNICA TERAZIJE", activitiessvc.CategoryBars},
		{"case-insensitive cafe keyword", "aviator COFFEE explorer", activitiessvc.CategoryCafes},
		{"diacritic bar keyword: kafana", "Stara Kafana", activitiessvc.CategoryBars},
		{"diacritic cafe keyword: accented cafe", "Café de Paris", activitiessvc.CategoryCafes},
		{"diacritic cafe keyword: poslastičarnica", "Poslastičarnica Trpković", activitiessvc.CategoryCafes},
		{"cafe checked before bar when both keywords present", "Coffee & Wine Bar", activitiessvc.CategoryCafes},

		// BUSINESS_STANDARDS.md lists "Tea House" as a Cafés subtype, so the
		// keyword set has to cover it. The word-boundary anchors are what keep
		// "tea" from matching inside "S-tea-khouse" — the Steakhouse case above
		// is the regression guard for that, don't drop it.
		{"cafe: tea house", "Belgrade Tea House", activitiessvc.CategoryCafes},
		{"cafe: tearoom (one word)", "The Old Tearoom", activitiessvc.CategoryCafes},
		{"restaurant: 'tea' inside another word must not match", "Steakhouse Nikola", activitiessvc.CategoryRestaurants},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tripadvisormap.Category(tt.venue); got != tt.want {
				t.Errorf("Category(%q) = %q, want %q", tt.venue, got, tt.want)
			}
		})
	}
}
