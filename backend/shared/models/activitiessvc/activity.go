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

// Status is an activity's catalog lifecycle state (T1). Only
// StatusPublished activities are ever returned by the public QueryActivities
// RPC; draft/pending exist for the admin surface (T2) to read and write.
type Status string

const (
	StatusPublished Status = "published"
	StatusDraft     Status = "draft"
	StatusPending   Status = "pending"
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

// Valid reports whether c is one of the 12 taxonomy categories
// (BUSINESS_STANDARDS.md). Used at ingestion trust boundaries.
func (c Category) Valid() bool {
	switch c {
	case CategoryRestaurants, CategoryCafes, CategoryBars, CategoryNightlife,
		CategoryNature, CategorySport, CategoryKids, CategoryCulture,
		CategoryArt, CategoryWellness, CategoryShopping, CategoryEntertainment:
		return true
	}
	return false
}

// Point is a WGS84 coordinate pair.
type Point struct {
	Lat float64
	Lng float64
}

// Photo is a single activity photo, either sourced from Google Places and
// resolved once at seed/build time (never a live per-request Places call),
// or uploaded through the admin surface (T1). Author/AuthorLink are empty
// for a photo that hasn't been resolved yet — the client falls back to its
// missing-image state rather than a placeholder. ThumbURL/Caption are T1
// additions: an uploaded photo carries a real thumbnail URL (never derived
// by a `_t.jpg` naming convention) and an optional caption, independent of
// attribution. JSON tags match the `photos` JSONB column shape; the column
// needed no migration to add these — a pre-T1 row simply decodes both as
// the empty string.
type Photo struct {
	URL        string `json:"url"`
	Author     string `json:"author,omitempty"`
	AuthorLink string `json:"author_link,omitempty"`
	ThumbURL   string `json:"thumb_url,omitempty"`
	Caption    string `json:"caption,omitempty"`
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
	// City, Address, and Status are T1 additions: City was already a DB
	// column (never selected until now); Address is new. Status gates the
	// public QueryActivities RPC to StatusPublished only — draft/pending
	// rows exist for the admin surface (T2) but never reach the app.
	City    string
	Address string
	Status  Status
}

// ItemPrice is a name/price pair: Restaurants' popular dishes, Cafés' bar
// items, and other name+price unique sections share this shape.
type ItemPrice struct {
	Name  string `json:"name"`
	Price string `json:"price"`
}

// DayOfWeek is one of the seven weekday names an OpeningHours Period
// recurs on.
type DayOfWeek string

const (
	Monday    DayOfWeek = "monday"
	Tuesday   DayOfWeek = "tuesday"
	Wednesday DayOfWeek = "wednesday"
	Thursday  DayOfWeek = "thursday"
	Friday    DayOfWeek = "friday"
	Saturday  DayOfWeek = "saturday"
	Sunday    DayOfWeek = "sunday"
)

// Period is one weekly recurring opening window, both times 24h "HH:MM" in
// the parent OpeningHours' Timezone. Close earlier than Open means the
// window rolls past midnight (e.g. Open "20:00", Close "02:00" is open from
// 8pm to 2am the following day).
type Period struct {
	Day   DayOfWeek `json:"day"`
	Open  string    `json:"open"`
	Close string    `json:"close"`
}

// OpeningHours is the shared structured weekly-hours shape (T1), added
// under the "opening_hours" key of the details payload of the seven venue
// categories that already show an hours chip today (restaurants, cafes,
// bars, nightlife, culture, art, shopping). Timezone is the venue's IANA
// zone Periods are evaluated against; AlwaysOpen true means Periods may be
// empty (the venue never closes). A nil pointer (field absent) is always
// valid — it's optional end to end, alongside each category's pre-existing
// free-text hours field, which it does not replace.
type OpeningHours struct {
	Timezone   string   `json:"timezone"`
	AlwaysOpen bool     `json:"always_open,omitempty"`
	Periods    []Period `json:"periods,omitempty"`
}

// RestaurantDetails is CategoryRestaurants' detail payload.
type RestaurantDetails struct {
	Cuisine       string      `json:"cuisine,omitempty"`
	PriceTier     string      `json:"price_tier,omitempty"`
	Hours         string      `json:"hours,omitempty"`
	OpenStatus    string      `json:"open_status,omitempty"`
	PopularDishes []ItemPrice `json:"popular_dishes,omitempty"`
	// ActionURL (T7) is the primary CTA's external link ("Book a table"),
	// validated as an absolute http(s) URL when present.
	ActionURL *string `json:"action_url,omitempty"`
	// OpeningHours (T1) is the structured weekly-hours alternative to the
	// free-text Hours field above; both may coexist.
	OpeningHours *OpeningHours `json:"opening_hours,omitempty"`
}

// BarDetails is CategoryBars' detail payload.
type BarDetails struct {
	Vibe            string   `json:"vibe,omitempty"`
	HappyHourWindow string   `json:"happy_hour_window,omitempty"`
	OpensTime       string   `json:"opens_time,omitempty"`
	SignaturePours  []string `json:"signature_pours,omitempty"`
	// ActionURL (T7) is the primary CTA's external link ("See menu").
	ActionURL *string `json:"action_url,omitempty"`
	// OpeningHours (T1) is the structured weekly-hours alternative to the
	// free-text OpensTime field above; both may coexist.
	OpeningHours *OpeningHours `json:"opening_hours,omitempty"`
}

// CafeDetails is CategoryCafes' detail payload.
type CafeDetails struct {
	KnownForBrew string      `json:"known_for_brew,omitempty"`
	WifiQuality  string      `json:"wifi_quality,omitempty"`
	Hours        string      `json:"hours,omitempty"`
	OnTheBar     []ItemPrice `json:"on_the_bar,omitempty"`
	// OpeningHours (T1) is the structured weekly-hours alternative to the
	// free-text Hours field above; both may coexist.
	OpeningHours *OpeningHours `json:"opening_hours,omitempty"`
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
	// ActionURL (T7) is the primary CTA's external link ("Guest list").
	ActionURL *string `json:"action_url,omitempty"`
	// VenueType (T8) is the badge subtype qualifier, e.g. "Club".
	VenueType string `json:"venue_type,omitempty"`
	// OpeningHours (T1) is the structured weekly-hours alternative to the
	// free-text OpensTime field above; both may coexist.
	OpeningHours *OpeningHours `json:"opening_hours,omitempty"`
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
	// ActionURL (T7) is the primary CTA's external link ("Book session").
	ActionURL *string `json:"action_url,omitempty"`
	// Discipline (T8) is the badge subtype qualifier, e.g. "Climbing".
	Discipline string `json:"discipline,omitempty"`
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
	// ActionURL (T7) is the primary CTA's external link ("Get tickets").
	ActionURL *string `json:"action_url,omitempty"`
	// OpeningHours (T1) is the structured weekly-hours alternative to the
	// free-text Hours field above; both may coexist.
	OpeningHours *OpeningHours `json:"opening_hours,omitempty"`
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
	// ActionURL (T7) is the primary CTA's external link ("Get tickets").
	ActionURL *string `json:"action_url,omitempty"`
	// Year (T7) is the current exhibition's artwork year, e.g. 2019.
	Year *int `json:"year,omitempty"`
	// OpeningHours (T1) is the structured weekly-hours alternative to the
	// free-text Hours field above; both may coexist.
	OpeningHours *OpeningHours `json:"opening_hours,omitempty"`
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
	// ActionURL (T7) is the primary CTA's external link ("Visit website").
	ActionURL *string `json:"action_url,omitempty"`
	// VenueType (T8) is the badge subtype qualifier, e.g. "Spa".
	VenueType string `json:"venue_type,omitempty"`
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
	// ActionURL (T7) is the primary CTA's external link ("Get tickets").
	ActionURL *string `json:"action_url,omitempty"`
}

// ShoppingDetails is CategoryShopping's detail payload.
type ShoppingDetails struct {
	VenueType     string   `json:"venue_type,omitempty"`
	BestDay       string   `json:"best_day,omitempty"`
	Hours         string   `json:"hours,omitempty"`
	WhatYoullFind []string `json:"what_youll_find,omitempty"`
	// OpeningHours (T1) is the structured weekly-hours alternative to the
	// free-text Hours field above; both may coexist.
	OpeningHours *OpeningHours `json:"opening_hours,omitempty"`
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

// ListFilter is the admin list query (T2): unlike QueryFilter, there is no
// status restriction baked in — the admin surface reads every lifecycle
// state, filtered only by whatever the caller explicitly asks for. "" means
// "no filter on this field" for Q/Category/City/Status; Limit/Offset are
// already clamped/resolved by the service layer before this reaches the
// repository.
type ListFilter struct {
	Q        string
	Category Category
	City     string
	Status   Status
	Limit    int
	Offset   int
}

// Stats counts the whole catalog by status, ignoring any ListFilter — it
// backs the admin panel's global stat cards, which read as catalog-wide
// totals regardless of the list's current filters.
type Stats struct {
	Total     int
	Published int
	Draft     int
	Pending   int
}

// ListResult is one page of the admin list: Activities is the current page,
// Total is the count matching the filter (for pagination), Stats is
// catalog-wide and unaffected by the filter.
type ListResult struct {
	Activities []Activity
	Total      int
	Stats      Stats
}

// NewActivity is CreateActivity's input (T2): the admin-settable fields for
// a brand-new activity. Location/Country/Rating aren't part of the admin
// API surface yet (no geocoding, no ratings input in this pass — see
// product-tasks.md's T4 caveat), so they're deliberately absent here; the
// repository gives every new row an honest "not yet set" sentinel for those.
type NewActivity struct {
	Title       string
	Description string
	Category    Category
	City        string
	Address     string
	Status      Status // "" -> service defaults to StatusDraft
	Details     json.RawMessage
	Photos      []Photo
}

// IngestActivity is one activity from the ingestion pipeline (cmd/importcity).
// Unlike NewActivity (the admin create surface, which has no geocoding), this
// carries real coordinates, country, and rating from the scrape, plus the
// source identity used to dedupe on re-runs.
type IngestActivity struct {
	Title       string
	Description string
	Category    Category
	Lat         float64
	Lng         float64
	Country     string
	City        string
	Address     string
	Rating      float64
	Status      Status
	Details     json.RawMessage
	Photos      []Photo
	Source      string
	SourceURL   string
	Raw         json.RawMessage
}

// UpdatePatch is a partial update (T2): a nil field is left untouched, a
// non-nil one (even pointing at an empty string) is set to that value. The
// same pointer-presence convention flows end to end — proxy-service's JSON
// decode, the gRPC UpdateActivityRequest's proto3 `optional` fields, and
// this type the repository builds a dynamic SQL SET list from.
type UpdatePatch struct {
	Title       *string
	Description *string
	Category    *Category
	City        *string
	Address     *string
	Status      *Status
	Details     *json.RawMessage
	Photos      *[]Photo
	Tags        *[]string
}
