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
