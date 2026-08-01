package placesmap

import (
	"encoding/json"
	"testing"

	"backend/shared/models/activitiessvc"
)

// TestPlace_UnmarshalsMachineType proves Place parses the Places API's
// machine-readable primaryType/types fields (distinct from the localized
// primaryTypeDisplayName label), not just the display name.
func TestPlace_UnmarshalsMachineType(t *testing.T) {
	raw := []byte(`{
		"id": "places/abc123",
		"displayName": {"text": "Buena Vida Beograd"},
		"primaryTypeDisplayName": {"text": "Restaurant"},
		"primaryType": "fine_dining_restaurant",
		"types": ["fine_dining_restaurant", "restaurant", "food", "point_of_interest"]
	}`)
	var p Place
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.PrimaryType != "fine_dining_restaurant" {
		t.Errorf("PrimaryType = %q, want %q", p.PrimaryType, "fine_dining_restaurant")
	}
	if len(p.Types) != 4 || p.Types[0] != "fine_dining_restaurant" {
		t.Errorf("Types = %v, want 4 entries starting with fine_dining_restaurant", p.Types)
	}
}

// weekdayHours builds a RegularOpeningHours open 09:00–17:00 every day.
func weekdayHours() RegularOpeningHours {
	var roh RegularOpeningHours
	roh.WeekdayDescriptions = []string{"Monday: 9AM-5PM"}
	for d := 0; d < 7; d++ {
		roh.Periods = append(roh.Periods, placePeriod{
			Open:  placeDayTime{Day: d, Hour: 9, Minute: 0},
			Close: &placeDayTime{Day: d, Hour: 17, Minute: 0},
		})
	}
	return roh
}

func TestBuildOpeningHours(t *testing.T) {
	// Unknown country -> nil (the honest miss, not a fabricated zone).
	if oh := buildOpeningHours("Atlantis", weekdayHours()); oh != nil {
		t.Errorf("unknown country: got %+v, want nil", oh)
	}

	// Normal week -> 7 valid periods, correct zero-padding + day name.
	oh := buildOpeningHours("Serbia", weekdayHours())
	if oh == nil {
		t.Fatal("Serbia weekday place: got nil")
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
	always := RegularOpeningHours{Periods: []placePeriod{{Open: placeDayTime{Day: 0, Hour: 0, Minute: 0}, Close: nil}}}
	if oh := buildOpeningHours("Serbia", always); oh == nil || !oh.AlwaysOpen || len(oh.Periods) != 0 {
		t.Errorf("24/7: got %+v, want always_open with no periods", oh)
	}

	// One-sided period (open, no close) that is NOT the 24/7 sentinel -> skipped -> nil.
	oneSided := RegularOpeningHours{Periods: []placePeriod{{Open: placeDayTime{Day: 3, Hour: 20, Minute: 0}, Close: nil}}}
	if oh := buildOpeningHours("Serbia", oneSided); oh != nil {
		t.Errorf("one-sided: got %+v, want nil", oh)
	}

	// Midnight cross preserved (close < open).
	cross := RegularOpeningHours{Periods: []placePeriod{{Open: placeDayTime{Day: 5, Hour: 20, Minute: 0}, Close: &placeDayTime{Day: 6, Hour: 2, Minute: 0}}}}
	ohc := buildOpeningHours("Serbia", cross)
	if ohc == nil || len(ohc.Periods) != 1 || ohc.Periods[0].Open != "20:00" || ohc.Periods[0].Close != "02:00" || ohc.Periods[0].Day != activitiessvc.Friday {
		t.Errorf("midnight cross: got %+v", ohc)
	}
}
