// Command importlistings is a build-time-only maintenance tool: given a
// scraped listings CSV (name, description, primary_type, lat/lng, rating,
// classification_confidence, ...), it prints an INSERT a maintainer reviews
// and saves as a new activities-service migration. It never writes to the
// DB and is not wired into the service startup path — same contract as
// cmd/resolvephotos (see GO_STANDARDS.md's "seed/build time, not live" rule).
//
// Usage: go run ./cmd/importlistings path/to/listings.csv > out.sql
package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"backend/shared/models/activitiessvc"
)

// listing is one mapped CSV row, ready to render as a SQL VALUES tuple.
type listing struct {
	Title       string
	Description string
	Category    activitiessvc.Category
	Lat         float64
	Lng         float64
	City        string
	Country     string
	Rating      float64
	NeedsReview bool
}

// knownCategories is the 12-value taxonomy (BUSINESS_STANDARDS.md); any
// primary_type whose prefix isn't here falls back to entertainment.
var knownCategories = map[string]activitiessvc.Category{
	"restaurants":   activitiessvc.CategoryRestaurants,
	"cafes":         activitiessvc.CategoryCafes,
	"bars":          activitiessvc.CategoryBars,
	"nightlife":     activitiessvc.CategoryNightlife,
	"nature":        activitiessvc.CategoryNature,
	"sport":         activitiessvc.CategorySport,
	"kids":          activitiessvc.CategoryKids,
	"culture":       activitiessvc.CategoryCulture,
	"art":           activitiessvc.CategoryArt,
	"wellness":      activitiessvc.CategoryWellness,
	"shopping":      activitiessvc.CategoryShopping,
	"entertainment": activitiessvc.CategoryEntertainment,
}

// mapCategory takes the prefix before the first '-' of a primary_type and
// maps it onto the 12-value taxonomy; an unknown prefix becomes
// entertainment, the documented overflow category.
func mapCategory(primaryType string) activitiessvc.Category {
	prefix, _, _ := strings.Cut(primaryType, "-")
	if c, ok := knownCategories[prefix]; ok {
		return c
	}
	return activitiessvc.CategoryEntertainment
}

// parseRating returns the parsed avg_rating, or 0 when empty/unparseable
// (the rating column is NOT NULL; 0 is the documented "no signal" default).
func parseRating(raw string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0
	}
	return f
}

// needsReview flags rows below the 0.5 classification-confidence cutoff, so
// they can be filtered via the existing tags column. Unparseable confidence
// is treated as not-flagged (no false alarms on malformed input).
func needsReview(confidence string) bool {
	f, err := strconv.ParseFloat(strings.TrimSpace(confidence), 64)
	if err != nil {
		return false
	}
	return f < 0.5
}

