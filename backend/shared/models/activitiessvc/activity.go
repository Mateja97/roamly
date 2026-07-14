// Package activitiessvc holds activities-service's domain types: the DB row
// struct and the query DTOs shared between its service and repository
// layers. Kept independent of the generated proto types so the api layer is
// the only place that translates wire <-> domain.
package activitiessvc

type Scope string

const (
	ScopeNearby   Scope = "nearby"
	ScopeAnywhere Scope = "anywhere"
)

type Category string

const (
	CategoryFoodAndDrink             Category = "food_and_drink"
	CategoryHistoryAndCulture        Category = "history_and_culture"
	CategoryNatureAndOutdoors        Category = "nature_and_outdoors"
	CategoryArtAndDesign             Category = "art_and_design"
	CategorySports                   Category = "sports"
	CategoryEntertainmentAndWellness Category = "entertainment_and_wellness"
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
}

// QueryFilter is the validated, scope-resolved query the service layer
// passes to the repository. CurrentLocation is nil when not supplied
// (ScopeAnywhere only — ScopeNearby always requires it).
type QueryFilter struct {
	Scope           Scope
	CurrentLocation *Point

	Categories    []Category // empty = no category filter
	MinRating     float64    // 0 = no filter
	MaxDistanceKM float64    // 0 = no filter (no distance cap)
}
