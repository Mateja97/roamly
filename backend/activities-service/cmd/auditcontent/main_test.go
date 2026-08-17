package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"activities-service/internal/service"

	"backend/shared/models/activitiessvc"
)

// fakeLister paginates a fixed set of rows the way repository.List does,
// so publishedRows' paging loop is exercised without a database. lastFilter
// records the filter of the most recent List call so a test can assert what
// was actually passed through (e.g. Category, after finding 6's fix pushed
// the category filter into the repository call).
type fakeLister struct {
	rows       []activitiessvc.Activity
	calls      int
	lastFilter activitiessvc.ListFilter
}

func (f *fakeLister) List(_ context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error) {
	f.calls++
	f.lastFilter = filter
	start := filter.Offset
	if start > len(f.rows) {
		start = len(f.rows)
	}
	end := start + filter.Limit
	if end > len(f.rows) {
		end = len(f.rows)
	}
	return activitiessvc.ListResult{Activities: f.rows[start:end], Total: len(f.rows)}, nil
}

// fakeMerger stands in for service.Activities' live merge: it records which
// rows it was asked to merge, hands back a canned upgrade, and reports
// resolveFails rows as a failed resolve (resolved=false), so both the tally
// and the skip path can be tested without Google.
type fakeMerger struct {
	merged       []string
	upgrades     map[string]activitiessvc.Activity
	resolveFails map[string]bool
}

func (f *fakeMerger) WithLiveDetails(_ context.Context, a activitiessvc.Activity) (activitiessvc.Activity, bool) {
	f.merged = append(f.merged, a.ID)
	if f.resolveFails[a.ID] {
		return activitiessvc.Activity{}, false
	}
	if up, ok := f.upgrades[a.ID]; ok {
		return up, true
	}
	return a, true
}

func row(id, category string, photos int, details string) activitiessvc.Activity {
	a := activitiessvc.Activity{
		ID: id, Title: id, Category: activitiessvc.Category(category),
		ExternalID: "place-" + id, Status: activitiessvc.StatusPublished,
		Details: json.RawMessage(details),
	}
	for i := 0; i < photos; i++ {
		a.Photos = append(a.Photos, activitiessvc.Photo{URL: "https://example.com/" + id + ".jpg"})
	}
	return a
}

func TestPublishedRows_PagesUntilTotalIsReached(t *testing.T) {
	lister := &fakeLister{rows: []activitiessvc.Activity{
		row("a", "sport", 1, `{}`), row("b", "sport", 1, `{}`),
		row("c", "sport", 1, `{}`), row("d", "sport", 1, `{}`), row("e", "sport", 1, `{}`),
	}}

	got, err := publishedRows(context.Background(), lister, 2, "")
	if err != nil {
		t.Fatalf("publishedRows() error: %v", err)
	}
	if len(got) != 5 {
		t.Errorf("got %d rows, want all 5 across pages", len(got))
	}
	if lister.calls < 3 {
		t.Errorf("List called %d times, want at least 3 for a 5-row set at page size 2", lister.calls)
	}
}

// TestPublishedRows_PassesCategoryToTheFilter is finding 6's regression
// guard: the category restriction must run in the repository's SQL filter,
// not a post-fetch Go-side scan (the old onlyCategory, deleted) that pages
// the whole catalog just to keep one category's rows.
func TestPublishedRows_PassesCategoryToTheFilter(t *testing.T) {
	lister := &fakeLister{rows: []activitiessvc.Activity{row("a", "sport", 1, `{}`)}}

	if _, err := publishedRows(context.Background(), lister, 200, activitiessvc.CategorySport); err != nil {
		t.Fatalf("publishedRows() error: %v", err)
	}
	if lister.lastFilter.Category != activitiessvc.CategorySport {
		t.Errorf("filter.Category = %q, want %q passed through to the repository", lister.lastFilter.Category, activitiessvc.CategorySport)
	}
	if lister.lastFilter.Status != activitiessvc.StatusPublished {
		t.Errorf("filter.Status = %q, want published", lister.lastFilter.Status)
	}
}

func TestApplyLimit(t *testing.T) {
	rows := []activitiessvc.Activity{row("a", "sport", 1, `{}`), row("b", "sport", 1, `{}`), row("c", "sport", 1, `{}`)}

	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{"0 means no cap, the whole catalog", 0, 3},
		{"a limit smaller than the row count truncates", 2, 2},
		{"a limit larger than the row count is a no-op", 100, 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := len(applyLimit(rows, tt.limit)); got != tt.want {
				t.Errorf("applyLimit(rows, %d) len = %d, want %d", tt.limit, got, tt.want)
			}
		})
	}
}

