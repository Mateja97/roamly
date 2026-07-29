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
