package main

import (
	"context"
	"encoding/json"
	"testing"

	"activities-service/internal/service"

	"backend/shared/models/activitiessvc"
)

// fakeLister paginates a fixed set of rows the way repository.List does,
// so publishedRows' paging loop is exercised without a database.
type fakeLister struct {
	rows  []activitiessvc.Activity
	calls int
}

func (f *fakeLister) List(_ context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error) {
	f.calls++
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
// rows it was asked to merge and hands back a canned upgrade, so the tally
// can be tested without Google.
type fakeMerger struct {
	merged   []string
	upgrades map[string]activitiessvc.Activity
}

func (f *fakeMerger) WithLiveDetails(_ context.Context, a activitiessvc.Activity) activitiessvc.Activity {
	f.merged = append(f.merged, a.ID)
	if up, ok := f.upgrades[a.ID]; ok {
		return up
	}
	return a
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

	got, err := publishedRows(context.Background(), lister, 2)
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
