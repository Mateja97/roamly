// Command backfillgoogleplaceid resolves a Google place id for
// already-stored Tripadvisor rows that don't have one yet — venues synced
// before tripadvisor-google-review-fallback T1 added google_place_id, or a
// row whose live sync resolve missed at the time. Reuses
// service.Activities.ResolveTripadvisorSubtype (T1) — the same
// search-by-name-then-verify-identity path a live Tripadvisor sync already
// runs per venue — so this needs no second Places search/match algorithm to
// keep in sync with the first; only the resolver's second return value (the
// matched place id) is kept here, the subtype itself is discarded since T1's
// live sync already persists it.
//
// Modelled directly on cmd/backfillsubtype: sequential, not a worker pool
// (one-time pass, not a repeating hot path); a fixed pace between Places
// calls (see backfillPace); every resolved row written the moment it
// resolves via repository.SetGooglePlaceIDIfEmpty, never batched into one
// transaction, so the WHERE google_place_id is empty on both the read (this
// file) and the write (SetGooglePlaceIDIfEmpty) side is the entire resume
// mechanism — simply re-running the tool picks up only whatever is still
// empty, no checkpoint file needed. A row whose resolve returns no id is
// counted and left empty, never written with a guess.
//
// Live-writing, but a build/maintenance-time tool: never wired into
// activities-service's own startup path, run by hand only.
//
// Usage: DATABASE_URL=... GOOGLE_MAPS_API_KEY=... go run ./cmd/backfillgoogleplaceid [-dry-run] [-limit 50]
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"time"

	"activities-service/internal/places"
	"activities-service/internal/repository"
	"activities-service/internal/service"

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

// listPageSize is this tool's own List pagination page size, same knob as
// cmd/backfillsubtype's listPageSize (List is our admin catalog query, not a
// Places call, so this has nothing to do with Places quota).
const listPageSize = 200

// backfillPace is the fixed sleep between Places calls — a conservative,
// explicit floor under Places' own per-project QPS quota, independent of
// however fast a given call happens to answer. Same value and same reasoning
// as cmd/backfillsubtype's backfillPace. ponytail: a flat sleep, not a
// token-bucket limiter — right-sized for a few hundred one-time calls; reach
// for golang.org/x/time/rate if this tool ever needs to process thousands of
// rows or run on a schedule.
const backfillPace = 200 * time.Millisecond

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	dryRun := flag.Bool("dry-run", false, "report how many rows are candidates without calling Places or writing")
	limit := flag.Int("limit", 0, "stop after processing this many rows (0 = no cap); lets a run be staged across multiple invocations against a tight daily quota")
	flag.Parse()

	// CallerBatchTool (T1, places-api-cost-reduction): every Places call this
	// tool makes goes through ResolveTripadvisorSubtype, run by hand over
	// stored rows.
	ctx := places.WithCaller(context.Background(), places.CallerBatchTool)
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

	rows, err := emptyGooglePlaceIDRows(ctx, repo, listPageSize)
	if err != nil {
		logger.Error("listing rows", "error", err)
		os.Exit(1)
	}
	logger.Info("found tripadvisor rows with no google_place_id", "count", len(rows))

	if *dryRun {
		logger.Info("dry run: nothing written", "scanned", len(rows))
		return
	}

	placesClient, err := places.NewFromEnv()
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	svc := service.New(repo).WithPlaces(placesClient)

	result := runBackfill(ctx, svc, repo, rows, *limit, func() { time.Sleep(backfillPace) })
	logger.Info("backfill complete",
		"scanned", len(rows),
		"processed", result.processed,
		"resolved", result.resolved,
		"written", result.written,
		"already_set", result.alreadySet,
		"missed", result.missed,
		"failed", result.failed,
	)
}

// activityLister is the one repository capability this tool's enumeration
// step needs — narrowed so a test can fake pagination without a real DB,
// same pattern as cmd/backfillsubtype's activityLister.
type activityLister interface {
	List(ctx context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error)
}

