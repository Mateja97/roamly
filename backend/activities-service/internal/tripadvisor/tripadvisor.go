// Package tripadvisor is the single client for the Tripadvisor Terra
// Partner API, structured as the direct counterpart to internal/places: it
// owns the API key, the http.Client, the base URL, and the retry/backoff
// policy for the four calls the Restaurants/Bars lazy sync needs (see design
// doc "tripadvisor-restaurants-bars"). Unlike places (mostly a build/seed-time
// tool with one live exception), every method here is a live, per-sync
// call — there is no batch scrape path for Tripadvisor.
package tripadvisor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"backend/shared/config"
	"backend/shared/models/activitiessvc"
)

// defaultBase is the production Tripadvisor Terra Partner API host.
const defaultBase = "https://terra.tripadvisor.com/api"

// locale is the fixed locale sent on every request — Terra requires a real
// locale like "en-US", a bare "en" is rejected with a 400.
const locale = "en-US"

// maxAttempts caps retries on transient (429/5xx) failures.
const maxAttempts = 4

// Client calls the Tripadvisor Terra Partner API: nearby search, location
// details, photos, and reviews. Exactly one http.Client, one base URL, one
// key.
type Client struct {
	http *http.Client
	key  string
	base string
}

// New builds a Client against the production Tripadvisor Terra Partner API.
func New(apiKey string) *Client {
	return NewWithBase(apiKey, defaultBase)
}

// NewFromEnv builds a Client reading TRIPADVISOR_API_KEY via
// config.Require, the single fail-fast point every call site should use
// instead of its own os.Getenv.
func NewFromEnv() (*Client, error) {
	key, err := config.Require("TRIPADVISOR_API_KEY")
	if err != nil {
		return nil, err
	}
	return New(key), nil
}

// NewWithBase is New with the API base URL parameterized, so tests can
// point it at a local httptest server.
func NewWithBase(apiKey, base string) *Client {
	return &Client{http: &http.Client{Timeout: 20 * time.Second}, key: apiKey, base: base}
}

// LocationSummary is one Nearby Search result. Deliberately thin —
// Terra's /catalog/locations/nearby endpoint returns only identity, never
// rating/photos/ranking; LocationDetails resolves the rest per candidate.
// WebURL (urls.tripadvisor.main in the catalog projection) is carried so
// the sync can gate on Tripadvisor's own venue-type path segment
// (Restaurant_Review-/Hotel_Review-/...) before paying a LocationDetails
// call for the candidate.
type LocationSummary struct {
	LocationID string
	Name       string
	WebURL     string
}

// localizedValue is the shape shared by names/descriptions/title/text
// arrays across every Terra endpoint: a set of per-language values, one
// (usually) flagged primary.
type localizedValue struct {
	Language string `json:"language"`
	Value    string `json:"value"`
	Primary  bool   `json:"primary"`
}

// primaryValue returns the primary-flagged entry's Value, falling back to
// the first entry, "" if vs is empty.
func primaryValue(vs []localizedValue) string {
	for _, v := range vs {
		if v.Primary {
			return v.Value
		}
	}
	if len(vs) > 0 {
		return vs[0].Value
	}
	return ""
}

// nearbySearchPageSize is Terra's per-page maximum (and default) for
// /catalog/locations/nearby — asking for more is rejected, so depth comes
// only from paging.
const nearbySearchPageSize = 20

// nearbySearchMaxPages caps how deep NearbySearch pages. Terra's category
// parameter doesn't filter server-side (see terraNearbySearchCategory's doc
// in internal/service), so each 20-result page is mostly hotels/apartments/
// attractions noise; a single page left a city with ~2 real restaurants
// (the Belgrade bug). 5 pages ≈ 100 candidates gives the food-venue gate
// enough raw material. The endpoint serves 50+ pages for a dense city, so
// this is a cost cap, not a data limit; raise it if cities still come up
// thin.
const nearbySearchMaxPages = 5

