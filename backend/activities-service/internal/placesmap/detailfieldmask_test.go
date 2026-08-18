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
// userRatingCount, googleMapsUri, plus reviews/editorialSummary/
// generativeSummary for every category except Sport) union'd with exactly
// the fields that category's BuildLiveDetails switch case reads (cross-check
// against placesmap.go's own switch above). Kept separate from
// categoryDetailFields in placesmap.go on purpose — comparing against a
// second, independently-written list is what makes this a real regression
// test instead of a tautology against the implementation it's checking.
func wantDetailFields(cat activitiessvc.Category) []string {
	header := []string{"rating", "userRatingCount", "googleMapsUri"}
	if cat != activitiessvc.CategorySport {
		header = append(header, "reviews", "reviews.authorAttribution", "editorialSummary", "generativeSummary")
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

// enterpriseAtmosphereFields are the fields that put a Place Details request
// in the Enterprise+Atmosphere SKU tier (T3, places-api-cost-reduction's own
// list): reviews, editorialSummary, generativeSummary, priceLevel/
// priceRange, and every amenity boolean BuildLiveDetails can read.
var enterpriseAtmosphereFields = []string{
	"reviews", "reviews.authorAttribution", "editorialSummary", "generativeSummary",
	"priceLevel", "priceRange",
	"goodForChildren", "goodForGroups", "allowsDogs", "restroom", "outdoorSeating",
	"liveMusic", "parkingOptions", "accessibilityOptions", "servesCoffee",
	"servesVegetarianFood", "menuForChildren", "dineIn", "takeout", "reservable",
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

// TestDetailFieldMask_SportDropsEnterpriseAtmosphere covers T3's acceptance
// criterion that at least one category's mask carries no
// Enterprise+Atmosphere field: Sport's BuildLiveDetails case is a no-op
// ("{}"), so its mask needs none of them (reviews, editorialSummary,
// generativeSummary, priceLevel, no amenity booleans) and drops out of the
// Enterprise+Atmosphere SKU tier down to Enterprise (rating/userRatingCount
// stay, for the header rating cluster every category still renders).
func TestDetailFieldMask_SportDropsEnterpriseAtmosphere(t *testing.T) {
	got := strings.Split(placesmap.DetailFieldMask(activitiessvc.CategorySport), ",")
	for _, f := range got {
		if slices.Contains(enterpriseAtmosphereFields, f) {
			t.Errorf("Sport's DetailFieldMask = %v, contains Enterprise+Atmosphere field %q", got, f)
		}
	}
}

// TestDetailFieldMask_EveryOtherCategoryStillCarriesReviews guards against
// silently widening Sport's carve-out to every category (which would defeat
// T3's cost cut for the categories that DO render Google reviews/description
// at the header level).
func TestDetailFieldMask_EveryOtherCategoryStillCarriesReviews(t *testing.T) {
	for cat := range activitiessvc.Subcategories {
		if cat == activitiessvc.CategorySport || cat == activitiessvc.CategoryRestaurants ||
			cat == activitiessvc.CategoryBars || cat == activitiessvc.CategoryToursExperiences {
			continue
		}
		mask := placesmap.DetailFieldMask(cat)
		if !strings.Contains(mask, "reviews") {
			t.Errorf("DetailFieldMask(%s) = %q, want it to still carry reviews", cat, mask)
		}
	}
}

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
