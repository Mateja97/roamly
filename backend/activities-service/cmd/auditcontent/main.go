// Command auditcontent reports how much of the published catalog would fail
// the content-audit publish bar — a photo, plus content scoring at least
// -min-content (see service.Renderability). It is the measurement step of
// docs/plans/content-audit-draft-demotion.md, and its output is what the
// publish bar gets chosen from.
//
// Report-only, by construction: this binary contains no UPDATE and no
// -dry-run flag, because a tool that cannot write is a stronger guarantee
// than a flag that defaults to safe. The photo-fill and demote steps land
// with the enforcement work, and -dry-run arrives with them, gating those
// writes.
//
// Every row costs one billed Place Details call, so -limit defaults to 200
// rather than "everything": a bare run costs a few dollars, and the full
// catalog needs an explicit -limit 0. Modelled on cmd/backfillgoogleplaceid
// otherwise — sequential rather than a worker pool, a fixed pace between
// Places calls, resumable by simply re-running since it holds no state.
//
// Live-reading only, and never wired into activities-service's own startup
// path — run by hand.
//
// Usage: DATABASE_URL=... GOOGLE_MAPS_API_KEY=... go run ./cmd/auditcontent [-limit 200] [-category sport] [-min-content 2]
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strings"
	"time"

	"activities-service/internal/places"
	"activities-service/internal/repository"
	"activities-service/internal/service"

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

// listPageSize is this tool's own List pagination page size — the admin
// catalog query, not a Places call, so it has nothing to do with Places
// quota. Same knob and same value as cmd/backfillgoogleplaceid's.
const listPageSize = 200

// auditPace is the fixed sleep between Places calls, a conservative floor
// under Places' per-project QPS quota. Same value and reasoning as
// cmd/backfillgoogleplaceid's backfillPace.
const auditPace = 200 * time.Millisecond

// defaultLimit caps an unflagged run. Deliberately not 0: at one billed
// Place Details call per row, an accidental full-catalog pass over ~8,000
// published rows is a real bill, while 200 rows is a sample that costs a
// few dollars and still reads clearly per category.
const defaultLimit = 200

