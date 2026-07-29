// Package tripadvisor is the single client for the Tripadvisor Content API,
// structured as the direct counterpart to internal/places: it owns the API
// key, the http.Client, the base URL, and the retry/backoff policy for the
// four calls the Restaurants/Bars lazy sync needs (see design doc
// "tripadvisor-restaurants-bars"). Unlike places (mostly a build/seed-time
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
	"time"

	"backend/shared/config"
	"backend/shared/models/activitiessvc"
)

// defaultBase is the production Tripadvisor Content API host.
const defaultBase = "https://api.content.tripadvisor.com/api/v1"

// maxAttempts caps retries on transient (429/5xx) failures.
const maxAttempts = 4

// Client calls the Tripadvisor Content API: nearby search, location
// details, photos, and reviews. Exactly one http.Client, one base URL, one
// key.
type Client struct {
	http *http.Client
	key  string
	base string
}

// New builds a Client against the production Tripadvisor Content API.
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
// Tripadvisor's nearby_search endpoint returns only identity, never
// rating/photos/ranking; LocationDetails resolves the rest per candidate.
type LocationSummary struct {
	LocationID string
	Name       string
}

// NearbySearch finds Tripadvisor locations of category (e.g.
// "restaurants") within radiusKM of lat/lng.
func (c *Client) NearbySearch(ctx context.Context, lat, lng, radiusKM float64, category string) ([]LocationSummary, error) {
	q := url.Values{
		"key":        {c.key},
		"latLong":    {fmt.Sprintf("%f,%f", lat, lng)},
		"category":   {category},
		"radius":     {fmt.Sprintf("%f", radiusKM)},
		"radiusUnit": {"km"},
		"language":   {"en"},
	}
	var parsed struct {
		Data []struct {
			LocationID string `json:"location_id"`
			Name       string `json:"name"`
		} `json:"data"`
	}
	if err := c.doJSON(ctx, c.base+"/location/nearby_search?"+q.Encode(), &parsed); err != nil {
		return nil, fmt.Errorf("tripadvisor nearby search: %w", err)
	}
	out := make([]LocationSummary, 0, len(parsed.Data))
	for _, d := range parsed.Data {
		out = append(out, LocationSummary{LocationID: d.LocationID, Name: d.Name})
	}
	return out, nil
}

// LocationDetails is one Tripadvisor location's full detail record — a
// second call per NearbySearch candidate. RankingString is Tripadvisor's
// own phrase (e.g. "#12 of 1,780 Restaurants in Belgrade"), with no date —
// callers append their own month/year stamp (design doc's compliance rule
// 05) since that's a display-time concern, not this client's.
type LocationDetails struct {
	LocationID     string
	Name           string
	Lat, Lng       float64
	Address        string
	Rating         float64
	ReviewCount    int
	RankingString  string
	RatingImageURL string
	WebURL         string
	Category       string
	Subcategories  []string
	PhotoURL       string
}

