// Package activitiessvc holds activities-service's domain types: the DB row
// struct and the query DTOs shared between its service and repository
// layers. Kept independent of the generated proto types so the api layer is
// the only place that translates wire <-> domain.
package activitiessvc

type Scope string

const (
	ScopeHome           Scope = "home"
	ScopeNearby         Scope = "nearby"
	ScopeOutsideCountry Scope = "outside_country"
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

type PriceTier string

const (
	PriceTierUnspecified PriceTier = ""
	PriceTierBudget      PriceTier = "budget"
	PriceTierModerate    PriceTier = "moderate"
	PriceTierPremium     PriceTier = "premium"
	PriceTierLuxury      PriceTier = "luxury"
)

// Sort requests a specific result ordering. SortTopRated is only valid for
// ScopeOutsideCountry: the accepted "top activities" MVP is rating
// descending, deterministic tie-break by title.
type Sort string

const (
	SortUnspecified Sort = ""
	SortTopRated    Sort = "top_rated"
)

// Point is a WGS84 coordinate pair.
type Point struct {
	Lat float64
	Lng float64
}

// Activity is the activities table row, plus a server-computed DistanceKM
// that is only meaningful for the SCOPE_HOME / SCOPE_NEARBY scopes.
type Activity struct {
	ID          string
	Title       string
	Description string
	Category    Category
	Location    Point
	Country     string
	PriceTier   PriceTier
	Rating      float64
	ImageRefs   []string
	Tags        []string
	DistanceKM  float64
}

// QueryFilter is the validated, scope-resolved query the service layer
// passes to the repository. CurrentLocation/HomeLocation are nil when not
// supplied/not relevant to Scope.
type QueryFilter struct {
	Scope           Scope
	CurrentLocation *Point
	HomeLocation    *Point
	HomeCountry     string

	Categories    []Category // empty = no category filter
	PriceTier     PriceTier  // PriceTierUnspecified = no filter
	MinRating     float64    // 0 = no filter
	MaxDistanceKM float64    // 0 = no filter; HOME/NEARBY scopes only
	Sort          Sort       // SortUnspecified = no explicit ordering requested
}
