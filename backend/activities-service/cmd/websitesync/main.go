// Command websitesync scrapes each published Wellness/Entertainment/Culture/
// Art/Sport/Shopping venue's own website (resolved live via Google
// Place Details, never stored — see
// docs/superpowers/specs/2026-08-01-wellness-entertainment-detail-page-design.md
// and
// docs/superpowers/specs/2026-08-02-culture-art-sport-website-enrichment-design.md)
// for content Google Places doesn't provide, filling in whatever fields
// the row doesn't already have curated. A category is skipped permanently
// once its fields are all filled — see internal/service/websitesync.go's
// isComplete — except the perishable ones (Entertainment), whose content
// names a date rather than the venue and so keeps re-scanning; see
// perishableFields. Run periodically —
// never wired into activities-service's own startup path, same
// "build/maintenance-time tool" category as cmd/backfilltripadvisor.
//
// Usage: DATABASE_URL=... GOOGLE_MAPS_API_KEY=... FIRECRAWL_API_KEY=... go run ./cmd/websitesync [-dry-run] [-limit 25] [-category sport]
//
// Every row costs one Firecrawl extract plus one Places call, so -limit
// (a cap PER CATEGORY) and -category exist to pilot a category before
// committing to it unbounded.
//
// A non-Entertainment row that stays incomplete only ever gets one
// automatic attempt (see internal/service/websitesync.go's
// SyncWebsiteContent) — to force a specific row to be re-attempted anyway:
// DATABASE_URL=... GOOGLE_MAPS_API_KEY=... FIRECRAWL_API_KEY=... go run ./cmd/websitesync -retry-id=<activity-id>
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

// syncCategories are the categories this job covers, per the design specs'
// scope decisions.
//
// Nightlife is deliberately absent. It was built and piloted on 25 rows:
// three of eight extractions were literal placeholders ("Event 1", "Event
// Name 2") with invented times and stages, and the rest were a hotel's meal
// times, a generic opening-hours blurb, and a 2023 date. Club websites do
// not publish lineups — that content lives on social media — so the failure
// is the source, not the prompt, and no rewording recovers it. Rendering
// fabricated acts under the app's "Tonight" heading is worse than rendering
// nothing. Adding a category here also requires an entry in
// internal/service/websitesync.go's extractionConfig and
// scraperOwnedFields — this list alone doesn't teach SyncWebsiteContent
// anything new, it only decides which rows get enumerated.
var syncCategories = []activitiessvc.Category{
	activitiessvc.CategoryWellness,
	activitiessvc.CategoryEntertainment,
	activitiessvc.CategoryCulture,
	activitiessvc.CategoryArt,
	activitiessvc.CategorySport,
	activitiessvc.CategoryShopping,
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	dryRun := flag.Bool("dry-run", false, "list what would be synced without calling Places, Firecrawl, or writing")
	limit := flag.Int("limit", 0, "stop after this many rows PER CATEGORY (0 = no cap); every row costs a Firecrawl extract plus a Places call, so pilot a new category before running it unbounded")
	category := flag.String("category", "", "restrict the run to one category slug (default: every category in syncCategories)")
	retryID := flag.String("retry-id", "", "force a single activity to be re-attempted, bypassing the one-attempt-and-give-up skip (see package doc) — ignores -dry-run; no-op on a row that's already permanently complete for its category (nothing left to fill), except Entertainment")
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

	if *retryID != "" {
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
		if err := svc.SyncWebsiteContent(ctx, *retryID, true); err != nil {
			logger.Error("retry failed", "id", *retryID, "error", err)
			os.Exit(1)
		}
		logger.Info("retry complete", "id", *retryID)
		return
	}

	categories := syncCategories
	if *category != "" {
		if !activitiessvc.Category(*category).Valid() {
			logger.Error("startup failed: unknown -category", "category", *category)
			os.Exit(1)
		}
		categories = []activitiessvc.Category{activitiessvc.Category(*category)}
	}

	rows, err := publishedRows(ctx, repo, categories, listPageSize, *limit)
	if err != nil {
		logger.Error("listing rows", "error", err)
		os.Exit(1)
	}
	logger.Info("found published rows", "count", len(rows), "per_category_limit", *limit)

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
		if err := svc.SyncWebsiteContent(ctx, r.ID, false); err != nil {
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
//
// perCategoryLimit caps how many rows each category contributes (0 = no
// cap). Per category, not overall, because the categories differ by an order
// of magnitude in size — a single overall cap applied to a list built
// category-by-category would spend the whole budget on the first category
// and never reach the last, which is useless for a pilot whose entire
// purpose is comparing extraction quality across categories.
//
// The cap also stops the paging early, so a pilot doesn't enumerate 1,443
// shopping rows to keep 25.
func publishedRows(ctx context.Context, repo activityLister, categories []activitiessvc.Category, pageSize, perCategoryLimit int) ([]activitiessvc.Activity, error) {
	var out []activitiessvc.Activity
	for _, cat := range categories {
		offset := 0
		taken := 0
		for {
			pageLimit := pageSize
			if perCategoryLimit > 0 && perCategoryLimit-taken < pageLimit {
				pageLimit = perCategoryLimit - taken
			}
			result, err := repo.List(ctx, activitiessvc.ListFilter{
				Category: cat, Status: activitiessvc.StatusPublished, Limit: pageLimit, Offset: offset,
			})
			if err != nil {
				return nil, err
			}
			out = append(out, result.Activities...)
			taken += len(result.Activities)
			offset += len(result.Activities)
			if len(result.Activities) == 0 || offset >= result.Total {
				break
			}
			if perCategoryLimit > 0 && taken >= perCategoryLimit {
				break
			}
		}
	}
	return out, nil
}
