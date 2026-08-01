// Command scrapecity runs type-driven discovery against a city. With
// -count-only (the default) it writes nothing and resolves no photos: it
// exists to prove the placesmap.DiscoveryRows table before any ingest
// depends on it, reporting per-subtype yields. A row yielding zero venues is
// a mapping bug — a Table A type that does not exist, or a subtype that
// genuinely needs the phrase fallback.
//
// With -count-only=false it pre-warms a city: it runs every discovery row at
// the anchor through the service's own lazy-sync code (service.PrewarmGoogle),
// ingesting whatever passes the quality floor, so a city is no longer thin on
// its first live search.
//
// Build/seed-time maintenance tool; not wired into service startup.
// Requires GOOGLE_MAPS_API_KEY (Places API New enabled); pre-warm mode also
// requires DATABASE_URL.
//
// Usage:
//
//	GOOGLE_MAPS_API_KEY=... go run ./cmd/scrapecity \
//	  -city "Belgrade" -lat 44.8125 -lng 20.4612 [-radius-km 10]
//
//	GOOGLE_MAPS_API_KEY=... DATABASE_URL=... go run ./cmd/scrapecity \
//	  -city "Belgrade" -lat 44.8125 -lng 20.4612 -count-only=false
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"sort"

	"activities-service/internal/places"
	"activities-service/internal/placesmap"
	"activities-service/internal/repository"
	"activities-service/internal/service"

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

// The quality floor lives in placesmap (MinRating/MinReviews/PassesFloor),
// shared with the live sync — a dry run that filtered differently from the
// real ingest would report numbers nobody could act on.

// yield is one discovery row's outcome: how many places the API returned and
// how many survived the quality floor.
type yield struct {
	found int
	kept  int
}

// yieldLine is one row of the printed report.
type yieldLine struct {
	category string
	subtype  string
	found    int
	kept     int
	// empty flags a row that returned nothing at all — the finding this
	// whole dry run exists to surface.
	empty bool
}

// rowYield joins the discovery table against observed counts, in table
// order, so a row that returned nothing still appears in the report instead
// of silently missing from it.
func rowYield(rows []placesmap.DiscoveryRow, counts map[string]yield) []yieldLine {
	lines := make([]yieldLine, 0, len(rows))
	for _, r := range rows {
		y := counts[string(r.Category)+"|"+r.Subtype]
		lines = append(lines, yieldLine{
			category: string(r.Category),
			subtype:  r.Subtype,
			found:    y.found,
			kept:     y.kept,
			empty:    y.found == 0,
		})
	}
	return lines
}

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	city := flag.String("city", "", "city name, for the report header (required)")
	lat := flag.Float64("lat", 0, "anchor latitude (required)")
	lng := flag.Float64("lng", 0, "anchor longitude (required)")
	radiusKM := flag.Float64("radius-km", 10, "search radius in km, max 50 (count-only mode only; pre-warm always uses the sync's own radius)")
	countOnly := flag.Bool("count-only", true, "report yields without writing anything")
	flag.Parse()

	if *city == "" || *lat == 0 || *lng == 0 {
		slog.Error("usage: scrapecity -city <city> -lat <lat> -lng <lng> [-radius-km 10]")
		os.Exit(1)
	}
	if *radiusKM > 50 {
		slog.Error("radius-km exceeds the Places API maximum of 50")
		os.Exit(1)
	}

	if !*countOnly {
		prewarm(context.Background(), *lat, *lng)
		return
	}

	c, err := places.NewFromEnv()
	if err != nil {
		slog.Error("places client setup failed", "error", err)
		os.Exit(1)
	}
	ctx := context.Background()

	// Restaurants/Bars rows exist in DiscoveryRows for classification only
	// (placesmap.Subtype) — Google never discovers them, same gate as
	// googleDueRows/PrewarmGoogle, so this dry run neither fires live calls
	// for them nor reports yields nobody will ever ingest.
	googleRows := make([]placesmap.DiscoveryRow, 0, len(placesmap.DiscoveryRows))
	for _, row := range placesmap.DiscoveryRows {
		if slices.Contains(placesmap.GoogleCategories, row.Category) {
			googleRows = append(googleRows, row)
		}
	}

	counts := map[string]yield{}
	seen := map[string]bool{}
	var duplicates int

	for _, row := range googleRows {
		found, err := discover(ctx, c, row, *lat, *lng, *radiusKM)
		if err != nil {
			slog.Warn("discovery row failed", "category", row.Category, "subtype", row.Subtype, "error", err)
			continue
		}
		y := yield{found: len(found)}
		for _, p := range found {
			if seen[p.ID] {
				duplicates++
				continue
			}
			seen[p.ID] = true
			if placesmap.PassesFloor(p) {
				y.kept++
			}
		}
		counts[string(row.Category)+"|"+row.Subtype] = y
	}

	report(rowYield(googleRows, counts), *city, len(seen), duplicates)
}

