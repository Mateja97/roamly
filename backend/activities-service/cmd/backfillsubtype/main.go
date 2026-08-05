// Command backfillsubtype classifies already-stored activities that were
// ingested before T2 added subtype resolution: every published row where
// source is "tripadvisor" or "firecrawl" (the legacy import) and subcategory
// is still "". Reuses service.Activities.ResolveTripadvisorSubtype (T2) —
// the same resolve-by-name-then-classify-by-Google-type path a live
// Tripadvisor sync already uses per venue — so this needs no second
// classification algorithm to keep in sync with the first.
// google_places rows are touched only when the venue's name carries a local
// venue-type keyword (shisha, kafana) — see keepCandidates. Their otherwise
// empty subcategory is still left alone: that is the deliberate Subtype: ""
// discovery row (see placesmap.DiscoveryRows), not a defect.
//
// Sequential by design, not pool-of-goroutines like the live sync
// (syncVenueConcurrency): this is a one-time pass over ~210 rows, not a
// repeating hot path, so a plain loop with a fixed pace between Places
// calls (see backfillPace) is the whole rate-limiting story — no new
// limiter type earns its keep at this volume.
//
// Every classified row is written the moment it resolves via
// repository.SetSubcategoryIfEmpty, not batched into one transaction: a
// mid-run failure (quota exhausted, network error) leaves every
// already-classified row committed, and simply re-running the tool picks up
// only whatever is still empty — the WHERE subcategory = ” on both the
// read (this file) and the write (SetSubcategoryIfEmpty) side is the entire
// resume mechanism, no checkpoint file needed.
//
// Live-writing, but a build/maintenance-time tool in the same sense as
// cmd/backfilltripadvisor: never wired into activities-service's own
// startup path, run by hand only.
//
// Usage: DATABASE_URL=... GOOGLE_MAPS_API_KEY=... go run ./cmd/backfillsubtype [-dry-run] [-limit 50]
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"time"

	"activities-service/internal/namemap"
	"activities-service/internal/places"
	"activities-service/internal/repository"
	"activities-service/internal/service"

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

// listPageSize is this tool's own List pagination page size, same knob as
// cmd/backfilltripadvisor's listPageSize (List is our admin catalog query,
// not a Places call, so this has nothing to do with Places quota).
const listPageSize = 200

// backfillSources are the only activities.source values T3 backfills.
// google_places is deliberately absent (see package doc).
var backfillSources = []string{"tripadvisor", "firecrawl"}

// backfillPace is the fixed sleep between Places calls — a conservative,
// explicit floor under Places' own per-project QPS quota, independent of
// however fast a given call happens to answer. ponytail: a flat sleep, not
// a token-bucket limiter — right-sized for a few hundred one-time calls;
// reach for golang.org/x/time/rate if this tool ever needs to process
// thousands of rows or run on a schedule.
const backfillPace = 200 * time.Millisecond

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	dryRun := flag.Bool("dry-run", false, "report what would be classified without calling Places or writing")
	limit := flag.Int("limit", 0, "stop after resolving this many rows (0 = no cap); lets a run be staged across multiple invocations against a tight daily quota")
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

	rows, err := emptySubtypeRows(ctx, repo, listPageSize)
	if err != nil {
		logger.Error("listing rows", "error", err)
		os.Exit(1)
	}
	logger.Info("found rows with empty subtype", "count", len(rows), "sources", backfillSources)

	if *dryRun {
		report(countsByKey(rows), true)
		return
	}

	placesClient, err := places.NewFromEnv()
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	svc := service.New(repo).WithPlaces(placesClient)

	result := runBackfill(ctx, svc, repo, rows, *limit, func() { time.Sleep(backfillPace) })
	report(result.byKey, false)
	logger.Info("backfill complete", "candidates", len(rows), "resolved", result.resolved, "stayed_empty", result.stayedEmpty, "failed", result.failed, "already_set", result.alreadySet)
}

// activityLister is the one repository capability this tool's enumeration
// step needs — narrowed so a test can fake pagination without a real DB,
// same pattern as cmd/backfilltripadvisor's activityLister.
type activityLister interface {
	List(ctx context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error)
}

