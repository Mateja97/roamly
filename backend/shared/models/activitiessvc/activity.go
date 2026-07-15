// Package activitiessvc holds activities-service's domain types: the DB row
// struct and the query DTOs shared between its service and repository
// layers. Kept independent of the generated proto types so the api layer is
// the only place that translates wire <-> domain.
package activitiessvc

import "encoding/json"

type Scope string

const (
	ScopeNearby   Scope = "nearby"
	ScopeAnywhere Scope = "anywhere"
)

type Category string

const (
	CategoryRestaurants   Category = "restaurants"
	CategoryCafes         Category = "cafes"
	CategoryBars          Category = "bars"
	CategoryNightlife     Category = "nightlife"
	CategoryNature        Category = "nature"
	CategorySport         Category = "sport"
	CategoryKids          Category = "kids"
	CategoryCulture       Category = "culture"
	CategoryArt           Category = "art"
	CategoryWellness      Category = "wellness"
	CategoryShopping      Category = "shopping"
	CategoryEntertainment Category = "entertainment"
)

// Point is a WGS84 coordinate pair.
type Point struct {
	Lat float64
	Lng float64
}

// Photo is a single activity photo, sourced from Google Places and
// resolved once at seed/build time (never a live per-request Places
// call). Author/AuthorLink are empty for a photo that hasn't been
// resolved yet — the client falls back to its missing-image state rather
// than a placeholder. JSON tags match the `photos` JSONB column shape.
type Photo struct {
	URL        string `json:"url"`
	Author     string `json:"author,omitempty"`
	AuthorLink string `json:"author_link,omitempty"`
}

// Activity is the activities table row, plus a server-computed DistanceKM
// that is only meaningful when the query had a reference point (ScopeNearby
// always; ScopeAnywhere when CurrentLocation was supplied).
type Activity struct {
	ID          string
	Title       string
	Description string
	Category    Category
	Location    Point
	Country     string
	Rating      float64
	Photos      []Photo
	Tags        []string
	DistanceKM  float64
	// Details is the category-specific structured payload (T2), stored
	// as-is against the `details` JSONB column. Kept raw here rather than
	// decoded to a typed struct because only one of the 12 category shapes
	// (below) is ever valid for a given row's Category; decode with the
	// matching struct once Category is known (see service.ValidateDetails).
	Details json.RawMessage
}

// ItemPrice is a name/price pair: Restaurants' popular dishes, Cafés' bar
// items, and other name+price unique sections share this shape.
type ItemPrice struct {
	Name  string `json:"name"`
	Price string `json:"price"`
}

// RestaurantDetails is CategoryRestaurants' detail payload.
type RestaurantDetails struct {
	Cuisine       string      `json:"cuisine,omitempty"`
	PriceTier     string      `json:"price_tier,omitempty"`
	Hours         string      `json:"hours,omitempty"`
	OpenStatus    string      `json:"open_status,omitempty"`
	PopularDishes []ItemPrice `json:"popular_dishes,omitempty"`
}

// BarDetails is CategoryBars' detail payload.
type BarDetails struct {
	Vibe            string   `json:"vibe,omitempty"`
	HappyHourWindow string   `json:"happy_hour_window,omitempty"`
	OpensTime       string   `json:"opens_time,omitempty"`
	SignaturePours  []string `json:"signature_pours,omitempty"`
}

// CafeDetails is CategoryCafes' detail payload.
type CafeDetails struct {
	KnownForBrew string      `json:"known_for_brew,omitempty"`
	WifiQuality  string      `json:"wifi_quality,omitempty"`
	Hours        string      `json:"hours,omitempty"`
	OnTheBar     []ItemPrice `json:"on_the_bar,omitempty"`
}

// LineupItem is one entry in Nightlife's tonight lineup.
type LineupItem struct {
	Time  string `json:"time"`
	Act   string `json:"act"`
	Stage string `json:"stage"`
}

// NightlifeDetails is CategoryNightlife's detail payload.
type NightlifeDetails struct {
	EntryPrice  string       `json:"entry_price,omitempty"`
	DressCode   string       `json:"dress_code,omitempty"`
	OpensTime   string       `json:"opens_time,omitempty"`
	OpenTonight bool         `json:"open_tonight,omitempty"`
	Lineup      []LineupItem `json:"lineup,omitempty"`
}

