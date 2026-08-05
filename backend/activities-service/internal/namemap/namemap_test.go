package namemap_test

import (
	"testing"

	"activities-service/internal/namemap"

	"backend/shared/models/activitiessvc"
)

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
			if got := namemap.Category(tt.venue); got != tt.want {
				t.Errorf("Category(%q) = %q, want %q", tt.venue, got, tt.want)
			}
		})
	}
}

// TestSubtype covers real venue names taken from the live database, so a
// regression here is a regression against actual stored data rather than
// against invented examples.
func TestSubtype(t *testing.T) {
	tests := []struct {
		name         string
		cat          activitiessvc.Category
		venue        string
		wantSlug     string
		wantOverride bool
	}{
		// Local overrides — these beat a Google answer.
		{"shisha, english spelling", activitiessvc.CategoryBars, "Caffe Shisha Bar Tranquila", "shisha", true},
		{"shisha, serbian spelling nargila", activitiessvc.CategoryCafes, "Caffe Monroe & Nargila Bar", "", false},
		{"nargila under nightlife", activitiessvc.CategoryNightlife, "Muar Lounge Nargila&Bar", "shisha_lounge", true},
		{"hookah spelling", activitiessvc.CategoryNightlife, "Hookah House | Lounge Bar", "shisha_lounge", true},
		{"kafana under bars", activitiessvc.CategoryBars, "Kafana Balkan", "kafana", true},
		{"kafana under nightlife", activitiessvc.CategoryNightlife, "Kafana Moskva", "kafana_live", true},
		{"mehana is a kafana", activitiessvc.CategoryBars, "Cadjava Mehana", "kafana", true},

		// Local rules are checked before generic ones.
		{"shisha beats cocktail in the same name", activitiessvc.CategoryNightlife, "VIBE LOUNGE shisha & cocktail bar", "shisha_lounge", true},

		// Generic fallbacks — never override, so override is false.
		{"pivnica means brewery", activitiessvc.CategoryBars, "Gradska Pivnica Terazije", "brewery", false},
		{"brewery in english", activitiessvc.CategoryBars, "Zebraonica & Zebrew Brewery", "brewery", false},
		{"pub", activitiessvc.CategoryBars, "Jackson Pub", "pub", false},

		// Category gating: a slug is only offered where it is declared.
		{"mehana under culture yields nothing", activitiessvc.CategoryCulture, "Stara Mehana", "", false},
		{"kafana under sport yields nothing", activitiessvc.CategorySport, "Kafana Lovac", "", false},
		{"pub is not a nightlife slug", activitiessvc.CategoryNightlife, "Jackson Pub", "", false},

		// Case and diacritics, same contract as Category.
		{"uppercase", activitiessvc.CategoryBars, "KAFANA JUGOSLAVIJA", "kafana", true},
		{"diacritics folded", activitiessvc.CategoryBars, "Kafana Raskućin", "kafana", true},

		// Word boundaries: no substring false positives.
		{"pub does not match inside a word", activitiessvc.CategoryBars, "Republic Bar", "", false},
		{"no keyword at all", activitiessvc.CategoryBars, "Gotham Bar", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			slug, override := namemap.Subtype(tt.cat, tt.venue)
			if slug != tt.wantSlug || override != tt.wantOverride {
				t.Errorf("Subtype(%q, %q) = (%q, %v), want (%q, %v)",
					tt.cat, tt.venue, slug, override, tt.wantSlug, tt.wantOverride)
			}
		})
	}
}

// TestSubtype_OnlyReturnsValidSlugs is a belt-and-braces guard: every slug
// the rule table can produce must pass ValidSubcategory for the category it
// is offered under, so a typo in the table cannot produce a slug the rest of
// the system will reject at write time.
func TestSubtype_OnlyReturnsValidSlugs(t *testing.T) {
	venues := []string{
		"Caffe Shisha Bar Tranquila", "Kafana Balkan", "Gradska Pivnica Terazije",
		"Jackson Pub", "Monkey Cocktail Bar", "Wine Bar Vinoteka",
	}
	for cat := range activitiessvc.Subcategories {
		for _, v := range venues {
			slug, _ := namemap.Subtype(cat, v)
			if !activitiessvc.ValidSubcategory(cat, slug) {
				t.Errorf("Subtype(%q, %q) returned %q, which is not valid for that category", cat, v, slug)
			}
		}
	}
}