// emptyGooglePlaceIDRows pages through every published row (List has no
// Source/GooglePlaceID filter of its own — narrowing further isn't worth
// adding one to the shared admin query contract for this one-off need, same
// reasoning as cmd/backfillsubtype's candidateRows) and keeps the ones
// whose Source is "tripadvisor" and whose GooglePlaceID is still "".
func emptyGooglePlaceIDRows(ctx context.Context, repo activityLister, pageSize int) ([]activitiessvc.Activity, error) {
	var out []activitiessvc.Activity
	offset := 0
	for {
		result, err := repo.List(ctx, activitiessvc.ListFilter{Status: activitiessvc.StatusPublished, Limit: pageSize, Offset: offset})
		if err != nil {
			return nil, err
		}
		for _, a := range result.Activities {
			if a.Source == "tripadvisor" && a.GooglePlaceID == "" {
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

// placeIDResolver is svc.ResolveTripadvisorSubtype's shape — narrowed so
// runBackfill is testable against a fake, without needing a fake that
// satisfies service.Activities' whole (unexported) repository interface.
// The first return value (the subtype) isn't this tool's concern — T1's
// live sync already persists it — so runBackfill discards it.
type placeIDResolver interface {
	ResolveTripadvisorSubtype(ctx context.Context, category activitiessvc.Category, name string, lat, lng float64, locationID, priceLevel string) (string, string)
}

// googlePlaceIDSetter is repository.Activities.SetGooglePlaceIDIfEmpty's
// shape, same narrowing reasoning as placeIDResolver.
type googlePlaceIDSetter interface {
	SetGooglePlaceIDIfEmpty(ctx context.Context, id, placeID string) (bool, error)
}

// backfillResult tallies one run: processed is every row this run actually
// looked at (bounded by limit, unlike scanned which is every candidate the
// read step found); resolved is rows whose resolve returned a non-empty
// place id (regardless of whether the write below then landed); missed is
// rows whose resolve returned no id at all — skipped and counted, never
// written with a guess; written is rows this run actually persisted;
// alreadySet is rows SetGooglePlaceIDIfEmpty's WHERE guard rejected because
// something else (a live sync) resolved the same row between the list read
// and this write; failed is a write error, counted separately from a
// resolve miss since one means the venue couldn't be matched and the other
// means the match was good but the write broke.
type backfillResult struct {
	processed, resolved, missed, written, alreadySet, failed int
}

// runBackfill resolves rows in place, one at a time, in the order rows is
// given — sequential, not worker-pool, see package doc for why. pace is
// called once per row (a func, not a raw sleep, so tests run instantly) —
// resolver early-returns without an HTTP call for a row with no name/coords,
// so this is a slight over-pace on those rows, not an under-pace. limit caps
// how many rows get processed this run (0 = every row); the rest are simply
// left for the next invocation, no different from how a mid-run failure
// leaves them.
func runBackfill(ctx context.Context, resolver placeIDResolver, setter googlePlaceIDSetter, rows []activitiessvc.Activity, limit int, pace func()) backfillResult {
	var result backfillResult
	for i, a := range rows {
		if limit > 0 && i >= limit {
			break
		}
		result.processed++
		// priceLevel is "" — this tool only wants the place id, and price
		// never affects it.
		_, placeID := resolver.ResolveTripadvisorSubtype(ctx, a.Category, a.Title, a.Location.Lat, a.Location.Lng, a.ExternalID, "")
		pace()
		if placeID == "" {
			result.missed++
			continue
		}
		result.resolved++
		wrote, err := setter.SetGooglePlaceIDIfEmpty(ctx, a.ID, placeID)
		if err != nil {
			slog.Warn("writing resolved google place id failed", "id", a.ID, "title", a.Title, "error", err)
			result.failed++
			continue
		}
		if !wrote {
			result.alreadySet++
			continue
		}
		result.written++
	}
	return result
}