// NatureDetails is CategoryNature's detail payload.
type NatureDetails struct {
	TimeToSpend string   `json:"time_to_spend,omitempty"`
	BestTime    string   `json:"best_time,omitempty"`
	Cost        string   `json:"cost,omitempty"`
	GoodToKnow  []string `json:"good_to_know,omitempty"`
}

// SportDetails is CategorySport's detail payload.
type SportDetails struct {
	Difficulty  int      `json:"difficulty,omitempty"`
	EffortLevel string   `json:"effort_level,omitempty"`
	Duration    string   `json:"duration,omitempty"`
	Gear        string   `json:"gear,omitempty"`
	WhatToBring []string `json:"what_to_bring,omitempty"`
}

// KidsDetails is CategoryKids' detail payload.
type KidsDetails struct {
	AgeRange   string   `json:"age_range,omitempty"`
	Facilities []string `json:"facilities,omitempty"`
}

// Banner is a single-block callout: Culture's "now showing" and Art's
// "current exhibition" unique sections share this shape.
type Banner struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

// CultureDetails is CategoryCulture's detail payload.
type CultureDetails struct {
	VenueType   string  `json:"venue_type,omitempty"`
	TicketPrice string  `json:"ticket_price,omitempty"`
	Hours       string  `json:"hours,omitempty"`
	NowShowing  *Banner `json:"now_showing,omitempty"`
}

// ArtworkAttribution is Art's artist/work/medium extra property.
type ArtworkAttribution struct {
	Artist string `json:"artist,omitempty"`
	Work   string `json:"work,omitempty"`
	Medium string `json:"medium,omitempty"`
}

// ArtDetails is CategoryArt's detail payload.
type ArtDetails struct {
	VenueType         string              `json:"venue_type,omitempty"`
	TicketPrice       string              `json:"ticket_price,omitempty"`
	Hours             string              `json:"hours,omitempty"`
	Artwork           *ArtworkAttribution `json:"artwork,omitempty"`
	CurrentExhibition *Banner             `json:"current_exhibition,omitempty"`
}

// Treatment is one entry in Wellness' treatments list.
type Treatment struct {
	Item     string `json:"item"`
	Duration string `json:"duration,omitempty"`
	Price    string `json:"price,omitempty"`
}

// WellnessDetails is CategoryWellness' detail payload. No extra properties
// per APP_STANDARDS.md — only the unique section and booking note.
type WellnessDetails struct {
	Treatments          []Treatment `json:"treatments,omitempty"`
	ExternalBookingNote string      `json:"external_booking_note,omitempty"`
}

// Show is one entry in Entertainment's upcoming shows list.
type Show struct {
	Date        string `json:"date"`
	Title       string `json:"title"`
	TimeOrPrice string `json:"time_or_price,omitempty"`
}

// EntertainmentDetails is CategoryEntertainment's detail payload.
type EntertainmentDetails struct {
	Genre         string `json:"genre,omitempty"`
	Neighborhood  string `json:"neighborhood,omitempty"`
	UpcomingShows []Show `json:"upcoming_shows,omitempty"`
}

// ShoppingDetails is CategoryShopping's detail payload.
type ShoppingDetails struct {
	VenueType     string   `json:"venue_type,omitempty"`
	BestDay       string   `json:"best_day,omitempty"`
	Hours         string   `json:"hours,omitempty"`
	WhatYoullFind []string `json:"what_youll_find,omitempty"`
}

// CitySuggestion is one typeahead result: a catalog city (T1) plus the
// centroid of its activities, directly usable as a QueryFilter.Cities entry.
type CitySuggestion struct {
	City     string
	Country  string
	Centroid Point
}

// QueryFilter is the validated, scope-resolved query the service layer
// passes to the repository. CurrentLocation is nil when not supplied
// (ScopeAnywhere only — ScopeNearby always requires it). Cities is
// ScopeAnywhere-only: when non-empty it takes priority over CurrentLocation
// for distance filtering (union of radius-from-any-city).
type QueryFilter struct {
	Scope           Scope
	CurrentLocation *Point
	Cities          []Point

	Categories    []Category // empty = no category filter
	MinRating     float64    // 0 = no filter
	MaxDistanceKM float64    // 0 = no filter (no distance cap)
}
