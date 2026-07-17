// Command scrapecity is Stage A of the per-city ingestion pipeline: it
// queries the Google Places API (New) across the 12 activity categories for a
// city, keeps only high-confidence, relevant venues (rating + review-count
// floor), resolves up to 3 photo URLs each, and writes a <city>.json in the
// exact shape cmd/importcity reads. Build/seed-time maintenance tool; not
// wired into service startup. Requires GOOGLE_MAPS_API_KEY (Places API New
// enabled).
//
// Usage:
//
//	GOOGLE_MAPS_API_KEY=... go run ./cmd/scrapecity \
//	  -city "Belgrade" -country "Serbia" -out belgrade.json \
//	  [-min-rating 4.0] [-min-reviews 50] [-pages 3] [-photos 3]
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"backend/shared/models/activitiessvc"
)

const placesBase = "https://places.googleapis.com"

// categoryQueries maps each of the 12 taxonomy categories to the Places Text
// Search term used to discover its venues. One term per category keeps the
// request budget small; add variants later if coverage of a thin category
// (kids, art) proves too sparse.
var categoryQueries = []struct {
	category activitiessvc.Category
	term     string
}{
	{activitiessvc.CategoryRestaurants, "restaurants"},
	{activitiessvc.CategoryCafes, "coffee shops"},
	{activitiessvc.CategoryBars, "bars"},
	{activitiessvc.CategoryNightlife, "night clubs"},
	{activitiessvc.CategoryNature, "parks and nature"},
	{activitiessvc.CategorySport, "sports and recreation"},
	{activitiessvc.CategoryKids, "kids activities"},
	{activitiessvc.CategoryCulture, "museums and landmarks"},
	{activitiessvc.CategoryArt, "art galleries"},
	{activitiessvc.CategoryWellness, "spa and wellness"},
	{activitiessvc.CategoryShopping, "shopping malls"},
	{activitiessvc.CategoryEntertainment, "entertainment"},
}

// outputRow mirrors cmd/importcity's inputRow exactly — the two files are the
// contract between Stage A and Stage B.
type outputRow struct {
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	Lat         float64         `json:"lat"`
	Lng         float64         `json:"lng"`
	Country     string          `json:"country"`
	City        string          `json:"city"`
	Address     string          `json:"address"`
	Rating      float64         `json:"rating"`
	Details     json.RawMessage `json:"details"`
	PhotoURLs   []string        `json:"photo_urls"`
	SourceURL   string          `json:"source_url"`
	Raw         json.RawMessage `json:"raw"`
}

// place is the subset of a Places API (New) place the pipeline consumes.
type place struct {
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
}

type searchTextResponse struct {
	Places        []place `json:"places"`
	NextPageToken string  `json:"nextPageToken"`
}

// passesFilter is the "high confidence + relevant" gate: a venue must clear
// both the rating floor and the review-count floor. Review count matters as
// much as rating — a 5.0 with 3 reviews is noise, not signal.
func passesFilter(p place, minRating float64, minReviews int) bool {
	return p.Rating >= minRating && p.UserRatingCount >= minReviews
}