// emptySubtypeRows pages through every published row (List has no
// Source/Subcategory filter of its own — narrowing further isn't worth
// adding one to the shared admin query contract for this one-off need,
// same reasoning as cmd/backfilltripadvisor's tripadvisorSourcedRows),
// accumulates them all, then applies keepCandidates to select the ones this
// tool actually classifies. Despite the name (kept for the small diff off
// the original T3 tool), it no longer selects only empty-subtype rows — see
// keepCandidates for the current selection rule.
func emptySubtypeRows(ctx context.Context, repo activityLister, pageSize int) ([]activitiessvc.Activity, error) {
	var all []activitiessvc.Activity
	offset := 0
	for {
		result, err := repo.List(ctx, activitiessvc.ListFilter{Status: activitiessvc.StatusPublished, Limit: pageSize, Offset: offset})
		if err != nil {
			return nil, err
		}
		all = append(all, result.Activities...)
		offset += len(result.Activities)
		if len(result.Activities) == 0 || offset >= result.Total {
			break
		}
	}
	return keepCandidates(all), nil
}

// keepCandidates is this tool's selection rule. Two disjoint reasons a row
// qualifies:
//
//   - It has no subtype at all and came from a source whose subtype was never
//     resolved (the original T3 case).
//   - Its name carries a local venue-type keyword (shisha, kafana), whatever
//     its source or current subtype. These rows are the point of the widened
//     pass: Google labels a kafana "lounge" and a shisha bar "nightclub", and
//     the stored value has to be replaced rather than preserved.
//
// The second reason deliberately includes google_places rows, reversing this
// tool's original "google_places rows are never touched" rule — that rule
// existed because an empty google_places subtype is a legitimate Subtype: ""
// discovery row, which says nothing about a *wrong* non-empty one.
func keepCandidates(rows []activitiessvc.Activity) []activitiessvc.Activity {
	var out []activitiessvc.Activity
	for _, a := range rows {
		if _, override := namemap.Subtype(a.Category, a.Title); override {
			out = append(out, a)
			continue
		}
		if a.Subcategory == "" && slices.Contains(backfillSources, a.Source) {
			out = append(out, a)
		}
	}
	return out
}

// subtypeResolver is svc.ResolveTripadvisorSubtype's shape — narrowed so
// runBackfill is testable against a fake, without needing a fake that
// satisfies service.Activities' whole (unexported) repository interface.
// The second return value (tripadvisor-google-review-fallback T1's matched
// Google place id) isn't this tool's concern — cmd/backfillgoogleplaceid
// (T2) is the one that persists it — so runBackfill discards it.
type subtypeResolver interface {
	ResolveTripadvisorSubtype(ctx context.Context, category activitiessvc.Category, name string, lat, lng float64, locationID string) (string, string)
}

// subcategorySetter is the pair of repository writes this tool uses: the
// if-empty guard for Google-resolved subtypes (a live sync may legitimately
// classify the same row mid-run), and the unconditional write for
// local-keyword matches, which exist to replace a wrong stored value.
type subcategorySetter interface {
	SetSubcategoryIfEmpty(ctx context.Context, id, subcategory string) (bool, error)
	SetSubcategory(ctx context.Context, id, subcategory string) error
}

// backfillResult tallies one run: resolved is rows this run classified,
// stayedEmpty is rows the resolver legitimately couldn't classify (never a
// failure — see ResolveTripadvisorSubtype's own doc; a write error is
// counted separately in failed, since "Places couldn't classify this venue"
// and "we classified it but the write broke" mean different follow-ups),
// alreadySet is rows SetSubcategoryIfEmpty's WHERE guard rejected because
// something else classified the row between the list read and this write.
// byKey breaks before/attempted/resolved/failed counts down by
// "source|category" for the report, doubling as engineering-notes.md's
// before/after source.
type backfillResult struct {
	resolved, stayedEmpty, failed, alreadySet int
	byKey                                     map[string]*sourceCategoryCount
}

// sourceCategoryCount is one report row. attempted is rows this run actually
// called the resolver on (before minus attempted = rows a -limit cap left
// for the next invocation); resolved/failed are the two attempted outcomes
// worth telling apart in the report — a genuine no-match ("EMPTY") isn't the
// same finding as a write that broke ("FAILED").
type sourceCategoryCount struct {
	source, category                    string
	before, attempted, resolved, failed int
}

