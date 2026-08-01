package activitiessvc

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestCategoryValid(t *testing.T) {
	if !CategoryCafes.Valid() {
		t.Error("cafes should be valid")
	}
	if !CategoryToursExperiences.Valid() {
		t.Error("tours_experiences should be valid")
	}
	if Category("food_and_drink").Valid() {
		t.Error("retired category should be invalid")
	}
	if Category("").Valid() {
		t.Error("empty category should be invalid")
	}
}

func TestValidSubcategory(t *testing.T) {
	tests := []struct {
		name string
		cat  Category
		sub  string
		want bool
	}{
		{"valid subtype for category", CategoryRestaurants, "fine_dining", true},
		{"wrong-category subtype", CategoryRestaurants, "cocktail_bar", false},
		{"empty subtype always valid", CategoryRestaurants, "", true},
		{"empty subtype valid for unknown category too", Category("bogus"), "", true},
		{"unknown subtype", CategoryRestaurants, "not_a_real_subtype", false},
		{"new category's own subtype", CategoryToursExperiences, "walking_tour", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ValidSubcategory(tt.cat, tt.sub); got != tt.want {
				t.Errorf("ValidSubcategory(%q, %q) = %v, want %v", tt.cat, tt.sub, got, tt.want)
			}
		})
	}
}

// TestBarDetails_RoundTripsTripadvisorAttribution proves the Tripadvisor/
// Reviews/Phone/Subratings additions are additive-only JSONB fields, same
// precedent as every other details extension in this package: absent on a
// pre-change row, populated end-to-end when set.
func TestBarDetails_RoundTripsTripadvisorAttribution(t *testing.T) {
	want := BarDetails{
		Tripadvisor: &TripadvisorAttribution{
			RatingImageURL: "https://www.tripadvisor.com/img/cdsi/ratings/4.5.svg",
			ReviewCount:    612,
			RankingText:    "#12 of 1,780 Restaurants in Belgrade, as rated by Tripadvisor travelers as of July 2026",
			WebURL:         "https://www.tripadvisor.com/Restaurant_Review-x",
			Phone:          "+381 11 234 5678",
			Subratings: &TripadvisorSubratings{
				Food:       &TripadvisorAspectRating{Rating: 4.5, IconURL: "https://ta/food.svg"},
				Service:    &TripadvisorAspectRating{Rating: 4.0, IconURL: "https://ta/service.svg"},
				Value:      &TripadvisorAspectRating{Rating: 4.0, IconURL: "https://ta/value.svg"},
				Atmosphere: &TripadvisorAspectRating{Rating: 4.5, IconURL: "https://ta/atmosphere.svg"},
			},
			Award:      &TripadvisorAward{Name: "Travelers' Choice", Year: 2026},
			PriceLevel: "Mid Range",
			Cuisine:    "Fine Dining",
		},
		Reviews: []TripadvisorReview{
			{Rating: 5, Date: "2026-06-14", Text: "Great rakia.", RatingImageURL: "https://ta/review1.svg"},
			{Rating: 5, Date: "2026-05-02", Text: "Loved the terrace."},
		},
	}

	data, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("Marshal() error: %v", err)
	}
	var got BarDetails
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}
	// Tripadvisor now carries a pointer field (Subratings), so a plain !=
	// would compare pointer identity rather than value — reflect.DeepEqual
	// is the right tool here, not a struct literal comparison.
	if !reflect.DeepEqual(got, want) {
		t.Errorf("round trip = %+v, want %+v", got, want)
	}
}

func TestWellnessDetails_RoundTripsNewFields(t *testing.T) {
	url := "https://example-spa.rs"
	want := WellnessDetails{
		Treatments: []Treatment{
			{Item: "Aroma massage", Duration: "50 min", Price: "€39"},
		},
		ExternalBookingNote: "Booking is handled on the venue's own site",
		ActionURL:           &url,
		VenueType:           "Spa",
		TypicalVisit:        "2–3 hrs",
		PriceFrom:           "from €22",
		GoodToKnow:          []string{"Towel, robe and slippers included"},
		OpeningHours: &OpeningHours{
			Timezone: "Europe/Belgrade",
			Periods:  []Period{{Day: Monday, Open: "09:00", Close: "22:00"}},
		},
	}

	data, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("Marshal() error: %v", err)
	}
	var got WellnessDetails
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("round trip = %+v, want %+v", got, want)
	}
}

func TestEntertainmentDetails_RoundTripsNewFields(t *testing.T) {
	url := "https://example-theatre.rs"
	want := EntertainmentDetails{
		Genre:        "Live music",
		Neighborhood: "Dorćol",
		UpcomingShows: []Show{
			{Date: "2026-08-18", Title: "Jazz Night: Bilja Krstić", TimeOrPrice: "20:00 · from €15"},
		},
		ActionURL:          &url,
		TypicalShowLength:  "2 hrs",
		PriceFrom:          "from €12",
		GoodToKnow:         []string{"Unnumbered seating — arrive early"},
		OpeningHours: &OpeningHours{
			Timezone: "Europe/Belgrade",
			Periods:  []Period{{Day: Friday, Open: "19:00", Close: "23:00"}},
		},
	}

	data, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("Marshal() error: %v", err)
	}
	var got EntertainmentDetails
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("round trip = %+v, want %+v", got, want)
	}
}

func TestSportDetails_RoundTripsDifficultyInferred(t *testing.T) {
	want := SportDetails{
		Difficulty:         4,
		DifficultyInferred: true,
		EffortLevel:        "High intensity",
		Duration:           "90 min",
		Gear:               "Climbing shoes provided",
		WhatToBring:        []string{"Water bottle", "Comfortable clothes"},
		Discipline:         "Climbing",
	}

	data, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("Marshal() error: %v", err)
	}
	var got SportDetails
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("round trip = %+v, want %+v", got, want)
	}
}

func TestSportDetails_DifficultyInferredOmittedWhenFalse(t *testing.T) {
	admin := SportDetails{Difficulty: 3, EffortLevel: "Moderate"}
	data, err := json.Marshal(admin)
	if err != nil {
		t.Fatalf("Marshal() error: %v", err)
	}
	if strings.Contains(string(data), "difficulty_inferred") {
		t.Errorf("marshaled admin-set difficulty = %s, want no difficulty_inferred key when false", data)
	}
}

func TestRestaurantDetails_LegacyRowWithNoTripadvisorFieldDecodesCleanly(t *testing.T) {
	raw := `{"cuisine":"Balkan","price_tier":"$$"}`

	var d RestaurantDetails
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}
	if d.Tripadvisor != nil || d.Reviews != nil {
		t.Errorf("RestaurantDetails = %+v, want Tripadvisor/Reviews nil for a pre-change row", d)
	}
}
