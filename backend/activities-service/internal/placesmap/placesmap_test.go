package placesmap

import (
	"encoding/json"
	"testing"

	"activities-service/internal/service"
	"backend/shared/models/activitiessvc"
)

func TestPriceTier(t *testing.T) {
	for in, want := range map[string]string{
		"PRICE_LEVEL_INEXPENSIVE":    "$",
		"PRICE_LEVEL_MODERATE":       "$$",
		"PRICE_LEVEL_EXPENSIVE":      "$$$",
		"PRICE_LEVEL_VERY_EXPENSIVE": "$$$",
		"":                           "",
		"PRICE_LEVEL_UNSPECIFIED":    "",
	} {
		if got := PriceTier(in); got != want {
			t.Errorf("PriceTier(%q) = %q, want %q", in, got, want)
		}
	}
}

// weekdayPlace builds a Place open 09:00–17:00 every day, in Belgrade.
func weekdayPlace() Place {
	var p Place
	p.PriceLevel = "PRICE_LEVEL_MODERATE"
	p.PrimaryTypeDisplayName.Text = "Museum"
	p.RegularOpeningHours.WeekdayDescriptions = []string{"Monday: 9AM-5PM"}
	for d := 0; d < 7; d++ {
		p.RegularOpeningHours.Periods = append(p.RegularOpeningHours.Periods, placePeriod{
			Open:  placeDayTime{Day: d, Hour: 9, Minute: 0},
			Close: &placeDayTime{Day: d, Hour: 17, Minute: 0},
		})
	}
	return p
}

func TestBuildOpeningHours(t *testing.T) {
	// Unknown city -> nil.
	if oh := buildOpeningHours("Atlantis", weekdayPlace()); oh != nil {
		t.Errorf("unknown city: got %+v, want nil", oh)
	}

	// Normal week -> 7 valid periods, correct zero-padding + day name.
	oh := buildOpeningHours("Belgrade", weekdayPlace())
	if oh == nil {
		t.Fatal("Belgrade weekday place: got nil")
	}
	if oh.Timezone != "Europe/Belgrade" {
		t.Errorf("timezone = %q, want Europe/Belgrade", oh.Timezone)
	}
	if len(oh.Periods) != 7 {
		t.Fatalf("periods = %d, want 7", len(oh.Periods))
	}
	if oh.Periods[0].Day != activitiessvc.Sunday || oh.Periods[0].Open != "09:00" || oh.Periods[0].Close != "17:00" {
		t.Errorf("period[0] = %+v, want sunday 09:00-17:00", oh.Periods[0])
	}

	// 24/7 sentinel -> always_open, no periods.
	var always Place
	always.RegularOpeningHours.Periods = []placePeriod{{Open: placeDayTime{Day: 0, Hour: 0, Minute: 0}, Close: nil}}
	if oh := buildOpeningHours("Belgrade", always); oh == nil || !oh.AlwaysOpen || len(oh.Periods) != 0 {
		t.Errorf("24/7: got %+v, want always_open with no periods", oh)
	}

	// One-sided period (open, no close) that is NOT the 24/7 sentinel -> skipped -> nil.
	var oneSided Place
	oneSided.RegularOpeningHours.Periods = []placePeriod{{Open: placeDayTime{Day: 3, Hour: 20, Minute: 0}, Close: nil}}
	if oh := buildOpeningHours("Belgrade", oneSided); oh != nil {
		t.Errorf("one-sided: got %+v, want nil", oh)
	}

	// Midnight cross preserved (close < open).
	var cross Place
	cross.RegularOpeningHours.Periods = []placePeriod{{Open: placeDayTime{Day: 5, Hour: 20, Minute: 0}, Close: &placeDayTime{Day: 6, Hour: 2, Minute: 0}}}
	ohc := buildOpeningHours("Belgrade", cross)
	if ohc == nil || len(ohc.Periods) != 1 || ohc.Periods[0].Open != "20:00" || ohc.Periods[0].Close != "02:00" || ohc.Periods[0].Day != activitiessvc.Friday {
		t.Errorf("midnight cross: got %+v", ohc)
	}
}

func TestBuildDetails(t *testing.T) {
	p := weekdayPlace()

	parse := func(t *testing.T, cat activitiessvc.Category) map[string]any {
		t.Helper()
		raw := BuildDetails(cat, "Belgrade", p)
		if err := service.ValidateDetails(cat, raw); err != nil {
			t.Fatalf("%s: ValidateDetails failed: %v", cat, err)
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("%s: invalid json: %v", cat, err)
		}
		return m
	}

	// Café: hours + opening_hours, NO price_tier (bug fix).
	c := parse(t, activitiessvc.CategoryCafes)
	if _, ok := c["hours"]; !ok {
		t.Error("cafe missing hours")
	}
	if _, ok := c["price_tier"]; ok {
		t.Error("cafe must NOT carry price_tier")
	}
	if _, ok := c["opening_hours"]; !ok {
		t.Error("cafe missing opening_hours")
	}

	// Restaurant: keeps price_tier + opening_hours.
	r := parse(t, activitiessvc.CategoryRestaurants)
	if r["price_tier"] != "$$" || r["opening_hours"] == nil {
		t.Errorf("restaurant = %v, want price_tier $$ + opening_hours", r)
	}

	// opening_hours present on all 7 supporting categories, absent on wellness.
	for _, cat := range []activitiessvc.Category{
		activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes, activitiessvc.CategoryBars,
		activitiessvc.CategoryNightlife, activitiessvc.CategoryCulture, activitiessvc.CategoryArt,
		activitiessvc.CategoryShopping,
	} {
		if _, ok := parse(t, cat)["opening_hours"]; !ok {
			t.Errorf("%s missing opening_hours", cat)
		}
	}
	if _, ok := parse(t, activitiessvc.CategoryWellness)["opening_hours"]; ok {
		t.Error("wellness must NOT carry opening_hours")
	}
}
