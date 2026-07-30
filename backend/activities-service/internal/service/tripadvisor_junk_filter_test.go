package service

import "testing"

// TestHasFoodDrinkSignal covers Tripadvisor's own venue-type classification
// as carried in web_url's path: the nine legitimate venues named in the
// classification task (all Restaurant_Review), the junk venues a
// price_level/subrating-based gate used to admit or reject inconsistently
// (Disney Store and Spa in Hotel Moskva are Attraction_Review; Hotel Zelos
// and citizenM San Francisco Union Square are Hotel_Review), and the
// false-negative case the old gate got wrong: a brand-new restaurant with
// zero reviews and no price_level/subratings, which still carries a
// Restaurant_Review URL and must survive. The gate now runs on the nearby
// summary's WebURL (same urls.tripadvisor.main value LocationDetails
// carries), so the input is the URL string itself.
func TestHasFoodDrinkSignal(t *testing.T) {
	tests := []struct {
		name   string
		webURL string
		want   bool
	}{
		// The nine legitimate venues named in the classification task —
		// every real eatery is Restaurant_Review regardless of what
		// price_level/subratings/review_count happen to be set.
		{"legit: Gradska Pivnica Terazije", "https://www.tripadvisor.com/Restaurant_Review-g295424-d1-Reviews-Gradska_Pivnica_Terazije-Belgrade.html", true},
		{"legit: Aviator Coffee Explorer", "https://www.tripadvisor.com/Restaurant_Review-g295424-d2-Reviews-Aviator_Coffee_Explorer-Belgrade.html", true},
		{"legit: Inferno Pizza", "https://www.tripadvisor.com/Restaurant_Review-g295424-d3-Reviews-Inferno_Pizza-Belgrade.html", true},
		{"legit: John's Grill", "https://www.tripadvisor.com/Restaurant_Review-g60713-d4-Reviews-Johns_Grill-San_Francisco.html", true},
		{"legit: Tad's Steakhouse", "https://www.tripadvisor.com/Restaurant_Review-g60713-d5-Reviews-Tads_Steakhouse-San_Francisco.html", true},
		{"legit: Chips & Love", "https://www.tripadvisor.com/Restaurant_Review-g295424-d6-Reviews-Chips_Love-Belgrade.html", true},
		{"legit: Mashallah Halal Pakistani Food Restaurant", "https://www.tripadvisor.com/Restaurant_Review-g60713-d7-Reviews-Mashallah-San_Francisco.html", true},
		{"legit: O' By Claude Le Tohic", "https://www.tripadvisor.com/Restaurant_Review-g60713-d8-Reviews-O_By_Claude_Le_Tohic-San_Francisco.html", true},
		{"legit: Bodega SF", "https://www.tripadvisor.com/Restaurant_Review-g60713-d9-Reviews-Bodega_SF-San_Francisco.html", true},

		// The junk sample: real venues Terra's non-filtering nearby-search
		// returns, correctly rejected by their own Tripadvisor venue type.
		{"junk: Disney Store (Attraction_Review)", "https://www.tripadvisor.com/Attraction_Review-g60713-d10-Reviews-Disney_Store-San_Francisco.html", false},
		{"junk: Spa in Hotel Moskva (Attraction_Review)", "https://www.tripadvisor.com/Attraction_Review-g295424-d11-Reviews-Spa_in_Hotel_Moskva-Belgrade.html", false},
		{"junk: Hotel Zelos (Hotel_Review)", "https://www.tripadvisor.com/Hotel_Review-g60713-d12-Reviews-Hotel_Zelos-San_Francisco.html", false},
		{"junk: citizenM San Francisco Union Square (Hotel_Review)", "https://www.tripadvisor.com/Hotel_Review-g60713-d13-Reviews-citizenM-San_Francisco.html", false},
		{"junk: Tim Kombi Prevoz Putnika (no web_url at all)", "", false},

		// The case a price_level/subrating gate got wrong: a brand-new
		// restaurant with zero reviews and neither field populated still
		// carries a Restaurant_Review URL, so it must survive.
		{"boundary: brand-new restaurant, zero reviews, no price_level/subratings, still kept", "https://www.tripadvisor.com/Restaurant_Review-g295424-d14-Reviews-Brand_New_Place-Belgrade.html", true},

		// Defensive parsing: malformed/empty web_url rejected, not a
		// substring match on the venue name.
		{"boundary: malformed web_url rejected", "://not a url", false},
		{"boundary: URL text elsewhere in the path doesn't spoof a segment match", "https://www.tripadvisor.com/Attraction_Review-g295424-d15-Reviews-The_Restaurant_Review_Lounge-Belgrade.html", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hasFoodDrinkSignal(tt.webURL); got != tt.want {
				t.Errorf("hasFoodDrinkSignal(%q) = %v, want %v", tt.webURL, got, tt.want)
			}
		})
	}
}