// runBackfill classifies rows in place, one at a time, in the order rows is
// given — sequential, not worker-pool, see package doc for why. pace is
// called once per row (a func, not a raw sleep, so tests run instantly) —
// resolver early-returns without an HTTP call for a row with no name/coords,
// so this is a slight over-pace on those rows, not an under-pace. limit caps
// how many rows get processed this run (0 = every row); the rest are simply
// left for the next invocation, no different from how a mid-run failure
// leaves them.
func runBackfill(ctx context.Context, resolver subtypeResolver, setter subcategorySetter, rows []activitiessvc.Activity, limit int, pace func()) backfillResult {
	result := backfillResult{byKey: countsByKey(rows)}
	for i, a := range rows {
		if limit > 0 && i >= limit {
			break
		}
		key := a.Source + "|" + string(a.Category)
		result.byKey[key].attempted++
		// Local-keyword rows resolve from the stored name alone — no Places
		// call, so no pace() either — and overwrite whatever is stored.
		if slug, override := namemap.Subtype(a.Category, a.Title); override {
			if err := setter.SetSubcategory(ctx, a.ID, slug); err != nil {
				slog.Warn("writing name-derived subtype failed", "id", a.ID, "title", a.Title, "error", err)
				result.failed++
				result.byKey[key].failed++
				continue
			}
			result.resolved++
			result.byKey[key].resolved++
			continue
		}
		subtype, _ := resolver.ResolveTripadvisorSubtype(ctx, a.Category, a.Title, a.Location.Lat, a.Location.Lng, a.ExternalID)
		pace()
		if subtype == "" {
			result.stayedEmpty++
			continue
		}
		wrote, err := setter.SetSubcategoryIfEmpty(ctx, a.ID, subtype)
		if err != nil {
			slog.Warn("writing resolved subtype failed", "id", a.ID, "title", a.Title, "error", err)
			result.failed++
			result.byKey[key].failed++
			continue
		}
		if !wrote {
			result.alreadySet++
			continue
		}
		result.resolved++
		result.byKey[key].resolved++
	}
	return result
}

// countsByKey groups rows by "source|category", seeding each group's
// before count — the pre-run half of the required before/after report.
func countsByKey(rows []activitiessvc.Activity) map[string]*sourceCategoryCount {
	byKey := make(map[string]*sourceCategoryCount)
	for _, a := range rows {
		key := a.Source + "|" + string(a.Category)
		if byKey[key] == nil {
			byKey[key] = &sourceCategoryCount{source: a.Source, category: string(a.Category)}
		}
		byKey[key].before++
	}
	return byKey
}

// report prints the before/after-by-source/category table to stdout, keys
// sorted for a deterministic, diffable-across-runs row order (map iteration
// order is otherwise random). dryRun prints "-" for every attempted-outcome
// column — nothing has been attempted yet, so a real count there would be a
// guess. SKIPPED = before - attempted is rows a -limit cap left for the next
// invocation; EMPTY = attempted - resolved - failed is genuine no-match only
// (a write failure is its own FAILED column, not folded into "empty"). Any
// rare alreadySet row (see backfillResult) isn't broken out by key — a row
// someone else classified mid-run is a true positive for the filters fix
// either way, just not credited to this run's tally.
func report(byKey map[string]*sourceCategoryCount, dryRun bool) {
	fmt.Printf("%-14s %-16s %8s %8s %8s %8s %8s\n", "SOURCE", "CATEGORY", "BEFORE", "RESOLVED", "FAILED", "SKIPPED", "EMPTY")
	keys := make([]string, 0, len(byKey))
	for k := range byKey {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		c := byKey[k]
		resolved, failed, skipped, empty := "-", "-", "-", "-"
		if !dryRun {
			resolved = fmt.Sprintf("%d", c.resolved)
			failed = fmt.Sprintf("%d", c.failed)
			skipped = fmt.Sprintf("%d", c.before-c.attempted)
			empty = fmt.Sprintf("%d", c.attempted-c.resolved-c.failed)
		}
		fmt.Printf("%-14s %-16s %8d %8s %8s %8s %8s\n", c.source, c.category, c.before, resolved, failed, skipped, empty)
	}
}
