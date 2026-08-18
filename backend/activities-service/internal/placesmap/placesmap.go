// Package placesmap maps a Google Places (New) place onto the category-specific
// details payload each activity category defines (activitiessvc), so the
// "which field, which category" rule lives in exactly one place.
//
// T1 (places-live-details): Places Terms §14.3 forbids caching anything but
// place_id/lat-lng, so scrape time (cmd/scrapecity, the lazy Google sync)
// stores none of hours, price, venue-type or rating — see BuildLiveDetails,
// the on-view mapper that maps a live Place Details response (PlaceDetail)
// into the per-category shapes, fetched fresh on every detail-page open and
// never persisted.
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

// RegularOpeningHours is a place's regular weekly hours (PlaceDetail's live
// wire shape) — named rather than inline so buildOpeningHours takes it
// directly.
type RegularOpeningHours struct {
	WeekdayDescriptions []string      `json:"weekdayDescriptions"`
	Periods             []placePeriod `json:"periods"`
}

// Place is the subset of a Places API (New) place the pipeline consumes at
// scrape time. Places Terms §14.3 forbids storing hours/price/venue-type, so
// Place itself carries none of those fields; only what discovery/filtering/
// photos still need.
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
	GoogleMapsURI    string  `json:"googleMapsUri"`
	Photos           []struct {
		Name               string `json:"name"`
		AuthorAttributions []struct {
			DisplayName string `json:"displayName"`
			URI         string `json:"uri"`
		} `json:"authorAttributions"`
	} `json:"photos"`
	// PrimaryType and Types are the machine-readable Places type taxonomy
	// (e.g. "fine_dining_restaurant"), distinct from a localized display
	// label. Consumed by Subtype (subtype.go).
	PrimaryType string   `json:"primaryType"`
	Types       []string `json:"types"`
	// AddressComponents is the place's structured address breakdown.
	// Unused for City/Country derivation — that fragmented one city into
	// eight stored strings when it fed a per-venue fallback (see
	// service.cellLocation's doc); city/country are now derived solely from
	// the sync cell's own reverse-geocoded coordinates
	// (places.Client.ReverseGeocodeCity). Kept only because Places (New)
	// still returns it and NearbyFieldMask still requests it at no extra
	// cost.
	AddressComponents []AddressComponent `json:"addressComponents"`
}

// AddressComponent is one segment of a Places API (New) structured address
// (e.g. {"longText": "Belgrade", "types": ["locality", "political"]}).
type AddressComponent struct {
	LongText  string   `json:"longText"`
	ShortText string   `json:"shortText"`
	Types     []string `json:"types"`
}

// countryTimezones maps a scraped country to its IANA zone, the timezone
// structured opening_hours are evaluated against. Keyed on country, not city:
// city is what Google actually varies on for a single place — the same
// Belgrade venue has shown up as "Beograd", "Belgrade", "Београд", "Novi
// Beograd" and "Борча" across sync cells, which missed this map for ~87% of
// rows when it was keyed on city. Country is stable across all of those.
//
// This is exact, not approximate, only because every country below is
// single-timezone. "Serbia": "Europe/Belgrade" holds for 100% of Serbian
// rows. It stops holding the moment a multi-timezone country is ingested —
// US, Canada, Brazil, Russia, Australia, Mexico, Indonesia all span more than
// one zone, so a single country->zone entry for any of them would be wrong
// for some fraction of their venues. Do not add one of those countries here
// without a per-venue (or at least per-cell) resolution.
//
// The intended upgrade path is Google's Time Zone API
// (https://maps.googleapis.com/maps/api/timezone/json) — already enabled and
// authorized on this project's key, verified returning correct zones for
// Belgrade, New York, London, Tokyo and Sydney. Resolve it once per sync cell
// alongside the existing ReverseGeocodeCity call (see googlesync.go's
// toIngest/cellLocation) and store the zone per row instead of deriving it
// here from country. Until that lands, an unknown country yields no
// opening_hours (free-text hours still stands) rather than a fabricated zone.
var countryTimezones = map[string]string{
	"Serbia": "Europe/Belgrade",
}

// TimezoneForCountry returns the IANA zone for country, or "" if unknown.
func TimezoneForCountry(country string) string { return countryTimezones[country] }

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