// detailsJSON returns the hardcoded, category-specific details payload for a
// row of category c, marshaled from the real activitiessvc detail structs so
// the JSON shape can't drift from what the API decodes. Every row of a given
// category shares the same placeholder payload for now; this is the single
// place to swap in CSV-derived data later. An unrecognized category yields
// "{}" (the same "no detail data" default as a row with empty details).
//
// ponytail: static placeholder payloads, not real per-venue data — upgrade
// path is to source these fields from the CSV.
func detailsJSON(c activitiessvc.Category) string {
	var v any
	switch c {
	case activitiessvc.CategoryRestaurants:
		v = activitiessvc.RestaurantDetails{
			Cuisine: "Local & European", PriceTier: "$$",
			Hours: "11:00-23:00", OpenStatus: "Open now",
			PopularDishes: []activitiessvc.ItemPrice{
				{Name: "Chef's Platter", Price: "1200 RSD"},
				{Name: "Grilled Catch of the Day", Price: "1600 RSD"},
			},
		}
	case activitiessvc.CategoryCafes:
		v = activitiessvc.CafeDetails{
			KnownForBrew: "Single-origin pour-over", WifiQuality: "Fast, plenty of outlets",
			Hours: "08:00-22:00",
			OnTheBar: []activitiessvc.ItemPrice{
				{Name: "Flat White", Price: "320 RSD"},
				{Name: "Croissant", Price: "260 RSD"},
			},
		}
	case activitiessvc.CategoryBars:
		v = activitiessvc.BarDetails{
			Vibe: "Relaxed, wood-paneled", HappyHourWindow: "17:00-19:00",
			OpensTime: "16:00", SignaturePours: []string{"House Rakia", "Craft Lager", "Negroni"},
		}
	case activitiessvc.CategoryNightlife:
		v = activitiessvc.NightlifeDetails{
			EntryPrice: "1000 RSD", DressCode: "Smart casual", OpensTime: "23:00",
			OpenTonight: true,
			Lineup: []activitiessvc.LineupItem{
				{Time: "23:30", Act: "Resident DJ", Stage: "Main Floor"},
				{Time: "01:00", Act: "Guest DJ", Stage: "Terrace"},
			},
		}
	case activitiessvc.CategoryNature:
		v = activitiessvc.NatureDetails{
			TimeToSpend: "2-3 hours", BestTime: "Early morning", Cost: "Free",
			GoodToKnow: []string{"Wear comfortable shoes", "Gets busy on weekends"},
		}
	case activitiessvc.CategorySport:
		v = activitiessvc.SportDetails{
			Difficulty: 2, EffortLevel: "Moderate", Duration: "1-2 hours",
			Gear:        "Equipment available on site",
			WhatToBring: []string{"Water bottle", "Sportswear"},
		}
	case activitiessvc.CategoryKids:
		v = activitiessvc.KidsDetails{
			AgeRange:   "All ages",
			Facilities: []string{"Baby changing rooms", "Playground", "Picnic area"},
		}
	case activitiessvc.CategoryCulture:
		v = activitiessvc.CultureDetails{
			VenueType: "Heritage site", TicketPrice: "Free entry", Hours: "09:00-19:00",
			NowShowing: &activitiessvc.Banner{
				Title: "Permanent Collection", Description: "Self-guided visit of the main halls.",
			},
		}
	case activitiessvc.CategoryArt:
		v = activitiessvc.ArtDetails{
			VenueType: "Gallery", TicketPrice: "500 RSD", Hours: "10:00-18:00",
			CurrentExhibition: &activitiessvc.Banner{
				Title: "Contemporary Local Artists", Description: "Rotating group show.",
			},
		}
	case activitiessvc.CategoryWellness:
		v = activitiessvc.WellnessDetails{
			Treatments: []activitiessvc.Treatment{
				{Item: "Sauna & Pool Access", Duration: "Full day", Price: "3500 RSD"},
				{Item: "Relaxing Massage", Duration: "60 min", Price: "4500 RSD"},
			},
			ExternalBookingNote: "Book treatments at least 24 hours in advance.",
		}
	case activitiessvc.CategoryShopping:
		v = activitiessvc.ShoppingDetails{
			VenueType: "Retail", BestDay: "Saturday", Hours: "10:00-21:00",
			WhatYoullFind: []string{"Local boutiques", "Cafés", "Souvenir shops"},
		}
	case activitiessvc.CategoryEntertainment:
		v = activitiessvc.EntertainmentDetails{
			Genre: "Mixed", Neighborhood: "City centre",
			UpcomingShows: []activitiessvc.Show{
				{Date: "2026-08-02", Title: "Weekend Event", TimeOrPrice: "800 RSD"},
			},
		}
	default:
		return "{}"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "{}" // unreachable: all payloads above marshal cleanly
	}
	return string(b)
}

// sqlQuote single-quotes s and doubles any embedded single quote — the only
// escaping SQL string literals here need.
func sqlQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// formatInsertSQL renders rows as one multi-row INSERT a maintainer saves as
// a migration. location is emitted as a raw ST_SetSRID expression (not a
// quoted literal); every text/JSON cell goes through sqlQuote. An empty slice
// produces no statement.
func formatInsertSQL(rows []listing) string {
	if len(rows) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("INSERT INTO activities (title, description, category, location, country, city, rating, tags, details) VALUES\n")
	for i, r := range rows {
		tags := "ARRAY[]::TEXT[]"
		if r.NeedsReview {
			tags = "ARRAY['needs-review']"
		}
		location := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%g, %g), 4326)::geography", r.Lng, r.Lat)
		fmt.Fprintf(&b, "  (%s, %s, %s, %s, %s, %s, %g, %s, %s::jsonb)",
			sqlQuote(r.Title),
			sqlQuote(r.Description),
			sqlQuote(string(r.Category)),
			location,
			sqlQuote(r.Country),
			sqlQuote(r.City),
			r.Rating,
			tags,
			sqlQuote(detailsJSON(r.Category)),
		)
		if i < len(rows)-1 {
			b.WriteString(",\n")
		} else {
			b.WriteString(";\n")
		}
	}
	return b.String()
}

// columnIndex maps required CSV header names to their position, so the parser
// is order-independent (the source CSV column order isn't guaranteed stable).
func columnIndex(header []string) map[string]int {
	idx := make(map[string]int, len(header))
	for i, name := range header {
		idx[strings.TrimSpace(name)] = i
	}
	return idx
}

