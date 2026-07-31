// Package placesmap maps a Google Places (New) place onto the category-specific
// details payload each activity category defines (activitiessvc). Shared by
// cmd/scrapecity (at scrape time) and cmd/fixdetails (backfill from stored raw)
// so the "which field, which category" rule lives in exactly one place.
//
// T1 (places-live-details): Places Terms §14.3 forbids caching anything but
// place_id/lat-lng, so BuildDetails (scrape time) no longer stores hours,
// price, venue-type or rating — see BuildLiveDetails, the on-view sibling
// that maps a live Place Details response (PlaceDetail) into the same
// per-category shapes, fetched fresh on every detail-page open and never
// persisted.
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

// localizedText is the Places API's recurring `{text, languageCode}` shape —
// primaryTypeDisplayName, editorialSummary, generativeSummary.overview, and a
// review's text all take this form. Only Text matters to this pipeline
// (languageCode is unused: callers always request one language).
type localizedText struct {
	Text string `json:"text"`
}

// RegularOpeningHours is a place's regular weekly hours, the same wire shape
// consumed by Place (scrape time, discovery only) and PlaceDetail (live) —
// named so both can share it instead of duplicating the struct.
type RegularOpeningHours struct {
	WeekdayDescriptions []string      `json:"weekdayDescriptions"`
	Periods             []placePeriod `json:"periods"`
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
	RegularOpeningHours    RegularOpeningHours `json:"regularOpeningHours"`
	PrimaryTypeDisplayName localizedText       `json:"primaryTypeDisplayName"`
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

// buildOpeningHours converts a Places regularOpeningHours block into the
// structured activitiessvc.OpeningHours shape, or nil. It always returns a
// value that passes service.validateOpeningHours: a real IANA timezone,
// zero-padded HH:MM times, valid weekday names, and never always_open=false
// with no periods. Periods without a close time are skipped (never fabricate
// a close); the sole 24/7 sentinel (one open at Sunday 00:00, no close)
// becomes always_open. Shared by BuildLiveDetails (city comes from the
// activity's stored city; roh from the live PlaceDetail).
func buildOpeningHours(city string, roh RegularOpeningHours) *activitiessvc.OpeningHours {
	tz := TimezoneForCity(city)
	if tz == "" {
		return nil
	}
	periods := roh.Periods
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

// BuildDetails is the scrape-time mapper. Places Terms §14.3 permits caching
// only place_id and lat/lng — hours, price tier, venue type and structured
// opening hours (this function's entire former output) are not storable, so
// it now always returns "{}". Kept, rather than deleted or inlined at its two
// call sites (cmd/scrapecity, cmd/fixdetails), so neither needs a change; see
// BuildLiveDetails for the live, on-view mapper that replaces what this used
// to store.
func BuildDetails(_ activitiessvc.Category, _ string, _ Place) json.RawMessage {
	return json.RawMessage("{}")
}

// AuthorAttribution is the Places attribution Google's terms require
// wherever live review or photo content renders: avatar (photo), display
// name, and a profile link.
type AuthorAttribution struct {
	DisplayName string `json:"displayName"`
	PhotoURI    string `json:"photoUri"`
	URI         string `json:"uri"`
}

// Review is one Places review (max 5 returned), reviewer-attributed per
// Google's policy — never storable, rendered live alongside a
// GoogleAttributionPlate (T5).
type Review struct {
	AuthorAttribution AuthorAttribution `json:"authorAttribution"`
	Rating            float64           `json:"rating"`
	Text              localizedText     `json:"text"`
	PublishTime       string            `json:"publishTime"`
}

// Money is the Places API's currency amount shape (priceRange's start/end).
type Money struct {
	CurrencyCode string `json:"currencyCode"`
	Units        string `json:"units"`
	Nanos        int    `json:"nanos"`
}

// PriceRange is a min/max Money band. Captured for wire-shape parity (the
// spec's "priceLevel, priceRange" price-tier source) but not yet consumed by
// BuildLiveDetails — none of the 10 Places-sourced categories has a generic
// price-chip field to hold it (only Restaurants do, and Restaurants are
// Tripadvisor-sourced, out of scope here).
type PriceRange struct {
	StartPrice Money `json:"startPrice"`
	EndPrice   Money `json:"endPrice"`
}

// amenityBooleans decodes a Places nested amenity object (parkingOptions:
// several named parking-kind booleans; accessibilityOptions: several named
// wheelchair-access booleans) generically instead of naming every sub-field —
// BuildLiveDetails only ever needs "is there something to say" (any), never
// which specific kind, so a real response carrying either field still
// decodes without one struct per shape.
type amenityBooleans map[string]bool

func (m amenityBooleans) any() bool {
	for _, v := range m {
		if v {
			return true
		}
	}
	return false
}

// PlaceDetail is the subset of a Google Place Details (New) response
// BuildLiveDetails needs — a wider sibling of Place (scrape time), not a
// modification of it, so the scrape path (Place, BuildDetails) is untouched.
// None of this is ever persisted (Places Terms §14.3): places.Client.
// PlaceDetails fetches it fresh on every detail-page open.
//
// EditorialSummary, GenerativeSummary.Overview and Reviews[].Text expose the
// Places API's nested `{text, languageCode}` shape (localizedText) rather
// than a flat string — Place already decodes several such nested wire shapes
// directly (Location, DisplayName), and a flat string field would fail to
// decode Google's real response. Read the description as
// d.EditorialSummary.Text, falling back to d.GenerativeSummary.Overview.Text
// when empty (T2's merge order).
type PlaceDetail struct {
	Rating                 float64             `json:"rating"`
	UserRatingCount        int                 `json:"userRatingCount"`
	PriceLevel             string              `json:"priceLevel"`
	PriceRange             PriceRange          `json:"priceRange"`
	GoogleMapsURI          string              `json:"googleMapsUri"`
	WebsiteURI             string              `json:"websiteUri"`
	RegularOpeningHours    RegularOpeningHours `json:"regularOpeningHours"`
	PrimaryTypeDisplayName localizedText       `json:"primaryTypeDisplayName"`
	EditorialSummary       localizedText       `json:"editorialSummary"`
	GenerativeSummary      struct {
		Overview localizedText `json:"overview"`
	} `json:"generativeSummary"`
	Reviews []Review `json:"reviews"`

	// Amenity booleans (spec's "Sourceable" table). ParkingOptions and
	// AccessibilityOptions are the two exceptions modeled as amenityBooleans
	// maps above — every other amenity really is a plain wire boolean.
	GoodForChildren      bool            `json:"goodForChildren"`
	GoodForGroups        bool            `json:"goodForGroups"`
	AllowsDogs           bool            `json:"allowsDogs"`
	Restroom             bool            `json:"restroom"`
	OutdoorSeating       bool            `json:"outdoorSeating"`
	LiveMusic            bool            `json:"liveMusic"`
	ParkingOptions       amenityBooleans `json:"parkingOptions"`
	AccessibilityOptions amenityBooleans `json:"accessibilityOptions"`
	ServesCoffee         bool            `json:"servesCoffee"`
	ServesVegetarianFood bool            `json:"servesVegetarianFood"`
	MenuForChildren      bool            `json:"menuForChildren"`
	DineIn               bool            `json:"dineIn"`
	Takeout              bool            `json:"takeout"`
	Reservable           bool            `json:"reservable"`
}

// amenityFlag pairs one amenity's truth value with its display label.
// amenityLabels is the one helper natureGoodToKnow/kidsFacilities/
// cafeKnownFor below all share: true-valued pairs become the section's
// items, in order; nothing true -> nil, so BuildLiveDetails' own setList
// omits the key entirely rather than rendering an empty list.
type amenityFlag struct {
	ok    bool
	label string
}

func amenityLabels(flags ...amenityFlag) []string {
	var out []string
	for _, f := range flags {
		if f.ok {
			out = append(out, f.label)
		}
	}
	return out
}

// natureGoodToKnow picks the amenities relevant to Nature's "Good to know"
// checklist (design-spec.md's unique-section table). Curated, not every
// amenity Places can return — e.g. servesCoffee doesn't belong on a hiking
// trail.
func natureGoodToKnow(d PlaceDetail) []string {
	return amenityLabels(
		amenityFlag{d.GoodForChildren, "Good for children"},
		amenityFlag{d.AllowsDogs, "Dog friendly"},
		amenityFlag{d.Restroom, "Restroom available"},
		amenityFlag{d.AccessibilityOptions.any(), "Wheelchair accessible"},
		amenityFlag{d.ParkingOptions.any(), "Parking available"},
	)
}

// kidsFacilities picks the amenities relevant to Kids' "Facilities" checklist.
func kidsFacilities(d PlaceDetail) []string {
	return amenityLabels(
		amenityFlag{d.GoodForChildren, "Good for children"},
		amenityFlag{d.MenuForChildren, "Kids' menu available"},
		amenityFlag{d.Restroom, "Restroom available"},
		amenityFlag{d.ParkingOptions.any(), "Parking available"},
		amenityFlag{d.AccessibilityOptions.any(), "Wheelchair accessible"},
	)
}

// cafeKnownFor picks the amenities relevant to Cafes' "Known for" pills,
// replacing the unsourceable on-the-bar menu list.
func cafeKnownFor(d PlaceDetail) []string {
	return amenityLabels(
		amenityFlag{d.ServesCoffee, "Serves coffee"},
		amenityFlag{d.ServesVegetarianFood, "Vegetarian options"},
		amenityFlag{d.OutdoorSeating, "Outdoor seating"},
		amenityFlag{d.AllowsDogs, "Dog friendly"},
		amenityFlag{d.GoodForGroups, "Good for groups"},
		amenityFlag{d.DineIn, "Dine-in"},
		amenityFlag{d.Takeout, "Takeout"},
		amenityFlag{d.Reservable, "Reservations"},
	)
}

// BuildLiveDetails maps a live Place Details response onto the details
// payload for one of the 10 Places-sourced categories (Restaurants and Bars
// are Tripadvisor-sourced and have no case here). This is the on-view
// counterpart to BuildDetails: same "which field, which category" shape, but
// nothing it writes is ever persisted (Places Terms §14.3) — call it fresh
// on every detail-page open. Header-level fields (rating, review count,
// description, reviews) live on Activity itself, not in this payload (T2's
// merge); Sport and Entertainment have no sourceable Details content at all
// and always return "{}". Every field is omitted, not blanked, when its
// source is empty/false/absent — including the every-false and
// every-absent amenity cases, which are indistinguishable in Go's zero-value
// bool and so behave identically (both omit the section).
func BuildLiveDetails(cat activitiessvc.Category, city string, d PlaceDetail) json.RawMessage {
	out := map[string]any{}
	set := func(key, val string) {
		if val != "" {
			out[key] = val
		}
	}
	setList := func(key string, vals []string) {
		if len(vals) > 0 {
			out[key] = vals
		}
	}
	setOpeningHours := func() {
		if oh := buildOpeningHours(city, d.RegularOpeningHours); oh != nil {
			out["opening_hours"] = oh
		}
	}
	hours := ""
	if len(d.RegularOpeningHours.WeekdayDescriptions) > 0 {
		hours = strings.Join(d.RegularOpeningHours.WeekdayDescriptions, "; ")
	}
	venueType := d.PrimaryTypeDisplayName.Text

	switch cat {
	case activitiessvc.CategoryCafes:
		set("hours", hours)
		setOpeningHours()
		setList("known_for", cafeKnownFor(d))
	case activitiessvc.CategoryNightlife:
		set("venue_type", venueType)
		setOpeningHours()
	case activitiessvc.CategoryNature:
		setList("good_to_know", natureGoodToKnow(d))
	case activitiessvc.CategoryKids:
		setList("facilities", kidsFacilities(d))
	case activitiessvc.CategoryCulture, activitiessvc.CategoryArt, activitiessvc.CategoryShopping:
		set("hours", hours)
		set("venue_type", venueType)
		setOpeningHours()
	case activitiessvc.CategoryWellness:
		set("venue_type", venueType)
	}
	// Sport, Entertainment: no case -> always "{}".

	b, err := json.Marshal(out)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}