// defaultMaxCalls is -max-calls' bounded default (T7, places-api-cost-
// reduction) — a hard ceiling on Place Details calls, independent of
// -limit. -limit only selects which rows the run considers; -max-calls is
// the actual spend guard, so it stays enforced even when an operator passes
// -limit 0 for a full-catalog pass — "one absent-minded -limit 0" no longer
// buys an unbounded bill. Same value as defaultLimit: today the two move
// together (one row costs at most one call), but they are independent
// knobs, checked independently, so a future change to either never silently
// removes the other's ceiling.
const defaultMaxCalls = 200

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	limit := flag.Int("limit", defaultLimit, "stop after this many rows (0 = the whole catalog; every row costs a billed Places call)")
	category := flag.String("category", "", "restrict the audit to one category slug (default: all)")
	minContent := flag.Int("min-content", service.DefaultMinContentScore, "content score a row needs to stay published")
	maxCalls := flag.Int("max-calls", defaultMaxCalls, "hard ceiling on Place Details calls this run may make, enforced independently of -limit; there is no unlimited setting")
	flag.Parse()

	// Fail fast on an unrecognized -category rather than silently filtering
	// to zero rows and printing a report indistinguishable from a genuinely
	// empty catalog.
	if *category != "" && !activitiessvc.Category(*category).Valid() {
		logger.Error("startup failed: unknown -category", "category", *category)
		os.Exit(1)
	}
	if *maxCalls <= 0 {
		logger.Error("startup failed: -max-calls must be positive; there is no unlimited run")
		os.Exit(1)
	}

	ctx := context.Background()
	dsn, err := sharedconfig.Require("DATABASE_URL")
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}

	// Fail fast on the Places client, never degrade to a nil one: without
	// it every row would merge to its bare stored form and the report would
	// claim the catalog has no content, when what actually happened is that
	// nobody asked Google. A missing API key must not read as "Google has
	// nothing on this venue".
	placesClient, err := places.NewFromEnv()
	if err != nil {
		logger.Error("startup failed: this audit is meaningless without a live Places client", "error", err)
		os.Exit(1)
	}

	pool, err := shareddb.Connect(ctx, dsn)
	if err != nil {
		logger.Error("connecting to db", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	repo := repository.New(pool)
	svc := service.New(repo).WithPlaces(placesClient).WithAuditFieldMask()

	rows, err := publishedRows(ctx, repo, listPageSize, activitiessvc.Category(*category))
	if err != nil {
		logger.Error("listing published rows", "error", err)
		os.Exit(1)
	}
	logger.Info("enumerated published rows", "count", len(rows), "category", *category)

	if truncated := applyLimit(rows, *limit); len(truncated) != len(rows) {
		logger.Info("sampling: the report below covers only this many rows, not the whole catalog",
			"limit", *limit, "available", len(rows))
		rows = truncated
	}

	report := runAudit(ctx, svc, rows, *minContent, *maxCalls, func() { time.Sleep(auditPace) })
	fmt.Print(report.render(*minContent))
}

// activityLister is the one repository capability the enumeration step
// needs — narrowed so the test can fake pagination without a real DB, same
// pattern as cmd/backfillgoogleplaceid's activityLister.
type activityLister interface {
	List(ctx context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error)
}

// liveMerger is (*service.Activities).WithLiveDetails' shape, narrowed the
// same way, so runAudit is testable without a Places client. The bool return
// is the resolve outcome (see service.Activities.WithLiveDetails' doc):
// false only when a Places resolve was attempted for the row and failed —
// runAudit skips that row rather than judging it.
type liveMerger interface {
	WithLiveDetails(ctx context.Context, activity activitiessvc.Activity) (merged activitiessvc.Activity, resolved bool)
}

// publishedRows pages through every published row, optionally restricted to
// one category (the filter runs in SQL via ListFilter.Category — "" means
// no restriction). Pending rows are deliberately excluded: `pending` is the
// firecrawl review queue, a human workflow this tool has no business
// judging.
func publishedRows(ctx context.Context, repo activityLister, pageSize int, category activitiessvc.Category) ([]activitiessvc.Activity, error) {
	var out []activitiessvc.Activity
	offset := 0
	for {
		result, err := repo.List(ctx, activitiessvc.ListFilter{
			Status: activitiessvc.StatusPublished, Category: category, Limit: pageSize, Offset: offset,
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
	return out, nil
}

// applyLimit caps rows at limit (0 = no cap, the whole catalog) — the
// -limit flag's truncation, its own function so it's testable without a
// database. rows are already in repository.List's title order, so this
// truncation is "the first N titles", not a random sample (see render's
// header caveat).
func applyLimit(rows []activitiessvc.Activity, limit int) []activitiessvc.Activity {
	if limit > 0 && len(rows) > limit {
		return rows[:limit]
	}
	return rows
}

// auditReport tallies one run. byReason is catalog-wide, byCategory is the
// same counts split per category (the table the publish bar gets read
// from), and byScore is the score distribution across every row scanned —
// including rows that failed on the photo check, so the distribution
// describes the catalog rather than only the rows that reached the content
// check. skipped counts rows whose Places resolve failed or timed out
// (WithLiveDetails' resolved=false) — excluded from scanned, byReason, and
// byScore entirely, so a quota-exhausted run reads as "N rows skipped"
// rather than silently inflating no_content.
type auditReport struct {
	scanned    int
	ok         int
	skipped    int
	byReason   map[string]int
	byCategory map[string]map[string]int
	byScore    map[int]int
	// byPassingSignals counts passing rows by the exact set of signals that
	// carried them over the bar, joined with "+". A score alone cannot
	// answer the question this report exists to answer — "description" and
	// "google_reviews" both score 2, but the first is an About block and
	// the second is a reviews carousel under an empty body. Without this
	// split, a category can look healthy while every one of its pages is
	// still bare.
	byPassingSignals map[string]int
	// scannedByCategory and okByCategory make per-category pass rates
	// computable from the report alone. byCategory counts only failures, so
	// without these a category showing 40 no_content could be a disaster or
	// a rounding error depending on how many of its rows the sample
	// actually reached — and an -limit run in title order reaches wildly
	// different numbers per category.
	scannedByCategory map[string]int
	okByCategory      map[string]int
	// rowsInput is len(rows) as given to runAudit — the input this run was
	// asked to cover, before -max-calls may have cut it short. Distinct from
	// scanned+skipped, which is how much it actually reached.
	rowsInput int
	// callsMade is one per row runAudit attempted a live-details call for
	// (see the callsByTier doc below for why this is a per-row estimate, not
	// an instrumented HTTP count). partial is true when -max-calls stopped
	// the run before rowsInput was fully covered — the report must say so
	// rather than silently reading as a complete pass.
	callsMade   int
	callsByTier map[string]int
	partial     bool
}

// runAudit merges and judges rows in place, one at a time, in the order
// given — sequential, not worker-pool, see the package doc. pace is called
// once per row (a func, not a raw sleep, so tests run instantly). It writes
// nothing.
//
// maxCalls bounds how many rows this run will attempt a live-details call
// for (T7, places-api-cost-reduction): the tool's own architecture already
// makes at most one Place Details call per row (see the package doc's
// "fixed pace between Places calls") — zero for an admin-created row or one
// with no external place id, one otherwise — so counting attempted rows is a
// conservative over-count of actual billed calls, never an under-count,
// which is the safe direction for a spend cap. Reaching maxCalls stops the
// loop before merger.WithLiveDetails is called for the next row — a
// genuinely unattempted row, not a failed or skipped one — and marks the
// report partial.
func runAudit(ctx context.Context, merger liveMerger, rows []activitiessvc.Activity, minScore, maxCalls int, pace func()) auditReport {
	report := auditReport{
		byReason:          map[string]int{},
		byCategory:        map[string]map[string]int{},
		byScore:           map[int]int{},
		byPassingSignals:  map[string]int{},
		scannedByCategory: map[string]int{},
		okByCategory:      map[string]int{},
		callsByTier:       map[string]int{},
		rowsInput:         len(rows),
	}

	for _, stored := range rows {
		if report.callsMade >= maxCalls {
			report.partial = true
			break
		}
		merged, resolved := merger.WithLiveDetails(ctx, stored)
		report.callsMade++
		report.callsByTier[places.PlaceholderSKUTier(places.AuditFieldMask)]++
		pace()
		if !resolved {
			report.skipped++
			continue
		}

		report.scanned++
		category := string(stored.Category)
		report.scannedByCategory[category]++

		verdict := service.Renderability(merged, minScore)
		report.byScore[verdict.Score]++
		if verdict.OK {
			report.ok++
			report.okByCategory[category]++
			report.byPassingSignals[strings.Join(verdict.Signals, "+")]++
			continue
		}

		report.byReason[verdict.Reason]++
		if report.byCategory[category] == nil {
			report.byCategory[category] = map[string]int{}
		}
		report.byCategory[category][verdict.Reason]++
	}
	return report
}

// render formats the report as the plain-text table the publish-bar
// decision gets read from. Written to stdout, while every log line goes to
// stderr, so a run can be piped into a file without the logs mixed in.
func (r auditReport) render(minScore int) string {
	out := fmt.Sprintf("\ncontent audit — %d rows scanned at min-content=%d\n", r.scanned, minScore)
	out += "  rows are read in repository.List's title order (title ASC, id ASC), not a random sample — an -limit run covers the alphabetically-first rows, not a representative cross-section\n"
	if r.skipped > 0 {
		out += fmt.Sprintf("  SKIPPED (Places resolve failed or timed out, excluded from every count below): %d\n", r.skipped)
	}
	out += fmt.Sprintf("  would stay published: %d\n", r.ok)
	out += fmt.Sprintf("  would be drafted:     %d\n\n", r.scanned-r.ok)

	out += fmt.Sprintf("Places calls: %d", r.callsMade)
	if r.partial {
		out += fmt.Sprintf(" (PARTIAL RUN — covered %d of %d input rows, stopped by -max-calls)\n", r.scanned+r.skipped, r.rowsInput)
	} else {
		out += fmt.Sprintf(" (covered %d of %d input rows)\n", r.scanned+r.skipped, r.rowsInput)
	}
	tiers := make([]string, 0, len(r.callsByTier))
	for tier := range r.callsByTier {
		tiers = append(tiers, tier)
	}
	sort.Strings(tiers)
	for _, tier := range tiers {
		out += fmt.Sprintf("  %-22s %d\n", tier, r.callsByTier[tier])
	}
	out += "\n"

	out += "by reason\n"
	for _, reason := range []string{service.ReasonNoPhoto, service.ReasonNoPlaceID, service.ReasonNoContent} {
		out += fmt.Sprintf("  %-14s %d\n", reason, r.byReason[reason])
	}

	out += "\nby category\n"
	out += fmt.Sprintf("  %-16s %8s %7s %6s %10s %13s %12s\n",
		"category", "scanned", "passed", "rate", "no_photo", "no_place_id", "no_content")
	categories := make([]string, 0, len(r.scannedByCategory))
	for category := range r.scannedByCategory {
		categories = append(categories, category)
	}
	sort.Strings(categories)
	for _, category := range categories {
		counts := r.byCategory[category]
		scanned := r.scannedByCategory[category]
		rate := ""
		if scanned > 0 {
			rate = fmt.Sprintf("%d%%", r.okByCategory[category]*100/scanned)
		}
		out += fmt.Sprintf("  %-16s %8d %7d %6s %10d %13d %12d\n", category,
			scanned, r.okByCategory[category], rate,
			counts[service.ReasonNoPhoto], counts[service.ReasonNoPlaceID], counts[service.ReasonNoContent])
	}

	out += "\nscore distribution (a bar of N drafts everything below N)\n"
	scores := make([]int, 0, len(r.byScore))
	for score := range r.byScore {
		scores = append(scores, score)
	}
	sort.Ints(scores)
	for _, score := range scores {
		out += fmt.Sprintf("  score %d: %d\n", score, r.byScore[score])
	}

	out += "\nhow the passing rows cleared the bar\n"
	out += "  (a row passing on google_reviews alone still renders an empty body — a reviews carousel under a bare title, not a full page)\n"
	combos := make([]string, 0, len(r.byPassingSignals))
	for combo := range r.byPassingSignals {
		combos = append(combos, combo)
	}
	sort.Slice(combos, func(i, j int) bool {
		return r.byPassingSignals[combos[i]] > r.byPassingSignals[combos[j]]
	})
	for _, combo := range combos {
		out += fmt.Sprintf("  %-45s %d\n", combo, r.byPassingSignals[combo])
	}
	return out
}