// buildOpeningHours converts a Places regularOpeningHours block into the
// structured activitiessvc.OpeningHours shape, or nil. It always returns a
// value that passes service.validateOpeningHours: a real IANA timezone,
// zero-padded HH:MM times, valid weekday names, and never always_open=false
// with no periods. Periods without a close time are skipped (never fabricate
// a close); the sole 24/7 sentinel (one open at Sunday 00:00, no close)
// becomes always_open. Shared by BuildLiveDetails (country comes from the
// activity's stored country; roh from the live PlaceDetail).
func buildOpeningHours(country string, roh RegularOpeningHours) *activitiessvc.OpeningHours {
	tz := TimezoneForCountry(country)
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
// modification of it, so the scrape-time Place shape is untouched.
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
// are Tripadvisor-sourced and have no case here). Nothing it writes is ever
// persisted (Places Terms §14.3) — call it fresh on every detail-page open.
// Header-level fields (rating, review count,
// description, reviews) live on Activity itself, not in this payload (T2's
// merge); Sport has no sourceable Details content at all and always returns
// "{}". Every field is omitted, not blanked, when its
// source is empty/false/absent — including the every-false and
// every-absent amenity cases, which are indistinguishable in Go's zero-value
// bool and so behave identically (both omit the section).
func BuildLiveDetails(cat activitiessvc.Category, country string, d PlaceDetail) json.RawMessage {
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
		if oh := buildOpeningHours(country, d.RegularOpeningHours); oh != nil {
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
		set("website_url", d.WebsiteURI)
	case activitiessvc.CategoryNightlife:
		set("venue_type", venueType)
		setOpeningHours()
	case activitiessvc.CategoryNature:
		setList("good_to_know", natureGoodToKnow(d))
		set("website_url", d.WebsiteURI)
	case activitiessvc.CategoryKids:
		setList("facilities", kidsFacilities(d))
		set("website_url", d.WebsiteURI)
	case activitiessvc.CategoryCulture, activitiessvc.CategoryArt, activitiessvc.CategoryShopping:
		set("hours", hours)
		set("venue_type", venueType)
		setOpeningHours()
		set("website_url", d.WebsiteURI)
	case activitiessvc.CategoryWellness:
		set("venue_type", venueType)
		set("website_url", d.WebsiteURI)
		setOpeningHours()
	case activitiessvc.CategoryEntertainment:
		set("website_url", d.WebsiteURI)
		setOpeningHours()
	}
	// Sport: no case -> always "{}" (no sourceable Places fields for it).

	b, err := json.Marshal(out)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

// categoryDetailFields lists the extra Place Details fields, beyond the
// header baseline in DetailFieldMask, that BuildLiveDetails' switch case for
// cat actually reads. Kept next to BuildLiveDetails so the two can never
// drift: add a field to a switch case above, add it here. CategorySport has
// no entry — its switch case is a no-op, and its DetailFieldMask carries no
// category-specific fields beyond the header baseline (T3,
// places-api-cost-reduction).
var categoryDetailFields = map[activitiessvc.Category][]string{
	activitiessvc.CategoryCafes: {
		"regularOpeningHours", "websiteUri", // hours, opening_hours, website_url
		"servesCoffee", "servesVegetarianFood", "outdoorSeating", "allowsDogs", // cafeKnownFor
		"goodForGroups", "dineIn", "takeout", "reservable",
	},
	activitiessvc.CategoryNightlife: {"primaryTypeDisplayName", "regularOpeningHours"},
	activitiessvc.CategoryNature: {
		"websiteUri",
		"goodForChildren", "allowsDogs", "restroom", "accessibilityOptions", "parkingOptions", // natureGoodToKnow
	},
	activitiessvc.CategoryKids: {
		"websiteUri",
		"goodForChildren", "menuForChildren", "restroom", "parkingOptions", "accessibilityOptions", // kidsFacilities
	},
	activitiessvc.CategoryCulture:       {"regularOpeningHours", "primaryTypeDisplayName", "websiteUri"},
	activitiessvc.CategoryArt:           {"regularOpeningHours", "primaryTypeDisplayName", "websiteUri"},
	activitiessvc.CategoryShopping:      {"regularOpeningHours", "primaryTypeDisplayName", "websiteUri"},
	activitiessvc.CategoryWellness:      {"primaryTypeDisplayName", "websiteUri", "regularOpeningHours"},
	activitiessvc.CategoryEntertainment: {"websiteUri", "regularOpeningHours"},
}

// DetailFieldMask is the X-Goog-FieldMask a detail-page open sends for cat
// (T3, places-api-cost-reduction): the header fields withLiveDetails always
// merges onto Activity (rating, review count, Google Maps link, reviews,
// description) plus exactly the fields cat's BuildLiveDetails case reads,
// from categoryDetailFields above.
//
// reviews/editorialSummary/generativeSummary ride along for every category,
// including Sport, and are NOT narrowed per category here (round-2 review
// finding, T3 places-api-cost-reduction): withLiveDetails' header merge
// (service/activity.go) sets Activity.GoogleReviews/Description
// unconditionally from whatever this call returns, for every one of the 10
// Places-sourced categories alike — the app's PLACES_LIVE_CATEGORIES set and
// ActivityDetailScreen's reviews card render identically regardless of
// category (gated only on GoogleMapsURI/rating presence, never on cat). A
// category whose mask drops these fields loses live reviews/description on
// its detail page for good, a real AC4 violation ("no user-visible change"),
// not merely a payload-scope technicality. Sport previously special-cased
// this away to satisfy AC3 ("at least one category has no Enterprise+
// Atmosphere field") — that mask shipped, then broke Sport's reviews card
// exactly as this comment describes, per review round 2's Critical finding.
//
// AC3 is NOT met by this mask for any category as of this revision: doing so
// safely requires either a coordinated frontend change (a category-specific
// opt-out of the reviews/description card, out of this task's scope per its
// own "Out of scope: changing which fields the detail page renders" line) or
// a product ruling on which category may give up live reviews. Escalated in
// review-log.md/engineering-notes.md rather than silently reinterpreted a
// second time. Every category still saves on the fields its own
// BuildLiveDetails case never reads (amenity booleans, hours, venue type,
// website) via categoryDetailFields — Enterprise+Atmosphere is unavoidable
// today, Pro/Essentials-tier fields are still trimmed per category.
func DetailFieldMask(cat activitiessvc.Category) string {
	fields := []string{
		"rating", "userRatingCount", "googleMapsUri",
		"reviews", "reviews.authorAttribution", "editorialSummary", "generativeSummary",
	}
	fields = append(fields, categoryDetailFields[cat]...)
	return strings.Join(fields, ",")
}

// ReviewFieldMask is the X-Goog-FieldMask withTripadvisorGoogleReviews sends
// (T3, places-api-cost-reduction): only the fields it actually merges
// (Rating, ReviewCount, GoogleReviews, GoogleMapsURI) — it never touches
// Description or a category's Details payload, so it needs none of
// DetailFieldMask's category-specific or editorialSummary/generativeSummary
// fields.
const ReviewFieldMask = "rating,userRatingCount,reviews,reviews.authorAttribution,googleMapsUri"
