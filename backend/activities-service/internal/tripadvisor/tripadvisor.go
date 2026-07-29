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
type LocationSummary struct {
	LocationID string
	Name       string
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

// NearbySearch finds Tripadvisor locations of category (e.g.
// "RESTAURANT") within radiusKM of lat/lng.
func (c *Client) NearbySearch(ctx context.Context, lat, lng, radiusKM float64, category string) ([]LocationSummary, error) {
	q := url.Values{
		"lat":      {fmt.Sprintf("%f", lat)},
		"lon":      {fmt.Sprintf("%f", lng)},
		"radius":   {fmt.Sprintf("%f", radiusKM)},
		"unit":     {"KM"},
		"category": {category},
		"locale":   {locale},
	}
	var parsed struct {
		Data []struct {
			Location struct {
				ID    int64            `json:"id"`
				Names []localizedValue `json:"names"`
			} `json:"location"`
		} `json:"data"`
	}
	if err := c.doJSON(ctx, c.base+"/catalog/locations/nearby?"+q.Encode(), &parsed); err != nil {
		return nil, fmt.Errorf("tripadvisor nearby search: %w", err)
	}
	out := make([]LocationSummary, 0, len(parsed.Data))
	for _, d := range parsed.Data {
		out = append(out, LocationSummary{
			LocationID: strconv.FormatInt(d.Location.ID, 10),
			Name:       primaryValue(d.Location.Names),
		})
	}
	return out, nil
}

// Subratings is Tripadvisor's per-category rating breakdown (T3):
// Food/Service/Value/Atmosphere, each on Tripadvisor's usual 1-5 scale. A
// zero field means Tripadvisor returned no subrating for that category
// (optional per the API, same zero-means-absent convention as
// LocationDetails.Rating) — never a fabricated 0-bubble score.
type Subratings struct {
	Food       float64
	Service    float64
	Value      float64
	Atmosphere float64
}

// LocationDetails is one Tripadvisor location's full detail record — a
// second call per NearbySearch candidate. The real API carries no ranking
// text and no category/subcategory/cuisine data (see the fields' absence
// here, deliberate not an oversight). Phone and Subratings are both
// optional per the API and zero-value when Tripadvisor didn't return them.
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
			Subratings []struct {
				Name   string  `json:"name"`
				Rating float64 `json:"rating_value"`
			} `json:"subratings"`
		} `json:"traveler_ratings"`
		URLs struct {
			Tripadvisor struct {
				Main string `json:"main"`
			} `json:"tripadvisor"`
		} `json:"urls"`
	}
	if err := c.doJSON(ctx, c.base+"/locations/"+locationID+"?"+q.Encode(), &parsed); err != nil {
		return LocationDetails{}, fmt.Errorf("tripadvisor location %s details: %w", locationID, err)
	}

	details := LocationDetails{
		LocationID:     strconv.FormatInt(parsed.ID, 10),
		Name:           primaryValue(parsed.Names),
		Lat:            parsed.Coordinates.Latitude,
		Lng:            parsed.Coordinates.Longitude,
		Rating:         parsed.TravelerRatings.Overall.Rating,
		ReviewCount:    parsed.TravelerRatings.Overall.Count,
		RatingImageURL: parsed.TravelerRatings.Overall.IconURL,
		WebURL:         parsed.URLs.Tripadvisor.Main,
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
		switch strings.ToLower(sr.Name) {
		case "food":
			details.Subratings.Food = sr.Rating
		case "service":
			details.Subratings.Service = sr.Rating
		case "value":
			details.Subratings.Value = sr.Rating
		case "atmosphere":
			details.Subratings.Atmosphere = sr.Rating
		}
	}
	return details, nil
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

// Review is one Tripadvisor traveler review.
type Review struct {
	Rating int
	Date   string
	Text   string
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
			Rating    int              `json:"rating"`
			PublishTs string           `json:"publish_ts"`
			Text      []localizedValue `json:"text"`
		} `json:"data"`
	}
	if err := c.doJSON(ctx, c.base+"/locations/"+locationID+"/reviews?"+q.Encode(), &parsed); err != nil {
		return nil, fmt.Errorf("tripadvisor location %s reviews: %w", locationID, err)
	}
	out := make([]Review, 0, len(parsed.Data))
	for _, r := range parsed.Data {
		out = append(out, Review{Rating: r.Rating, Date: r.PublishTs, Text: primaryValue(r.Text)})
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
