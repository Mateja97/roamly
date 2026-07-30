package service

import (
	"testing"

	"activities-service/internal/tripadvisor"
)

// TestHasFoodDrinkSignal covers the live-verified junk sample from the
// nearby-search category=RESTAURANT bug (Terra's category param doesn't
// actually filter), the nine legitimate venues the classification task
// named that must not be rejected alongside them, and the two review-heavy
// non-food venues (Disney Store, Spa in Hotel Moskva) the now-removed
// review-count fallback used to wrongly admit.
func TestHasFoodDrinkSignal(t *testing.T) {
	food := &tripadvisor.Aspect{Rating: 4.0}

	tests := []struct {
		name string
		d    tripadvisor.LocationDetails
		want bool
	}{
		// Live junk sample: no price_level, no subratings.
		{"junk: Tim Kombi Prevoz Putnika (van transport)", tripadvisor.LocationDetails{Name: "Tim Kombi Prevoz Putnika", ReviewCount: 2}, false},
		{"junk: La Liberte Premium Car Solution (car rental)", tripadvisor.LocationDetails{Name: "La Liberte Premium Car Solution", ReviewCount: 1}, false},
		{"junk: Belgrade Photo & Video Studio", tripadvisor.LocationDetails{Name: "Belgrade Photo & Video Studio", ReviewCount: 3}, false},
		{"junk: Game Centar", tripadvisor.LocationDetails{Name: "Game Centar", ReviewCount: 0}, false},
		{"junk: Spomenik Obesenima Na Terazijama (monument)", tripadvisor.LocationDetails{Name: "Spomenik Obesenima Na Terazijama", ReviewCount: 5}, false},
		{"junk: Belgrade By Night (0 reviews)", tripadvisor.LocationDetails{Name: "Belgrade By Night", ReviewCount: 0}, false},

		// Live junk sample the removed review-count fallback used to wrongly
		// admit: real, review-heavy venues with zero food/drink signal.
		{"junk: Disney Store (41 reviews, no food signal)", tripadvisor.LocationDetails{Name: "Disney Store", ReviewCount: 41}, false},
		{"junk: Spa in Hotel Moskva (10 reviews, no food signal)", tripadvisor.LocationDetails{Name: "Spa in Hotel Moskva", ReviewCount: 10}, false},

		// The nine legitimate venues named in the classification task.
		{"legit: Gradska Pivnica Terazije (subrating)", tripadvisor.LocationDetails{Name: "Gradska Pivnica Terazije", Subratings: tripadvisor.Subratings{Food: food}, ReviewCount: 8}, true},
		{"legit: Aviator Coffee Explorer (price_level)", tripadvisor.LocationDetails{Name: "Aviator Coffee Explorer", PriceLevel: "Cheap Eats", ReviewCount: 40}, true},
		{"legit: Inferno Pizza (price_level)", tripadvisor.LocationDetails{Name: "Inferno Pizza", PriceLevel: "$$ - $$$", ReviewCount: 4}, true},
		{"legit: John's Grill (subrating)", tripadvisor.LocationDetails{Name: "John's Grill", Subratings: tripadvisor.Subratings{Food: food}, ReviewCount: 20}, true},
		{"legit: Tad's Steakhouse (price_level)", tripadvisor.LocationDetails{Name: "Tad's Steakhouse", PriceLevel: "Fine Dining", ReviewCount: 30}, true},
		{"legit: Chips & Love (price_level)", tripadvisor.LocationDetails{Name: "Chips & Love", PriceLevel: "$", ReviewCount: 6}, true},
		{"legit: Mashallah Halal Pakistani Food Restaurant (subrating)", tripadvisor.LocationDetails{Name: "Mashallah Halal Pakistani Food Restaurant", Subratings: tripadvisor.Subratings{Food: food}, ReviewCount: 12}, true},
		{"legit: O' By Claude Le Tohic (price_level)", tripadvisor.LocationDetails{Name: "O' By Claude Le Tohic", PriceLevel: "Fine Dining", ReviewCount: 5}, true},
		{"legit: Bodega SF (subrating)", tripadvisor.LocationDetails{Name: "Bodega SF", Subratings: tripadvisor.Subratings{Service: food}, ReviewCount: 15}, true},

		// Boundary cases.
		{"boundary: price_level present but zero reviews still passes", tripadvisor.LocationDetails{Name: "Brand New Place", PriceLevel: "$$", ReviewCount: 0}, true},
		{"boundary: subrating present but nothing else still passes", tripadvisor.LocationDetails{Name: "Just Opened", Subratings: tripadvisor.Subratings{Atmosphere: food}, ReviewCount: 0}, true},
		{"boundary: high review count alone, no signal, now rejected", tripadvisor.LocationDetails{Name: "Popular But Not Food", ReviewCount: 1000}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hasFoodDrinkSignal(tt.d); got != tt.want {
				t.Errorf("hasFoodDrinkSignal(%+v) = %v, want %v", tt.d, got, tt.want)
			}
		})
	}
}
