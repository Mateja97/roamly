// Command fixdetails recomputes every activity's details payload from its own
// stored Places raw, using the shared placesmap mapping. It fixes rows whose
// details were written under the wrong per-category field names by an earlier
// scrapecity, touching 100% of rows regardless of what a fresh scrape returns.
// Idempotent: re-running converges to the same details. Build/seed-time
// maintenance tool. Requires DATABASE_URL.
//
// Usage:
//
//	DATABASE_URL=... go run ./cmd/fixdetails [-dry-run]
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log/slog"
	"os"

	"activities-service/internal/placesmap"
	"activities-service/internal/repository"

	"backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	dryRun := flag.Bool("dry-run", false, "log what would change without writing")
	flag.Parse()

	ctx := context.Background()
	dsn, err := config.Require("DATABASE_URL")
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

	rows, err := repo.RawRows(ctx)
	if err != nil {
		logger.Error("reading rows", "error", err)
		os.Exit(1)
	}

	updated, failed := 0, 0
	for _, row := range rows {
		var p placesmap.Place
		if err := json.Unmarshal(row.Raw, &p); err != nil {
			logger.Warn("skipping row with unparseable raw", "id", row.ID, "error", err)
			failed++
			continue
		}
		details := placesmap.BuildDetails(row.Category, p)
		if *dryRun {
			logger.Info("would update", "id", row.ID, "category", row.Category, "details", string(details))
			continue
		}
		if _, err := repo.Update(ctx, row.ID, activitiessvc.UpdatePatch{Details: &details}); err != nil {
			logger.Warn("update failed", "id", row.ID, "error", err)
			failed++
			continue
		}
		updated++
	}
	logger.Info("fixdetails complete", "rows", len(rows), "updated", updated, "failed", failed, "dry_run", *dryRun)
}
