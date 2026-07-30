package service

import (
	"testing"

	"activities-service/internal/tripadvisor"
)

// TestHasFoodDrinkSignal covers the live-verified junk sample from the
// nearby-search category=RESTAURANT bug (Terra's category param doesn't
// actually filter), the legitimate venues it must not reject alongside
// them, and the boundary cases around tripadvisorJunkReviewFloor.
func TestHasFoodDrinkSignal(t *testing.T) {
	food := &tripadvisor.Aspect{Rating: 4.0}

	tests := []struct {
		name string
		d    tripadvisor.LocationDetails
		want bool
	}{
		// Live junk sample: no price_level, no subratings, low/no reviews.
		{"junk: Tim Kombi Prevoz Putnika (van transport)", tripadvisor.LocationDetails{Name: "Tim Kombi Prevoz Putnika", ReviewCount: 2}, false},
		{"junk: La Liberte Premium Car Solution (car rental)", tripadvisor.LocationDetails{Name: "La Liberte Premium Car Solution", ReviewCount: 1}, false},
		{"junk: Belgrade Photo & Video Studio", tripadvisor.LocationDetails{Name: "Belgrade Photo & Video Studio", ReviewCount: 3}, false},
		{"junk: Game Centar", tripadvisor.LocationDetails{Name: "Game Centar", ReviewCount: 0}, false},
		{"junk: Spomenik Obesenima Na Terazijama (monument)", tripadvisor.LocationDetails{Name: "Spomenik Obesenima Na Terazijama", ReviewCount: 5}, false},
		{"junk: Belgrade By Night (0 reviews)", tripadvisor.LocationDetails{Name: "Belgrade By Night", ReviewCount: 0}, false},

		// Live legitimate sample: real restaurants/bars/cafes.
		{"legit: Inferno Pizza (price_level)", tripadvisor.LocationDetails{Name: "Inferno Pizza", PriceLevel: "$$ - $$$", ReviewCount: 4}, true},
		{"legit: Gradska Pivnica Terazije (subrating)", tripadvisor.LocationDetails{Name: "Gradska Pivnica Terazije", Subratings: tripadvisor.Subratings{Food: food}, ReviewCount: 8}, true},
		{"legit: Aviator Coffee Explorer (review count)", tripadvisor.LocationDetails{Name: "Aviator Coffee Explorer", ReviewCount: 40}, true},
		{"legit: Chips & Love (price_level)", tripadvisor.LocationDetails{Name: "Chips & Love", PriceLevel: "$", ReviewCount: 6}, true},
		{"legit: Porto Maltese (subrating)", tripadvisor.LocationDetails{Name: "Porto Maltese", Subratings: tripadvisor.Subratings{Service: food}, ReviewCount: 15}, true},

		// Boundary cases.
		{"boundary: review count exactly at the floor passes", tripadvisor.LocationDetails{Name: "Exactly Ten", ReviewCount: tripadvisorJunkReviewFloor}, true},
		{"boundary: review count one below the floor fails", tripadvisor.LocationDetails{Name: "Just Under", ReviewCount: tripadvisorJunkReviewFloor - 1}, false},
		{"boundary: price_level present but zero reviews still passes", tripadvisor.LocationDetails{Name: "Brand New Place", PriceLevel: "$$", ReviewCount: 0}, true},
		{"boundary: subrating present but nothing else still passes", tripadvisor.LocationDetails{Name: "Just Opened", Subratings: tripadvisor.Subratings{Atmosphere: food}, ReviewCount: 0}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hasFoodDrinkSignal(tt.d); got != tt.want {
				t.Errorf("hasFoodDrinkSignal(%+v) = %v, want %v", tt.d, got, tt.want)
			}
		})
	}
}