// discover runs one row: searchNearby when the row has Table A types,
// area-bounded searchText when it falls back to a phrase.
func discover(ctx context.Context, c *places.Client, row placesmap.DiscoveryRow, lat, lng, radiusKM float64) ([]placesmap.Place, error) {
	if len(row.Types) > 0 {
		return c.SearchNearby(ctx, places.NearbyRequest{
			Lat: lat, Lng: lng, RadiusM: radiusKM * 1000,
			IncludedTypes: row.Types, MaxResults: 20,
		}, places.NearbyFieldMask)
	}
	return c.SearchTextInArea(ctx, row.TextQuery, lat, lng, radiusKM, places.NearbyFieldMask)
}

// report prints the yield table to stdout, empty rows last so mapping bugs
// are the last thing on screen rather than buried mid-table.
func report(lines []yieldLine, city string, unique, duplicates int) {
	sort.SliceStable(lines, func(i, j int) bool {
		if lines[i].empty != lines[j].empty {
			return !lines[i].empty
		}
		return lines[i].category < lines[j].category
	})

	fmt.Printf("\nType-driven discovery dry run: %s\n", city)
	fmt.Printf("%-16s %-20s %7s %7s\n", "CATEGORY", "SUBTYPE", "FOUND", "KEPT")
	totalFound, totalKept, empties := 0, 0, 0
	for _, l := range lines {
		sub := l.subtype
		if sub == "" {
			sub = "(category-level)"
		}
		flag := ""
		if l.empty {
			flag = "  <-- ZERO: check the types for this row"
			empties++
		}
		fmt.Printf("%-16s %-20s %7d %7d%s\n", l.category, sub, l.found, l.kept, flag)
		totalFound += l.found
		totalKept += l.kept
	}
	fmt.Printf("\nrows=%d  zero-yield=%d  found=%d  kept=%d  unique=%d  cross-row duplicates=%d\n",
		len(lines), empties, totalFound, totalKept, unique, duplicates)
}

// prewarm runs every discovery row for one anchor through the service's own
// sync, ignoring the TTL and the per-query budget. This is the answer to
// "a cold city is thin on the first search": run it before a city ships.
//
// It deliberately calls the same service code the lazy sync uses rather than
// reimplementing discovery — two implementations of one job is how the batch
// pipeline and the sync would drift apart again.
func prewarm(ctx context.Context, lat, lng float64) {
	dsn, err := sharedconfig.Require("DATABASE_URL")
	if err != nil {
		slog.Error("config", "error", err)
		os.Exit(1)
	}
	pool, err := shareddb.Connect(ctx, dsn)
	if err != nil {
		slog.Error("connecting to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	pc, err := places.NewFromEnv()
	if err != nil {
		slog.Error("places client setup failed", "error", err)
		os.Exit(1)
	}
	svc := service.New(repository.New(pool)).WithPlaces(pc)
	svc.PrewarmGoogle(ctx, activitiessvc.Point{Lat: lat, Lng: lng})
	slog.Info("prewarm complete", "lat", lat, "lng", lng)
}
