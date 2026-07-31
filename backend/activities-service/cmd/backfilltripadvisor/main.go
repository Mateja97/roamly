// Command backfilltripadvisor re-fetches every already-stored
// Tripadvisor-sourced activity directly by its known external_id (the
// Tripadvisor location ID), bypassing NearbySearch discovery entirely —
// the guaranteed-full-coverage counterpart to internal/service's lazy
// syncTripadvisorAnchor sweep, which only ever re-touches whichever
// locations a fresh discovery snapshot happens to resurface (capped at
// nearbySearchMaxPages pages, so a city with more known venues than that
// cap isn't fully refreshed by any single sweep — verified live: one
// Belgrade sweep landed real descriptions on only ~12 of 69 already-known
// rows). Run this once after a schema/decode change that adds fields to
// already-ingested rows (places-live-details' description/attributes/
// recommended_visit_length decoding is the case that motivated this tool)
// so every existing row gets the new data immediately, rather than waiting
// on however many natural query-triggered sweeps it takes to resurface
// each one.
//
// Live-writing, but still a build/maintenance-time tool in the same sense
// as cmd/importcity and cmd/scrapecity: it's never wired into
// activities-service's own startup path, run by hand only.
//
// Usage: DATABASE_URL=... TRIPADVISOR_API_KEY=... go run ./cmd/backfilltripadvisor [-city Belgrade] [-dry-run]
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"activities-service/internal/repository"
	"activities-service/internal/service"
	"activities-service/internal/tripadvisor"

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

// listPageSize is this tool's own List pagination page size — a tuning
// knob, not a Terra-imposed limit (List is our admin catalog query, not a
// Tripadvisor call).
const listPageSize = 200

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	city := flag.String("city", "", "limit to this exact `city` column value (case-sensitive, exact match only — e.g. real Tripadvisor rows for one metro area can be split across \"Belgrade\", \"Stari Grad\", \"Novi Belgrade\", etc., so this flag alone won't necessarily cover \"the whole city\"); empty = every city")
	dryRun := flag.Bool("dry-run", false, "list what would be refreshed without calling Tripadvisor or writing")
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

	rows, err := tripadvisorSourcedRows(ctx, repo, *city, listPageSize)
	if err != nil {
		logger.Error("listing tripadvisor rows", "error", err)
		os.Exit(1)
	}
	logger.Info("found tripadvisor-sourced rows", "count", len(rows), "city", *city)

	if *dryRun {
		for _, r := range rows {
			logger.Info("would refresh", "title", r.Title, "category", r.Category, "external_id", r.ExternalID, "city", r.City)
		}
		return
	}

	taClient, err := tripadvisor.NewFromEnv()
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	svc := service.New(repo).WithTripadvisor(taClient)

	var refreshed, failed int
	for _, r := range rows {
		if err := svc.RefreshTripadvisorLocation(ctx, r.Category, r.ExternalID); err != nil {
			logger.Warn("refresh failed", "title", r.Title, "external_id", r.ExternalID, "error", err)
			failed++
			continue
		}
		refreshed++
	}
	logger.Info("backfill complete", "total", len(rows), "refreshed", refreshed, "failed", failed)
	if failed > 0 {
		os.Exit(1)
	}
}

// activityLister is the one repository capability this tool's enumeration
// step needs — narrowed so a test can fake pagination without a real DB,
// same "narrow interface, defined by the consumer" pattern as
// internal/service's own repository/placesClient/tripadvisorClient
// interfaces. *repository.Activities satisfies this with no extra wiring.
type activityLister interface {
	List(ctx context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error)
}

// tripadvisorSourcedRows pages through the full admin catalog (List's own
// doc: unlike the public query path, no status restriction is baked in, so
// draft/pending Tripadvisor rows get backfilled too) collecting every row
// whose Source is "tripadvisor" and ExternalID is set. City narrows via
// List's own filter (a real WHERE clause) rather than a client-side scan;
// the Source/ExternalID check has to happen client-side since List has no
// Source filter of its own — this tool's one caller doesn't justify adding
// one to the shared admin query contract for a one-off maintenance need.
// pageSize is a parameter (not just the listPageSize const) so a test can
// force multiple pages over a small fixture without needing 200+ rows.
func tripadvisorSourcedRows(ctx context.Context, repo activityLister, city string, pageSize int) ([]activitiessvc.Activity, error) {
	var out []activitiessvc.Activity
	offset := 0
	for {
		result, err := repo.List(ctx, activitiessvc.ListFilter{City: city, Limit: pageSize, Offset: offset})
		if err != nil {
			return nil, err
		}
		for _, a := range result.Activities {
			if a.Source == "tripadvisor" && a.ExternalID != "" {
				out = append(out, a)
			}
		}
		offset += len(result.Activities)
		if len(result.Activities) == 0 || offset >= result.Total {
			break
		}
	}
	return out, nil
}