func (c *Client) LocationDetails(ctx context.Context, locationID string) (LocationDetails, error) {
	q := url.Values{"key": {c.key}, "language": {"en"}, "currency": {"USD"}}
	var parsed struct {
		LocationID string `json:"location_id"`
		Name       string `json:"name"`
		Latitude   string `json:"latitude"`
		Longitude  string `json:"longitude"`
		AddressObj struct {
			AddressString string `json:"address_string"`
		} `json:"address_obj"`
		Rating         string `json:"rating"`
		NumReviews     string `json:"num_reviews"`
		RatingImageURL string `json:"rating_image_url"`
		WebURL         string `json:"web_url"`
		RankingData    struct {
			RankingString string `json:"ranking_string"`
		} `json:"ranking_data"`
		Category struct {
			Name string `json:"name"`
		} `json:"category"`
		Subcategory []struct {
			Name string `json:"name"`
		} `json:"subcategory"`
		Photo struct {
			Images struct {
				Large struct {
					URL string `json:"url"`
				} `json:"large"`
			} `json:"images"`
		} `json:"photo"`
	}
	if err := c.doJSON(ctx, c.base+"/location/"+locationID+"/details?"+q.Encode(), &parsed); err != nil {
		return LocationDetails{}, fmt.Errorf("tripadvisor location %s details: %w", locationID, err)
	}

	subs := make([]string, 0, len(parsed.Subcategory))
	for _, s := range parsed.Subcategory {
		subs = append(subs, s.Name)
	}
	return LocationDetails{
		LocationID:     parsed.LocationID,
		Name:           parsed.Name,
		Lat:            parseFloat(parsed.Latitude),
		Lng:            parseFloat(parsed.Longitude),
		Address:        parsed.AddressObj.AddressString,
		Rating:         parseFloat(parsed.Rating),
		ReviewCount:    parseInt(parsed.NumReviews),
		RankingString:  parsed.RankingData.RankingString,
		RatingImageURL: parsed.RatingImageURL,
		WebURL:         parsed.WebURL,
		Category:       parsed.Category.Name,
		Subcategories:  subs,
		PhotoURL:       parsed.Photo.Images.Large.URL,
	}, nil
}

// LocationPhotos resolves up to limit Tripadvisor-hosted photos for
// locationID, skipping any entry with no image URL. Mirrors
// internal/places.ResolvePhotos' role: the live, per-sync call that backs
// GetPhotos' resolve-on-first-view path for a Tripadvisor-sourced row.
func (c *Client) LocationPhotos(ctx context.Context, locationID string, limit int) ([]activitiessvc.Photo, error) {
	q := url.Values{"key": {c.key}, "language": {"en"}}
	var parsed struct {
		Data []struct {
			Images struct {
				Large struct {
					URL string `json:"url"`
				} `json:"large"`
			} `json:"images"`
			User struct {
				Username string `json:"username"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := c.doJSON(ctx, c.base+"/location/"+locationID+"/photos?"+q.Encode(), &parsed); err != nil {
		return nil, fmt.Errorf("tripadvisor location %s photos: %w", locationID, err)
	}
	out := make([]activitiessvc.Photo, 0, min(len(parsed.Data), limit))
	for _, p := range parsed.Data {
		if len(out) >= limit {
			break
		}
		if p.Images.Large.URL == "" {
			continue
		}
		out = append(out, activitiessvc.Photo{URL: p.Images.Large.URL, Author: p.User.Username, Provider: activitiessvc.ProviderTripadvisor})
	}
	return out, nil
}

// Review is one Tripadvisor traveler review.
type Review struct {
	Rating int
	Date   string
	Text   string
}

// LocationReviews fetches locationID's reviews, most recent first (the
// API's own default order). Callers pick the first eligible one (5-bubble,
// place rated >= 4.0) — see the service layer's featuredReview.
func (c *Client) LocationReviews(ctx context.Context, locationID string) ([]Review, error) {
	q := url.Values{"key": {c.key}, "language": {"en"}}
	var parsed struct {
		Data []struct {
			Rating        int    `json:"rating"`
			PublishedDate string `json:"published_date"`
			Text          string `json:"text"`
		} `json:"data"`
	}
	if err := c.doJSON(ctx, c.base+"/location/"+locationID+"/reviews?"+q.Encode(), &parsed); err != nil {
		return nil, fmt.Errorf("tripadvisor location %s reviews: %w", locationID, err)
	}
	out := make([]Review, 0, len(parsed.Data))
	for _, r := range parsed.Data {
		out = append(out, Review{Rating: r.Rating, Date: r.PublishedDate, Text: r.Text})
	}
	return out, nil
}

// parseFloat/parseInt treat an empty or malformed numeric field as zero
// rather than erroring the whole call — a brand-new Tripadvisor listing
// with "num_reviews":"" is a real, valid response shape.
func parseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func parseInt(s string) int {
	v, _ := strconv.Atoi(s)
	return v
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
