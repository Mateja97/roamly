// Package placesmap maps a Google Places (New) place onto the category-specific
// details payload each activity category defines (activitiessvc). Shared by
// cmd/scrapecity (at scrape time) and cmd/fixdetails (backfill from stored raw)
// so the "which field, which category" rule lives in exactly one place.
package placesmap

import (
	"encoding/json"
	"fmt"
	"strings"

	"backend/shared/models/activitiessvc"
)

// placeDayTime is one edge of a Places opening period. Day is 0=Sunday … 6=Saturday.
type placeDayTime struct {
	Day    int `json:"day"`
	Hour   int `json:"hour"`
	Minute int `json:"minute"`
}

// placePeriod is one Places opening period. Close is nil for the 24/7 sentinel.
type placePeriod struct {
	Open  placeDayTime  `json:"open"`
	Close *placeDayTime `json:"close"`
}

// Place is the subset of a Places API (New) place the pipeline consumes.
type Place struct {
	ID          string `json:"id"`
	DisplayName struct {
		Text string `json:"text"`
	} `json:"displayName"`
	Location struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"location"`
	FormattedAddress string  `json:"formattedAddress"`
	Rating           float64 `json:"rating"`
	UserRatingCount  int     `json:"userRatingCount"`
	PriceLevel       string  `json:"priceLevel"`
	GoogleMapsURI    string  `json:"googleMapsUri"`
	Photos           []struct {
		Name               string `json:"name"`
		AuthorAttributions []struct {
			DisplayName string `json:"displayName"`
			URI         string `json:"uri"`
		} `json:"authorAttributions"`
	} `json:"photos"`
	RegularOpeningHours struct {
		WeekdayDescriptions []string      `json:"weekdayDescriptions"`
		Periods             []placePeriod `json:"periods"`
	} `json:"regularOpeningHours"`
	PrimaryTypeDisplayName struct {
		Text string `json:"text"`
	} `json:"primaryTypeDisplayName"`
	// PrimaryType and Types are the machine-readable Places type taxonomy
	// (e.g. "fine_dining_restaurant"), distinct from PrimaryTypeDisplayName's
	// localized label. Captured for a future subtype mapping (see T2); not
	// consumed by BuildDetails.
	PrimaryType string   `json:"primaryType"`
	Types       []string `json:"types"`
}

// cityTimezones maps a scraped city to its IANA zone, the timezone structured
// opening_hours are evaluated against. One line per city we ingest; an unknown
// city yields no opening_hours (free-text hours still stands).
var cityTimezones = map[string]string{
	"Belgrade": "Europe/Belgrade",
}

// TimezoneForCity returns the IANA zone for city, or "" if unknown.
func TimezoneForCity(city string) string { return cityTimezones[city] }

// placeDayNames maps Places' 0=Sunday … 6=Saturday onto the model's weekday names.
var placeDayNames = [7]activitiessvc.DayOfWeek{
	activitiessvc.Sunday, activitiessvc.Monday, activitiessvc.Tuesday,
	activitiessvc.Wednesday, activitiessvc.Thursday, activitiessvc.Friday,
	activitiessvc.Saturday,
}

func hhmm(t placeDayTime) string { return fmt.Sprintf("%02d:%02d", t.Hour, t.Minute) }

func validClock(t placeDayTime) bool {
	return t.Day >= 0 && t.Day <= 6 && t.Hour >= 0 && t.Hour <= 23 && t.Minute >= 0 && t.Minute <= 59
}

// PriceTier maps the Places priceLevel enum onto the $/$$/$$$ tiers the
// food/drink detail shapes use; unknown/absent → "".
func PriceTier(level string) string {
	switch level {
	case "PRICE_LEVEL_INEXPENSIVE":
		return "$"
	case "PRICE_LEVEL_MODERATE":
		return "$$"
	case "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE":
		return "$$$"
	}
	return ""
}

// buildOpeningHours converts a Place's Places periods into the structured
// activitiessvc.OpeningHours shape, or nil. It always returns a value that
// passes service.validateOpeningHours: a real IANA timezone, zero-padded HH:MM
// times, valid weekday names, and never always_open=false with no periods.
// Periods without a close time are skipped (never fabricate a close); the sole
// 24/7 sentinel (one open at Sunday 00:00, no close) becomes always_open.
func buildOpeningHours(city string, p Place) *activitiessvc.OpeningHours {
	tz := TimezoneForCity(city)
	if tz == "" {
		return nil
	}
	periods := p.RegularOpeningHours.Periods
	if len(periods) == 0 {
		return nil
	}
	if len(periods) == 1 && periods[0].Close == nil &&
		periods[0].Open.Day == 0 && periods[0].Open.Hour == 0 && periods[0].Open.Minute == 0 {
		return &activitiessvc.OpeningHours{Timezone: tz, AlwaysOpen: true}
	}
	var out []activitiessvc.Period
	for _, per := range periods {
		if per.Close == nil || !validClock(per.Open) || !validClock(*per.Close) {
			continue
		}
		out = append(out, activitiessvc.Period{
			Day:   placeDayNames[per.Open.Day],
			Open:  hhmm(per.Open),
			Close: hhmm(*per.Close),
		})
	}
	if len(out) == 0 {
		return nil
	}
	return &activitiessvc.OpeningHours{Timezone: tz, Periods: out}
}

// BuildDetails writes each Places-sourced value under the field name the target
// category's detail struct actually defines (activitiessvc). Places sources
// free-text hours, a price tier, a venue-type label, and — for the 7 categories
// whose struct has the field — structured opening_hours (needs the city's IANA
// zone). Categories Places can't source get an empty payload. Every field is
// omitted when its source is empty/nil.
func BuildDetails(cat activitiessvc.Category, city string, p Place) json.RawMessage {
	d := map[string]any{}
	set := func(key, val string) {
		if val != "" {
			d[key] = val
		}
	}
	hours := ""
	if len(p.RegularOpeningHours.WeekdayDescriptions) > 0 {
		hours = strings.Join(p.RegularOpeningHours.WeekdayDescriptions, "; ")
	}
	venueType := p.PrimaryTypeDisplayName.Text
	setOpeningHours := func() {
		if oh := buildOpeningHours(city, p); oh != nil {
			d["opening_hours"] = oh
		}
	}

	switch cat {
	case activitiessvc.CategoryRestaurants:
		set("hours", hours)
		set("price_tier", PriceTier(p.PriceLevel))
		setOpeningHours()
	case activitiessvc.CategoryCafes:
		set("hours", hours)
		setOpeningHours()
	case activitiessvc.CategoryBars:
		setOpeningHours()
	case activitiessvc.CategoryNightlife:
		set("venue_type", venueType)
		setOpeningHours()
	case activitiessvc.CategoryCulture, activitiessvc.CategoryArt, activitiessvc.CategoryShopping:
		set("hours", hours)
		set("venue_type", venueType)
		setOpeningHours()
	case activitiessvc.CategoryWellness:
		set("venue_type", venueType)
	}

	b, err := json.Marshal(d)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}
