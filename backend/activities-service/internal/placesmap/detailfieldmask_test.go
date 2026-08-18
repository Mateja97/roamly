package placesmap_test

import (
	"slices"
	"strings"
	"testing"

	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

// wantDetailFields is the independently-authored expectation for
// DetailFieldMask(cat): the header fields every live-merge needs (rating,
// userRatingCount, googleMapsUri, reviews/editorialSummary/
// generativeSummary — every category alike, see DetailFieldMask's doc on why
// Sport is no longer special-cased out of these) union'd with exactly the
// fields that category's BuildLiveDetails switch case reads (cross-check
// against placesmap.go's own switch above). Kept separate from
// categoryDetailFields in placesmap.go on purpose — comparing against a
// second, independently-written list is what makes this a real regression
// test instead of a tautology against the implementation it's checking.
func wantDetailFields(cat activitiessvc.Category) []string {
	header := []string{
		"rating", "userRatingCount", "googleMapsUri",
		"reviews", "reviews.authorAttribution", "editorialSummary", "generativeSummary",
	}
	extra := map[activitiessvc.Category][]string{
		activitiessvc.CategoryCafes: {
			"regularOpeningHours", "websiteUri",
			"servesCoffee", "servesVegetarianFood", "outdoorSeating", "allowsDogs",
			"goodForGroups", "dineIn", "takeout", "reservable",
		},
		activitiessvc.CategoryNightlife: {"primaryTypeDisplayName", "regularOpeningHours"},
		activitiessvc.CategoryNature: {
			"websiteUri", "goodForChildren", "allowsDogs", "restroom", "accessibilityOptions", "parkingOptions",
		},
		activitiessvc.CategoryKids: {
			"websiteUri", "goodForChildren", "menuForChildren", "restroom", "parkingOptions", "accessibilityOptions",
		},
		activitiessvc.CategoryCulture:       {"regularOpeningHours", "primaryTypeDisplayName", "websiteUri"},
		activitiessvc.CategoryArt:           {"regularOpeningHours", "primaryTypeDisplayName", "websiteUri"},
		activitiessvc.CategoryShopping:      {"regularOpeningHours", "primaryTypeDisplayName", "websiteUri"},
		activitiessvc.CategoryWellness:      {"primaryTypeDisplayName", "websiteUri", "regularOpeningHours"},
		activitiessvc.CategoryEntertainment: {"websiteUri", "regularOpeningHours"},
		// CategorySport: no BuildLiveDetails case, no extra fields.
	}
	return append(header, extra[cat]...)
}

func TestDetailFieldMask_OneMaskPerCategory(t *testing.T) {
	tests := []activitiessvc.Category{
		activitiessvc.CategoryCafes, activitiessvc.CategoryNightlife, activitiessvc.CategoryNature,
		activitiessvc.CategorySport, activitiessvc.CategoryKids, activitiessvc.CategoryCulture,
		activitiessvc.CategoryArt, activitiessvc.CategoryWellness, activitiessvc.CategoryShopping,
		activitiessvc.CategoryEntertainment,
	}

	for _, cat := range tests {
		t.Run(string(cat), func(t *testing.T) {
			got := strings.Split(placesmap.DetailFieldMask(cat), ",")
			want := wantDetailFields(cat)

			for _, f := range got {
				if !slices.Contains(want, f) {
					t.Errorf("DetailFieldMask(%s) requests %q, which %s's rendered detail payload never uses", cat, f, cat)
				}
			}
			for _, f := range want {
				if !slices.Contains(got, f) {
					t.Errorf("DetailFieldMask(%s) missing %q, which %s's rendered detail payload uses", cat, f, cat)
				}
			}
		})
	}
}

// No TestDetailFieldMask_SportDropsEnterpriseAtmosphere here (round-2
// review): dropping Sport out of Enterprise+Atmosphere broke its live
// reviews/description card (a real AC4 violation), because
// withLiveDetails' header merge is category-blind and every one of the 10
// Places-sourced categories renders that same card — see DetailFieldMask's
// doc for the full trace and the AC3 escalation.

func TestReviewFieldMask_OnlyMergedFields(t *testing.T) {
	got := strings.Split(placesmap.ReviewFieldMask, ",")
	want := []string{"rating", "userRatingCount", "reviews", "reviews.authorAttribution", "googleMapsUri"}
	if len(got) != len(want) {
		t.Fatalf("ReviewFieldMask = %v, want exactly %v", got, want)
	}
	for _, f := range want {
		if !slices.Contains(got, f) {
			t.Errorf("ReviewFieldMask %v missing %q", got, f)
		}
	}
	// Never the category-specific or Description-feeding fields —
	// withTripadvisorGoogleReviews touches neither.
	for _, f := range []string{"editorialSummary", "generativeSummary", "websiteUri", "regularOpeningHours", "priceLevel"} {
		if slices.Contains(got, f) {
			t.Errorf("ReviewFieldMask %v must not contain %q", got, f)
		}
	}
}
