// Command websitesync scrapes each published Wellness/Entertainment venue's
// own website (resolved live via Google Place Details, never stored — see
// docs/superpowers/specs/2026-08-01-wellness-entertainment-detail-page-design.md)
// for Treatments/Upcoming shows/Good-to-know content Google Places doesn't
// provide, filling in whatever fields the row doesn't already have curated.
// Run weekly. Never wired into activities-service's own startup path, same
// "build/maintenance-time tool" category as cmd/backfilltripadvisor.
//
// Usage: DATABASE_URL=... GOOGLE_MAPS_API_KEY=... FIRECRAWL_API_KEY=... go run ./cmd/websitesync [-dry-run]
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"activities-service/internal/firecrawl"
	"activities-service/internal/places"
	"activities-service/internal/repository"
	"activities-service/internal/service"

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

// listPageSize is this tool's own List pagination page size.
const listPageSize = 200

// syncCategories are the two categories this job covers, per the design
// spec's scope decision.
var syncCategories = []activitiessvc.Category{
	activitiessvc.CategoryWellness,
	activitiessvc.CategoryEntertainment,
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	dryRun := flag.Bool("dry-run", false, "list what would be synced without calling Places, Firecrawl, or writing")
	flag.Parse()

	ctx := context.Background()
	dsn, err := sharedconfig.Require("DATABASE_URL")
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	pool, err := shareddb.Connect(ctx, dsn)
	if err != nil {
		logger.Error("connecting to db", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	repo := repository.New(pool)

	rows, err := publishedRows(ctx, repo, syncCategories, listPageSize)
	if err != nil {
		logger.Error("listing rows", "error", err)
		os.Exit(1)
	}
	logger.Info("found wellness/entertainment rows", "count", len(rows))

	if *dryRun {
		for _, r := range rows {
			logger.Info("would sync", "title", r.Title, "category", r.Category, "id", r.ID)
		}
		return
	}

	placesClient, err := places.NewFromEnv()
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	fc, err := firecrawl.NewFromEnv()
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	svc := service.New(repo).WithPlaces(placesClient).WithFirecrawl(fc)

	var synced, skippedOrFailed int
	for _, r := range rows {
		if err := svc.SyncWebsiteContent(ctx, r.ID); err != nil {
			logger.Warn("sync failed", "title", r.Title, "id", r.ID, "error", err)
			skippedOrFailed++
			continue
		}
		synced++
	}
	logger.Info("website sync complete", "total", len(rows), "synced", synced, "skipped_or_failed", skippedOrFailed)
}

// activityLister is the one repository capability this tool's enumeration
// step needs, same narrowing pattern as cmd/backfilltripadvisor's own
// activityLister.
type activityLister interface {
	List(ctx context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error)
}

// publishedRows pages through every published row in categories. List's own
// Category filter is singular, so this calls it once per category rather
// than filtering client-side across an unfiltered full-catalog scan.
func publishedRows(ctx context.Context, repo activityLister, categories []activitiessvc.Category, pageSize int) ([]activitiessvc.Activity, error) {
	var out []activitiessvc.Activity
	for _, cat := range categories {
		offset := 0
		for {
			result, err := repo.List(ctx, activitiessvc.ListFilter{
				Category: cat, Status: activitiessvc.StatusPublished, Limit: pageSize, Offset: offset,
			})
			if err != nil {
				return nil, err
			}
			out = append(out, result.Activities...)
			offset += len(result.Activities)
			if len(result.Activities) == 0 || offset >= result.Total {
				break
			}
		}
	}
	return out, nil
}