// NearbySearch finds Tripadvisor locations of category (e.g.
// "RESTAURANT") within radiusKM of lat/lng, paging through up to
// nearbySearchMaxPages catalog pages. Page numbering is 1-based per the
// Partner API spec's "Page index (1-based)" (and verified live: page=1 and
// page=2 return distinct result sets). A short page means the last page:
// paging stops there. Any page failing fails the whole call — a partial
// result would let the caller mark the area synced on a fraction of its
// venues. Results are deduped by location ID across pages: pages are
// snapshots of a rating-sorted listing, so a venue can straddle a page
// boundary between two requests.
func (c *Client) NearbySearch(ctx context.Context, lat, lng, radiusKM float64, category string) ([]LocationSummary, error) {
	var out []LocationSummary
	seen := make(map[int64]bool)
	for page := 1; page <= nearbySearchMaxPages; page++ {
		q := url.Values{
			"lat":      {fmt.Sprintf("%f", lat)},
			"lon":      {fmt.Sprintf("%f", lng)},
			"radius":   {fmt.Sprintf("%f", radiusKM)},
			"unit":     {"KM"},
			"category": {category},
			"locale":   {locale},
			"page":     {strconv.Itoa(page)},
			"size":     {strconv.Itoa(nearbySearchPageSize)},
		}
		var parsed struct {
			Data []struct {
				Location struct {
					ID    int64            `json:"id"`
					Names []localizedValue `json:"names"`
					URLs  struct {
						Tripadvisor struct {
							Main string `json:"main"`
						} `json:"tripadvisor"`
					} `json:"urls"`
				} `json:"location"`
			} `json:"data"`
		}
		if err := c.doJSON(ctx, c.base+"/catalog/locations/nearby?"+q.Encode(), &parsed); err != nil {
			return nil, fmt.Errorf("tripadvisor nearby search: %w", err)
		}
		for _, d := range parsed.Data {
			if seen[d.Location.ID] {
				continue
			}
			seen[d.Location.ID] = true
			out = append(out, LocationSummary{
				LocationID: strconv.FormatInt(d.Location.ID, 10),
				Name:       primaryValue(d.Location.Names),
				WebURL:     d.Location.URLs.Tripadvisor.Main,
			})
		}
		if len(parsed.Data) < nearbySearchPageSize {
			break
		}
	}
	return out, nil
}

// Aspect is one subrating category's value (e.g. Food) — a rating plus the
// API-hosted bubble image for it. Compliance rule 02 (design doc §5c):
// that image must be rendered as-is, never redrawn or recolored.
type Aspect struct {
	Rating  float64
	IconURL string
}

// Subratings is Tripadvisor's per-category rating breakdown (T3):
// Food/Service/Value/Atmosphere, each on Tripadvisor's usual 1-5 scale. A
// nil field means Tripadvisor returned no subrating for that category —
// never a fabricated zero-value Aspect (a zero would render as a real
// "0.0" bubble downstream).
type Subratings struct {
	Food       *Aspect
	Service    *Aspect
	Value      *Aspect
	Atmosphere *Aspect
}

// Ranking is one entry from Tripadvisor's rankings[] — the Location's rank
// within a Geo/category, e.g. "#23 of 500 Restaurants in Belgrade".
type Ranking struct {
	DisplayText string
	Rank        int
	Total       int
	Category    string
}

// Award is a Tripadvisor accolade for the Location. LocationDetails only
// ever carries the Travelers' Choice award (Certificate of Excellence is
// filtered out at parse time — see LocationDetails), most recent year.
type Award struct {
	Name     string
	Year     int
	ImageURL string
}

// Category is one entry from Tripadvisor's categories[] — a classification
// with its hierarchy path, e.g. Hierarchy "restaurants > fine_dining".
type Category struct {
	DisplayName string
	Hierarchy   string
}

// travelersChoice is the one Award.Type value LocationDetails keeps; the
// API's other enum member ("Certificate of Excellence") isn't shown by the
// design (§5c rule 03: no non-Tripadvisor badge treatment either way, but
// Travelers' Choice is the only award frame 5b calls for).
const travelersChoice = "Travelers' Choice"

