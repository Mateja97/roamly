// Command scrapecity is Stage A of the per-city ingestion pipeline: it
// queries the Google Places API (New) across the 12 activity categories for a
// city, keeps only high-confidence, relevant venues (rating + review-count
// floor), resolves ONE provisional/listing photo URL each (the remaining
// photos, if any, resolve later on first detail view — see T2), and writes a
// <city>.json in the exact shape cmd/importcity reads. Build/seed-time
// maintenance tool; not wired into service startup. Requires
// GOOGLE_MAPS_API_KEY (Places API New enabled).
//
// Usage:
//
//	GOOGLE_MAPS_API_KEY=... go run ./cmd/scrapecity \
//	  -city "Belgrade" -country "Serbia" -out belgrade.json \
//	  [-min-rating 4.0] [-min-reviews 50] [-pages 3] [-photos 1]
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log/slog"
	"os"
	"strings"
	"time"

	"activities-service/internal/places"
	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

// fieldMask selects the place fields scrapecity needs for its 12-category
// scrape; other Places call sites (e.g. a photo-only lookup) ask for less.
var fieldMask = strings.Join([]string{
	"places.id", "places.displayName", "places.location",
	"places.formattedAddress", "places.rating", "places.userRatingCount",
	"places.priceLevel", "places.googleMapsUri", "places.photos",
	"places.regularOpeningHours", "places.primaryTypeDisplayName",
	"places.primaryType", "places.types", "nextPageToken",
}, ",")

// categoryQueries maps each of the remaining 9 Google-sourced taxonomy
// categories to the Places Text Search term used to discover its venues.
// Restaurants, Cafés and Bars are deliberately absent — they're sourced
// exclusively from the Tripadvisor Content API via
// service.Activities.Query's lazy sync, not this batch pipeline (see
// docs/superpowers/specs/2026-07-29-tripadvisor-restaurants-bars-design.md
// and tripadvisormap.Category). One term per remaining category keeps the
// request budget small; add variants later if coverage of a thin category
// (kids, art) proves too sparse.
var categoryQueries = []struct {
	category activitiessvc.Category
	term     string
}{
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

// outputRow mirrors cmd/importcity's inputRow — the two files are the
// contract between Stage A and Stage B. PrimaryType/Types are captured here
// ahead of a downstream subtype consumer; importcity's inputRow doesn't read
// them yet.
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
	// PlaceID is the Places place_id (p.ID) — the stable identifier that
	// becomes activities.external_id, distinct from SourceURL (the Maps URI).
	PlaceID string `json:"place_id"`
	// PrimaryType and Types are the raw Places machine type, captured for a
	// downstream subtype mapping (T2); not consumed here.
	PrimaryType string          `json:"primary_type,omitempty"`
	Types       []string        `json:"types,omitempty"`
	Raw         json.RawMessage `json:"raw"`
}

// toOutputRow maps one already-filtered Place onto the Stage-A output row.
// Pulled out of the scan loop so the field-by-field mapping (in particular
// PrimaryType/Types surviving the parse-to-persist hop) is directly
// testable without a live Places call.
func toOutputRow(cat activitiessvc.Category, city, country string, p placesmap.Place, photoURLs []string) outputRow {
	raw, _ := json.Marshal(p)
	return outputRow{
		Title:       p.DisplayName.Text,
		Category:    string(cat),
		Lat:         p.Location.Latitude,
		Lng:         p.Location.Longitude,
		Country:     country,
		City:        city,
		Address:     p.FormattedAddress,
		Rating:      p.Rating,
		Details:     placesmap.BuildDetails(cat, city, p),
		PhotoURLs:   photoURLs,
		SourceURL:   p.GoogleMapsURI,
		PlaceID:     p.ID,
		PrimaryType: p.PrimaryType,
		Types:       p.Types,
		Raw:         raw,
	}
}

// passesFilter is the "high confidence + relevant" gate: a venue must clear
// both the rating floor and the review-count floor. Review count matters as
// much as rating — a 5.0 with 3 reviews is noise, not signal.
func passesFilter(p placesmap.Place, minRating float64, minReviews int) bool {
	return p.Rating >= minRating && p.UserRatingCount >= minReviews
}

// photoURIs resolves up to max photo resource names into key-free, downloadable
// photo URLs (same rule as cmd/resolvephotos: skipHttpRedirect via
// places.Client). Individual failures are skipped, not fatal: a venue with
// fewer photos is still worth importing (Stage B flags it needs-photos).
func photoURIs(ctx context.Context, c *places.Client, names []string, max int) []string {
	var out []string
	for _, name := range names {
		if len(out) >= max {
			break
		}
		uri, err := c.PhotoMediaURL(ctx, name)
		if err != nil || uri == "" {
			continue
		}
		out = append(out, uri)
	}
	return out
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
	// photos is the provisional/listing photo count, deliberately 1: the full
	// set resolves on-demand on first detail view (T2), not at scrape time.
	photos := flag.Int("photos", 1, "photo URLs to resolve per venue")
	flag.Parse()

	if *city == "" || *out == "" {
		logger.Error("usage: scrapecity -city <city> -out <file.json> [-country <country>]")
		os.Exit(1)
	}
	c, err := places.NewFromEnv()
	if err != nil {
		logger.Error("places client setup failed", "error", err)
		os.Exit(1)
	}
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
			resp, err := c.SearchText(ctx, query, token, fieldMask)
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

				photoURLs := photoURIs(ctx, c, photoNames(p), *photos)
				rows = append(rows, toOutputRow(cq.category, *city, *country, p, photoURLs))
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
func photoNames(p placesmap.Place) []string {
	names := make([]string, 0, len(p.Photos))
	for _, ph := range p.Photos {
		names = append(names, ph.Name)
	}
	return names
}
