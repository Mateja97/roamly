// Package placesmap maps a Google Places (New) place onto the category-specific
// details payload each activity category defines (activitiessvc). Shared by
// cmd/scrapecity (at scrape time) and cmd/fixdetails (backfill from stored raw)
// so the "which field, which category" rule lives in exactly one place.
package placesmap

import (
	"encoding/json"
	"strings"

	"backend/shared/models/activitiessvc"
)

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
		Name string `json:"name"`
	} `json:"photos"`
	RegularOpeningHours struct {
		WeekdayDescriptions []string `json:"weekdayDescriptions"`
	} `json:"regularOpeningHours"`
	PrimaryTypeDisplayName struct {
		Text string `json:"text"`
	} `json:"primaryTypeDisplayName"`
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

// BuildDetails writes each Places-sourced value under the field name the target
// category's detail struct actually defines. Places sources only free-text
// hours, a price tier, and a venue-type label; categories whose fields Places
// can't source (Bars, Nature, Sport, Kids, Entertainment) get an empty payload
// here — those await the enrichment pass. Every field is omitted when its
// source is empty.
func BuildDetails(cat activitiessvc.Category, p Place) json.RawMessage {
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

	switch cat {
	case activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes:
		set("hours", hours)
		set("price_tier", PriceTier(p.PriceLevel))
	case activitiessvc.CategoryCulture, activitiessvc.CategoryArt, activitiessvc.CategoryShopping:
		set("hours", hours)
		set("venue_type", p.PrimaryTypeDisplayName.Text)
	case activitiessvc.CategoryNightlife, activitiessvc.CategoryWellness:
		set("venue_type", p.PrimaryTypeDisplayName.Text)
	}

	b, err := json.Marshal(d)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}