func TestRunAudit_TalliesByCategoryReasonAndScore(t *testing.T) {
	rows := []activitiessvc.Activity{
		row("photoless", "culture", 0, `{"good_to_know":["Free"]}`),
		row("bare", "sport", 1, `{}`),
		row("chips", "shopping", 1, `{"venue_type":"Market","website_url":"https://x"}`),
		row("good", "nature", 1, `{"good_to_know":["Dogs ok"]}`),
	}
	merger := &fakeMerger{upgrades: map[string]activitiessvc.Activity{}}

	report := runAudit(context.Background(), merger, rows, service.DefaultMinContentScore, func() {})

	if report.scanned != 4 {
		t.Errorf("scanned = %d, want 4", report.scanned)
	}
	if report.ok != 1 {
		t.Errorf("ok = %d, want 1 (only the nature row)", report.ok)
	}
	if got := report.byReason[service.ReasonNoPhoto]; got != 1 {
		t.Errorf("no_photo count = %d, want 1", got)
	}
	if got := report.byReason[service.ReasonNoContent]; got != 2 {
		t.Errorf("no_content count = %d, want 2 (the bare sport row and the chips-only shopping row)", got)
	}
	if got := report.byCategory["sport"][service.ReasonNoContent]; got != 1 {
		t.Errorf("sport/no_content count = %d, want 1", got)
	}
	if got := report.byScore[0]; got != 1 {
		t.Errorf("score-0 count = %d, want 1 (the bare sport row)", got)
	}
	if got := report.byScore[1]; got != 1 {
		t.Errorf("score-1 count = %d, want 1 (the chips-only row)", got)
	}
	if len(merger.merged) != 4 {
		t.Errorf("merged %d rows, want every row merged before judging", len(merger.merged))
	}
}

// TestRunAudit_JudgesTheMergedRowNotTheStoredOne is the behaviour the whole
// tool rests on: a stored row that looks bare must be judged on what the
// detail page would actually render after the live merge.
func TestRunAudit_JudgesTheMergedRowNotTheStoredOne(t *testing.T) {
	stored := row("upgradeable", "culture", 1, `{}`)
	merged := stored
	merged.Description = "A live editorial summary from Google."

	merger := &fakeMerger{upgrades: map[string]activitiessvc.Activity{"upgradeable": merged}}
	report := runAudit(context.Background(), merger, []activitiessvc.Activity{stored}, service.DefaultMinContentScore, func() {})

	if report.ok != 1 {
		t.Errorf("ok = %d, want 1 — the stored row is bare but the merged row has a description", report.ok)
	}
	if len(report.byReason) != 0 {
		t.Errorf("byReason = %v, want empty", report.byReason)
	}
}

func TestRunAudit_PacesOncePerRow(t *testing.T) {
	rows := []activitiessvc.Activity{row("a", "sport", 1, `{}`), row("b", "sport", 1, `{}`)}
	paces := 0
	runAudit(context.Background(), &fakeMerger{upgrades: map[string]activitiessvc.Activity{}}, rows, service.DefaultMinContentScore, func() { paces++ })

	if paces != 2 {
		t.Errorf("paced %d times, want once per row — every row costs a billed Places call", paces)
	}
}

// TestRunAudit_SkipsRowsWhosePlacesResolveFailed is finding 3's fix: a row
// whose live merge failed (a 429, a timeout — WithLiveDetails' resolved=
// false) must never be tallied no_content. It's excluded from scanned,
// byReason, and byScore entirely and counted only as skipped.
func TestRunAudit_SkipsRowsWhosePlacesResolveFailed(t *testing.T) {
	rows := []activitiessvc.Activity{
		row("quota-tripped", "sport", 1, `{}`),
		row("good", "nature", 1, `{"good_to_know":["Dogs ok"]}`),
	}
	merger := &fakeMerger{
		upgrades:     map[string]activitiessvc.Activity{},
		resolveFails: map[string]bool{"quota-tripped": true},
	}

	report := runAudit(context.Background(), merger, rows, service.DefaultMinContentScore, func() {})

	if report.skipped != 1 {
		t.Errorf("skipped = %d, want 1", report.skipped)
	}
	if report.scanned != 1 {
		t.Errorf("scanned = %d, want 1 — the failed-resolve row must not count as scanned", report.scanned)
	}
	if len(report.byReason) != 0 {
		t.Errorf("byReason = %v, want empty — a resolve failure is not a no_content verdict", report.byReason)
	}
	total := 0
	for _, count := range report.byScore {
		total += count
	}
	if total != 1 {
		t.Errorf("byScore totals %d rows, want 1 — the skipped row must not appear in the score distribution", total)
	}
	if report.ok != 1 {
		t.Errorf("ok = %d, want 1 (the nature row)", report.ok)
	}
}

func TestRender_IncludesSkippedCountAndSamplingCaveat(t *testing.T) {
	report := auditReport{
		scanned: 1, ok: 0, skipped: 3,
		byReason:   map[string]int{service.ReasonNoContent: 1},
		byCategory: map[string]map[string]int{"sport": {service.ReasonNoContent: 1}},
		byScore:    map[int]int{0: 1},
	}

	out := report.render(service.DefaultMinContentScore)

	if !strings.Contains(out, "SKIPPED") || !strings.Contains(out, "3") {
		t.Errorf("render() = %q, want it to report the skipped count", out)
	}
	if !strings.Contains(out, "title order") {
		t.Errorf("render() = %q, want the sampling caveat naming the row order", out)
	}
}

func TestRender_OmitsSkippedLineWhenNothingWasSkipped(t *testing.T) {
	report := auditReport{
		scanned: 1, ok: 1,
		byReason:   map[string]int{},
		byCategory: map[string]map[string]int{},
		byScore:    map[int]int{2: 1},
	}

	if out := report.render(service.DefaultMinContentScore); strings.Contains(out, "SKIPPED") {
		t.Errorf("render() = %q, want no SKIPPED line when skipped is 0", out)
	}
}
