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
	"encoding/json"
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