// LocationDetails is one Tripadvisor location's full detail record — a
// second call per NearbySearch candidate. Phone, Subratings, Rankings,
// Award, PriceLevel, Categories, Description, Attributes, and
// RecommendedVisitLength are all optional per the API and absent/zero-value
// when Tripadvisor didn't return them — empirically sparse for
// Restaurants/Bars/Cafés under this entitlement (Description shows up for
// some venues, Attributes/RecommendedVisitLength were absent in every venue
// sampled while wiring this up), same "some venues have it, most don't"
// shape as Google's own editorialSummary.
type LocationDetails struct {
	LocationID     string
	Name           string
	Lat, Lng       float64
	Address        string
	City           string
	Country        string
	Phone          string
	Rating         float64
	ReviewCount    int
	RatingImageURL string
	WebURL         string
	Subratings     Subratings
	Rankings       []Ranking
	Award          *Award
	PriceLevel     string
	Categories     []Category
	// Description is the primary-language editorial description
	// (descriptions[]), "" when Tripadvisor has none for this location.
	Description string
	// Attributes is descriptive amenities/features (attributes[].name) —
	// e.g. "Free Wi-Fi", "Outdoor Seating". Names only; type/type_id aren't
	// consumed anywhere downstream yet.
	Attributes []string
	// RecommendedVisitLength is Tripadvisor's coded suggested-visit-length
	// indicator (0 = unknown/not set, 1 = under 1h, 2 = 1-2h, 3 = 2-3h,
	// 4 = over 3h) — 0 and "absent" are indistinguishable on the wire.
	RecommendedVisitLength int
}