// priceTier maps the Places priceLevel enum onto the $/$$/$$$ tiers the
// food/drink detail shapes use; unknown/absent → "".
func priceTier(level string) string {
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

// buildDetails assembles the minimal, honest details payload from what Places
// actually returns: free-text hours (never fabricated) and, for the
// food/drink categories, a price tier. Structured opening_hours is left for a
// later enrichment pass — it needs an IANA timezone Places doesn't hand back.
func buildDetails(cat activitiessvc.Category, p place) json.RawMessage {
	d := map[string]any{}
	if len(p.RegularOpeningHours.WeekdayDescriptions) > 0 {
		d["hours"] = strings.Join(p.RegularOpeningHours.WeekdayDescriptions, "; ")
	}
	switch cat {
	case activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes, activitiessvc.CategoryBars:
		if t := priceTier(p.PriceLevel); t != "" {
			d["price_tier"] = t
		}
	}
	b, err := json.Marshal(d)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

// client wraps the two Places calls scrapecity needs, holding the api key and
// http client so the call sites stay short.
type client struct {
	http *http.Client
	key  string
	base string
}

// searchText runs one page of a Places Text Search. pageToken is "" for the
// first page; the returned token (if any) fetches the next.
func (c *client) searchText(ctx context.Context, query, pageToken string) (searchTextResponse, error) {
	reqBody := map[string]any{"textQuery": query, "pageSize": 20}
	if pageToken != "" {
		reqBody["pageToken"] = pageToken
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return searchTextResponse{}, fmt.Errorf("encoding search body: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/v1/places:searchText", bytes.NewReader(body))
	if err != nil {
		return searchTextResponse{}, fmt.Errorf("building search request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.key)
	req.Header.Set("X-Goog-FieldMask", strings.Join([]string{
		"places.id", "places.displayName", "places.location",
		"places.formattedAddress", "places.rating", "places.userRatingCount",
		"places.priceLevel", "places.googleMapsUri", "places.photos",
		"places.regularOpeningHours", "nextPageToken",
	}, ","))

	var parsed searchTextResponse
	if err := c.doJSON(req, &parsed); err != nil {
		return searchTextResponse{}, err
	}
	return parsed, nil
}

// photoURIs resolves up to max photo resource names into key-free, downloadable
// photo URLs (skipHttpRedirect=true returns the final photoUri in the body,
// never the keyed media URL — same rule as cmd/resolvephotos). Individual
// failures are skipped, not fatal: a venue with fewer photos is still worth
// importing (Stage B flags it needs-photos).
func (c *client) photoURIs(ctx context.Context, names []string, max int) []string {
	var out []string
	for _, name := range names {
		if len(out) >= max {
			break
		}
		u := fmt.Sprintf("%s/v1/%s/media?maxWidthPx=800&skipHttpRedirect=true&key=%s",
			c.base, name, url.QueryEscape(c.key))
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			continue
		}
		var parsed struct {
			PhotoURI string `json:"photoUri"`
		}
		if err := c.doJSON(req, &parsed); err != nil || parsed.PhotoURI == "" {
			continue
		}
		out = append(out, parsed.PhotoURI)
	}
	return out
}

func (c *client) doJSON(req *http.Request, dst any) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("calling %s: %w", req.URL.Path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s: status %d: %s", req.URL.Path, resp.StatusCode, truncate(string(data), 800))
	}
	if err := json.Unmarshal(data, dst); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	city := flag.String("city", "", "city to scrape, e.g. \"Belgrade\" (required)")
	country := flag.String("country", "", "country, e.g. \"Serbia\" (recommended, disambiguates the search)")
	out := flag.String("out", "", "output JSON path (required)")
	minRating := flag.Float64("min-rating", 4.0, "minimum Google rating to keep a venue")
	minReviews := flag.Int("min-reviews", 50, "minimum review count to keep a venue")
	pages := flag.Int("pages", 3, "Places result pages per category (20 venues each, max 3)")
	photos := flag.Int("photos", 3, "photo URLs to resolve per venue")
	flag.Parse()

	if *city == "" || *out == "" {
		logger.Error("usage: scrapecity -city <city> -out <file.json> [-country <country>]")
		os.Exit(1)
	}
	key := os.Getenv("GOOGLE_MAPS_API_KEY")
	if key == "" {
		logger.Error("GOOGLE_MAPS_API_KEY is required")
		os.Exit(1)
	}

	c := &client{http: &http.Client{Timeout: 20 * time.Second}, key: key, base: placesBase}
	ctx := context.Background()

	locality := *city
	if *country != "" {
		locality += ", " + *country
	}

	seen := map[string]bool{} // dedupe by Places place id across category queries
	var rows []outputRow
	kept, scanned := 0, 0

	for _, cq := range categoryQueries {
		query := cq.term + " in " + locality
		token := ""
		for page := 0; page < *pages; page++ {
			resp, err := c.searchText(ctx, query, token)
			if err != nil {
				logger.Warn("search page failed", "query", query, "page", page, "error", err)
				break
			}
			for _, p := range resp.Places {
				scanned++
				if seen[p.ID] {
					continue
				}
				if !passesFilter(p, *minRating, *minReviews) {
					continue
				}
				seen[p.ID] = true

				raw, _ := json.Marshal(p)
				rows = append(rows, outputRow{
					Title:     p.DisplayName.Text,
					Category:  string(cq.category),
					Lat:       p.Location.Latitude,
					Lng:       p.Location.Longitude,
					Country:   *country,
					City:      *city,
					Address:   p.FormattedAddress,
					Rating:    p.Rating,
					Details:   buildDetails(cq.category, p),
					PhotoURLs: c.photoURIs(ctx, photoNames(p), *photos),
					SourceURL: p.GoogleMapsURI,
					Raw:       raw,
				})
				kept++
			}
			token = resp.NextPageToken
			if token == "" {
				break
			}
			// Places API (New) needs a brief moment before a fresh
			// nextPageToken becomes valid.
			time.Sleep(2 * time.Second)
		}
		logger.Info("category done", "category", cq.category, "kept_total", kept)
	}

	data, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		logger.Error("marshaling output", "error", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*out, data, 0o644); err != nil {
		logger.Error("writing output", "error", err)
		os.Exit(1)
	}
	logger.Info("scrape complete", "city", *city, "scanned", scanned, "kept", kept, "out", *out)
}

// photoNames flattens a place's photo resource names for resolution.
func photoNames(p place) []string {
	names := make([]string, 0, len(p.Photos))
	for _, ph := range p.Photos {
		names = append(names, ph.Name)
	}
	return names
}