// parseCSV reads the listings CSV and returns mapped rows. A row whose
// latitude/longitude can't be parsed is logged and skipped (never emitted
// with fake coordinates) — the same "skip, don't fake" rule cmd/resolvephotos
// uses for unresolved photos.
func parseCSV(r io.Reader) ([]listing, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1 // tolerate ragged trailing fields
	records, err := cr.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("reading csv: %w", err)
	}
	if len(records) < 2 {
		return nil, fmt.Errorf("csv has no data rows")
	}
	col := columnIndex(records[0])

	get := func(rec []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(rec) {
			return ""
		}
		return strings.TrimSpace(rec[i])
	}

	var out []listing
	for _, rec := range records[1:] {
		name := get(rec, "name")
		lat, errLat := strconv.ParseFloat(get(rec, "latitude"), 64)
		lng, errLng := strconv.ParseFloat(get(rec, "longitude"), 64)
		if errLat != nil || errLng != nil {
			slog.Warn("skipping row with unparseable coordinates",
				"name", name, "latitude", get(rec, "latitude"), "longitude", get(rec, "longitude"))
			continue
		}
		primary := get(rec, "primary_type")
		category := mapCategory(primary)
		prefix, _, _ := strings.Cut(primary, "-")
		if _, known := knownCategories[prefix]; !known {
			slog.Warn("unmapped primary_type, defaulting to entertainment",
				"name", name, "primary_type", primary)
		}
		out = append(out, listing{
			Title:       name,
			Description: get(rec, "description"),
			Category:    category,
			Lat:         lat,
			Lng:         lng,
			City:        get(rec, "city"),
			Country:     get(rec, "country"),
			Rating:      parseRating(get(rec, "avg_rating")),
			NeedsReview: needsReview(get(rec, "classification_confidence")),
		})
	}
	return out, nil
}

// decision is one reviewed row: the corrected category and the real
// category-specific details, keyed by row name in the decisions file.
type decision struct {
	Category activitiessvc.Category `json:"category"`
	Details  json.RawMessage        `json:"details"`
}

// structForCategory returns a pointer to an empty detail struct matching c,
// used to validate a decision's details against the real API shape. Returns
// nil for an unrecognized category.
func structForCategory(c activitiessvc.Category) any {
	switch c {
	case activitiessvc.CategoryRestaurants:
		return &activitiessvc.RestaurantDetails{}
	case activitiessvc.CategoryCafes:
		return &activitiessvc.CafeDetails{}
	case activitiessvc.CategoryBars:
		return &activitiessvc.BarDetails{}
	case activitiessvc.CategoryNightlife:
		return &activitiessvc.NightlifeDetails{}
	case activitiessvc.CategoryNature:
		return &activitiessvc.NatureDetails{}
	case activitiessvc.CategorySport:
		return &activitiessvc.SportDetails{}
	case activitiessvc.CategoryKids:
		return &activitiessvc.KidsDetails{}
	case activitiessvc.CategoryCulture:
		return &activitiessvc.CultureDetails{}
	case activitiessvc.CategoryArt:
		return &activitiessvc.ArtDetails{}
	case activitiessvc.CategoryWellness:
		return &activitiessvc.WellnessDetails{}
	case activitiessvc.CategoryShopping:
		return &activitiessvc.ShoppingDetails{}
	case activitiessvc.CategoryEntertainment:
		return &activitiessvc.EntertainmentDetails{}
	default:
		return nil
	}
}

// validateDetails decodes raw into the detail struct for category c, rejecting
// unknown fields so a typo in an authored decisions file fails loudly, then
// re-marshals to compact JSON matching exactly what the API decodes.
func validateDetails(c activitiessvc.Category, raw json.RawMessage) (string, error) {
	v := structForCategory(c)
	if v == nil {
		return "", fmt.Errorf("unknown category %q", c)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return "", fmt.Errorf("invalid details for category %q: %w", c, err)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("re-marshaling details for %q: %w", c, err)
	}
	return string(b), nil
}

// loadDecisions reads the review-decisions JSON (name -> decision). Unknown
// object keys are rejected so a mistyped "category"/"details" fails loudly.
func loadDecisions(path string) (map[string]decision, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading decisions: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	var m map[string]decision
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("parsing decisions: %w", err)
	}
	return m, nil
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	if len(os.Args) < 2 {
		logger.Error("usage: importlistings path/to/listings.csv")
		os.Exit(1)
	}
	f, err := os.Open(os.Args[1])
	if err != nil {
		logger.Error("opening csv", "error", err)
		os.Exit(1)
	}
	defer func() { _ = f.Close() }()

	rows, err := parseCSV(f)
	if err != nil {
		logger.Error("parsing csv", "error", err)
		os.Exit(1)
	}
	fmt.Print(formatInsertSQL(rows))
}