func (c *Client) LocationDetails(ctx context.Context, locationID string) (LocationDetails, error) {
	q := url.Values{"locale": {locale}}
	var parsed struct {
		ID        int64            `json:"id"`
		Names     []localizedValue `json:"names"`
		Addresses []struct {
			City        string `json:"city"`
			CountryName string `json:"country_name"`
			Formatted   string `json:"formatted"`
		} `json:"addresses"`
		Coordinates struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"coordinates"`
		PhoneNumbers []struct {
			Value string `json:"value"`
		} `json:"phone_numbers"`
		TravelerRatings struct {
			Overall struct {
				Rating  float64 `json:"rating"`
				Count   int     `json:"count"`
				IconURL string  `json:"icon_url"`
			} `json:"overall"`
			// Real schema (Terra OpenAPI spec's SubRating): type,
			// type_name, rating, count, icon_url. Never name/rating_value —
			// those don't exist on this API.
			Subratings []struct {
				Type     string  `json:"type"`
				TypeName string  `json:"type_name"`
				Rating   float64 `json:"rating"`
				IconURL  string  `json:"icon_url"`
			} `json:"subratings"`
		} `json:"traveler_ratings"`
		URLs struct {
			Tripadvisor struct {
				Main string `json:"main"`
			} `json:"tripadvisor"`
		} `json:"urls"`
		Rankings []struct {
			DisplayText string `json:"display_text"`
			Rank        int    `json:"rank"`
			Total       int    `json:"total"`
			Category    string `json:"category"`
		} `json:"rankings"`
		Awards []struct {
			Name  string `json:"name"`
			Type  string `json:"type"`
			Year  int    `json:"year"`
			Image struct {
				URL string `json:"url"`
			} `json:"image"`
		} `json:"awards"`
		PriceLevel string `json:"price_level"`
		Categories []struct {
			DisplayName string `json:"display_name"`
			Hierarchy   string `json:"hierarchy"`
		} `json:"categories"`
		Descriptions []localizedValue `json:"descriptions"`
		Attributes   []struct {
			Name string `json:"name"`
		} `json:"attributes"`
		RecommendedVisitLength int `json:"recommended_visit_length"`
	}
	if err := c.doJSON(ctx, c.base+"/locations/"+locationID+"?"+q.Encode(), &parsed); err != nil {
		return LocationDetails{}, fmt.Errorf("tripadvisor location %s details: %w", locationID, err)
	}

	details := LocationDetails{
		LocationID:             strconv.FormatInt(parsed.ID, 10),
		Name:                   primaryValue(parsed.Names),
		Lat:                    parsed.Coordinates.Latitude,
		Lng:                    parsed.Coordinates.Longitude,
		Rating:                 parsed.TravelerRatings.Overall.Rating,
		ReviewCount:            parsed.TravelerRatings.Overall.Count,
		RatingImageURL:         parsed.TravelerRatings.Overall.IconURL,
		WebURL:                 parsed.URLs.Tripadvisor.Main,
		PriceLevel:             parsed.PriceLevel,
		Description:            primaryValue(parsed.Descriptions),
		RecommendedVisitLength: parsed.RecommendedVisitLength,
	}
	for _, attr := range parsed.Attributes {
		if attr.Name != "" {
			details.Attributes = append(details.Attributes, attr.Name)
		}
	}
	if len(parsed.Addresses) > 0 {
		details.Address = parsed.Addresses[0].Formatted
		details.City = parsed.Addresses[0].City
		details.Country = parsed.Addresses[0].CountryName
	}
	if len(parsed.PhoneNumbers) > 0 {
		details.Phone = parsed.PhoneNumbers[0].Value
	}
	for _, sr := range parsed.TravelerRatings.Subratings {
		aspect := &Aspect{Rating: sr.Rating, IconURL: sr.IconURL}
		// type is the machine key (spec doesn't enumerate its values) and
		// type_name is locale-dependent (client sends locale=en-US) — match
		// against either so neither field's exact form can break this.
		switch aspectKey(sr.Type, sr.TypeName) {
		case "food":
			details.Subratings.Food = aspect
		case "service":
			details.Subratings.Service = aspect
		case "value":
			details.Subratings.Value = aspect
		case "atmosphere":
			details.Subratings.Atmosphere = aspect
		}
	}
	for _, r := range parsed.Rankings {
		details.Rankings = append(details.Rankings, Ranking{
			DisplayText: r.DisplayText,
			Rank:        r.Rank,
			Total:       r.Total,
			Category:    r.Category,
		})
	}
	for _, a := range parsed.Awards {
		if a.Type != travelersChoice {
			continue
		}
		if details.Award == nil || a.Year > details.Award.Year {
			details.Award = &Award{Name: a.Name, Year: a.Year, ImageURL: a.Image.URL}
		}
	}
	for _, c := range parsed.Categories {
		details.Categories = append(details.Categories, Category{DisplayName: c.DisplayName, Hierarchy: c.Hierarchy})
	}
	return details, nil
}

// aspectKey returns which of the 4 grid aspects (food/service/value/
// atmosphere) typ or typeName names, case-insensitively, "" if neither
// matches (e.g. "Cleanliness" — present in the API but not on the grid).
func aspectKey(typ, typeName string) string {
	for _, s := range []string{strings.ToLower(typ), strings.ToLower(typeName)} {
		switch s {
		case "food", "service", "value", "atmosphere":
			return s
		}
	}
	return ""
}

// LocationPhotos resolves up to limit Tripadvisor-hosted photos for
// locationID, skipping any entry with no image URL. Mirrors
// internal/places.ResolvePhotos' role: the live, per-sync call that backs
// GetPhotos' resolve-on-first-view path for a Tripadvisor-sourced row.
func (c *Client) LocationPhotos(ctx context.Context, locationID string, limit int) ([]activitiessvc.Photo, error) {
	q := url.Values{"locale": {locale}, "size": {strconv.Itoa(limit)}}
	var parsed struct {
		Data []struct {
			Photo struct {
				OriginalSizeURL string `json:"original_size_url"`
			} `json:"photo"`
			User struct {
				Username string `json:"username"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := c.doJSON(ctx, c.base+"/locations/"+locationID+"/photos?"+q.Encode(), &parsed); err != nil {
		return nil, fmt.Errorf("tripadvisor location %s photos: %w", locationID, err)
	}
	out := make([]activitiessvc.Photo, 0, min(len(parsed.Data), limit))
	for _, p := range parsed.Data {
		if len(out) >= limit {
			break // defensive backstop: size already asked the server to cap this
		}
		if p.Photo.OriginalSizeURL == "" {
			continue
		}
		out = append(out, activitiessvc.Photo{URL: p.Photo.OriginalSizeURL, Author: p.User.Username, Provider: activitiessvc.ProviderTripadvisor})
	}
	return out, nil
}

// Review is one Tripadvisor traveler review. RatingImageURL is the
// API-hosted bubble image for the review's overall rating (Review.
// rating_icon_url in the spec) — same compliance rule as Subratings'
// per-aspect images: render as-is, never redrawn or recolored.
type Review struct {
	Rating         int
	Date           string
	Text           string
	RatingImageURL string
}

// reviewsPageSize bounds LocationReviews — callers only need up to the
// first 3 5-bubble ones (see the service layer's tripadvisorReviews), no
// need to page through everything.
const reviewsPageSize = 5

// LocationReviews fetches locationID's reviews, most recent first (the
// API's own default order). Callers pick up to 3 eligible ones (5-bubble,
// place rated >= 4.0) — see the service layer's tripadvisorReviews.
func (c *Client) LocationReviews(ctx context.Context, locationID string) ([]Review, error) {
	q := url.Values{"language": {"en"}, "size": {strconv.Itoa(reviewsPageSize)}}
	var parsed struct {
		Data []struct {
			Rating        int              `json:"rating"`
			PublishTs     string           `json:"publish_ts"`
			Text          []localizedValue `json:"text"`
			RatingIconURL struct {
				URL string `json:"url"`
			} `json:"rating_icon_url"`
		} `json:"data"`
	}
	if err := c.doJSON(ctx, c.base+"/locations/"+locationID+"/reviews?"+q.Encode(), &parsed); err != nil {
		return nil, fmt.Errorf("tripadvisor location %s reviews: %w", locationID, err)
	}
	out := make([]Review, 0, len(parsed.Data))
	for _, r := range parsed.Data {
		out = append(out, Review{Rating: r.Rating, Date: r.PublishTs, Text: primaryValue(r.Text), RatingImageURL: r.RatingIconURL.URL})
	}
	return out, nil
}

// doJSON sends one GET request, retrying on 429/5xx with capped, jittered
// backoff (non-transient errors, including other 4xx, return immediately),
// and JSON-decodes a 2xx body into out. Same shape as internal/places'
// doJSON, deliberately duplicated rather than shared — one self-contained
// client per external provider, no cross-provider dependency (see
// places.go's doc on the same tradeoff for its own small duplications).
func (c *Client) doJSON(ctx context.Context, requestURL string, out any) error {
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<attempt) * 100 * time.Millisecond
			select {
			case <-time.After(time.Duration(rand.Int63n(int64(backoff)))):
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, bytes.NewReader(nil))
		if err != nil {
			return fmt.Errorf("building request: %w", err)
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-API-Key", c.key)

		resp, err := c.http.Do(req)
		if err != nil {
			return fmt.Errorf("calling %s: %w", req.URL.Path, err)
		}
		raw, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return fmt.Errorf("reading response: %w", err)
		}

		if resp.StatusCode == http.StatusOK {
			if err := json.Unmarshal(raw, out); err != nil {
				return fmt.Errorf("decoding response: %w", err)
			}
			return nil
		}

		lastErr = fmt.Errorf("%s status %d: %s", req.URL.Path, resp.StatusCode, truncate(raw, 800))
		if resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < 500 {
			return lastErr // non-transient: fail without retrying
		}
	}
	return fmt.Errorf("giving up after %d attempts: %w", maxAttempts, lastErr)
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n])
}
