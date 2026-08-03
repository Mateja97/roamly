package main

import (
	"context"
	"errors"
	"testing"

	"backend/shared/models/activitiessvc"
)

// fakeLister paginates a fixed in-memory activity set, honoring
// filter.Status/Limit/Offset the same way repository.Activities' real List
// does — enough to exercise emptyGooglePlaceIDRows' own pagination/filter
// loop without a real DB, same pattern as cmd/backfillsubtype's fakeLister.
type fakeLister struct {
	all []activitiessvc.Activity
}

func (f *fakeLister) List(_ context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error) {
	var matching []activitiessvc.Activity
	for _, a := range f.all {
		if filter.Status == "" || a.Status == filter.Status {
			matching = append(matching, a)
		}
	}
	total := len(matching)
	start := filter.Offset
	if start > total {
		start = total
	}
	end := start + filter.Limit
	if end > total {
		end = total
	}
	return activitiessvc.ListResult{Activities: matching[start:end], Total: total}, nil
}

func TestEmptyGooglePlaceIDRows_FiltersBySourceStatusAndEmptyPlaceID(t *testing.T) {
	lister := &fakeLister{all: []activitiessvc.Activity{
		{ID: "1", Source: "tripadvisor", GooglePlaceID: "", Status: activitiessvc.StatusPublished},
		// Already resolved — must be excluded.
		{ID: "2", Source: "tripadvisor", GooglePlaceID: "places/abc", Status: activitiessvc.StatusPublished},
		// Not a tripadvisor row, even with an empty place id — never this tool's target.
		{ID: "3", Source: "google_places", GooglePlaceID: "", Status: activitiessvc.StatusPublished},
		// Not published — the admin surface's draft/pending rows are out of scope.
		{ID: "4", Source: "tripadvisor", GooglePlaceID: "", Status: activitiessvc.StatusDraft},
	}}

	got, err := emptyGooglePlaceIDRows(context.Background(), lister, listPageSize)
	if err != nil {
		t.Fatalf("emptyGooglePlaceIDRows: %v", err)
	}
	if len(got) != 1 || got[0].ID != "1" {
		t.Fatalf("got %+v, want row 1 only", got)
	}
}

func TestEmptyGooglePlaceIDRows_PagesAcrossMultiplePages(t *testing.T) {
	var all []activitiessvc.Activity
	for i := range 5 {
		all = append(all, activitiessvc.Activity{
			ID:     string(rune('a' + i)),
			Source: "tripadvisor",
			Status: activitiessvc.StatusPublished,
		})
	}
	lister := &fakeLister{all: all}

	got, err := emptyGooglePlaceIDRows(context.Background(), lister, 2)
	if err != nil {
		t.Fatalf("emptyGooglePlaceIDRows: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("got %d rows, want all 5 across multiple pages", len(got))
	}
}

func TestEmptyGooglePlaceIDRows_EmptyCatalogReturnsNilNotError(t *testing.T) {
	got, err := emptyGooglePlaceIDRows(context.Background(), &fakeLister{}, listPageSize)
	if err != nil {
		t.Fatalf("emptyGooglePlaceIDRows: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %+v, want empty", got)
	}
}

// fakeResolver returns byID[locationID] (possibly "") as the place id for
// any resolve call, and records every call so tests can assert what
// runBackfill actually asked it to resolve. The subtype return is always
// "" — this tool never looks at it.
type fakeResolver struct {
	byID  map[string]string
	calls []string
}

func (f *fakeResolver) ResolveTripadvisorSubtype(_ context.Context, _ activitiessvc.Category, _ string, _, _ float64, locationID string) (string, string) {
	f.calls = append(f.calls, locationID)
	return "", f.byID[locationID]
}

// fakeSetter records every write attempt and lets a test force a specific
// row to look "already set by something else" (wrote=false) or to error.
type fakeSetter struct {
	writes    map[string]string
	rejectIDs map[string]bool
	errIDs    map[string]bool
}

func (f *fakeSetter) SetGooglePlaceIDIfEmpty(_ context.Context, id, placeID string) (bool, error) {
	if f.errIDs[id] {
		return false, errWriteFailed
	}
	if f.rejectIDs[id] {
		return false, nil
	}
	if f.writes == nil {
		f.writes = map[string]string{}
	}
	f.writes[id] = placeID
	return true, nil
}

var errWriteFailed = errors.New("write failed")

func TestRunBackfill_ResolvesAndWritesOnlyMatchedRows(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "db-1", ExternalID: "ta-1", Source: "tripadvisor", Title: "Ambar"},
		{ID: "db-2", ExternalID: "ta-2", Source: "tripadvisor", Title: "Sky Bar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-1": "places/ambar", "ta-2": ""}}
	setter := &fakeSetter{}
	var paceCalls int

	result := runBackfill(context.Background(), resolver, setter, rows, 0, func() { paceCalls++ })

	if result.resolved != 1 || result.written != 1 || result.alreadySet != 0 || result.failed != 0 {
		t.Fatalf("got %+v, want resolved=1 written=1 alreadySet=0 failed=0", result)
	}
	if setter.writes["db-1"] != "places/ambar" {
		t.Fatalf("row db-1 not written with resolved place id: %+v", setter.writes)
	}
	if _, wrote := setter.writes["db-2"]; wrote {
		t.Fatalf("row db-2 (unresolved) must not be written")
	}
	if paceCalls != 2 {
		t.Fatalf("pace called %d times, want once per row (2)", paceCalls)
	}
}

// TestRunBackfill_ResolvesByExternalIDNotDBID pins the resolver call passing
// the venue's own Tripadvisor location_id (ExternalID), not our internal
// activities UUID (ID) — the two are deliberately different values here so
// a regression back to a.ID fails this test.
func TestRunBackfill_ResolvesByExternalIDNotDBID(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "db-1", ExternalID: "ta-loc-42", Source: "tripadvisor", Title: "Ambar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-loc-42": "places/ambar"}}
	setter := &fakeSetter{}

	runBackfill(context.Background(), resolver, setter, rows, 0, func() {})

	if len(resolver.calls) != 1 || resolver.calls[0] != "ta-loc-42" {
		t.Fatalf("resolver called with %+v, want [\"ta-loc-42\"] (the venue's ExternalID, not its DB ID)", resolver.calls)
	}
}

func TestRunBackfill_AlreadySetRowNotDoubleCounted(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", ExternalID: "1", Source: "tripadvisor", Title: "Ambar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "places/ambar"}}
	setter := &fakeSetter{rejectIDs: map[string]bool{"1": true}}

	result := runBackfill(context.Background(), resolver, setter, rows, 0, func() {})

	if result.resolved != 1 || result.written != 0 || result.alreadySet != 1 {
		t.Fatalf("got %+v, want resolved=1 written=0 alreadySet=1", result)
	}
}

func TestRunBackfill_ResolveMissSkippedNeverWrittenWithGuess(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", ExternalID: "1", Source: "tripadvisor", Title: "No Match"},
	}
	resolver := &fakeResolver{byID: map[string]string{}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, rows, 0, func() {})

	if result.missed != 1 || result.resolved != 0 || result.written != 0 || result.failed != 0 || result.alreadySet != 0 {
		t.Fatalf("got %+v, want missed=1 and every other count 0 (resolve miss is skipped and counted, never resolved or written)", result)
	}
	if len(setter.writes) != 0 {
		t.Fatalf("setter.writes = %+v, want no write attempted for a resolve miss", setter.writes)
	}
}

func TestRunBackfill_WriteErrorCountsAsFailed(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", ExternalID: "1", Source: "tripadvisor", Title: "Ambar"},
		{ID: "2", ExternalID: "2", Source: "tripadvisor", Title: "Little Bay"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "places/ambar", "2": "places/little-bay"}}
	setter := &fakeSetter{errIDs: map[string]bool{"1": true}}

	result := runBackfill(context.Background(), resolver, setter, rows, 0, func() {})

	// Row 1's write errors — a distinct outcome (failed) from a genuine
	// resolve miss, not a crash; row 2 still gets processed — one bad row
	// must not abort the whole run.
	if result.failed != 1 || result.written != 1 || result.resolved != 2 {
		t.Fatalf("got %+v, want failed=1 written=1 resolved=2", result)
	}
	if setter.writes["2"] != "places/little-bay" {
		t.Fatalf("row 2 should still have been written: %+v", setter.writes)
	}
}

func TestRunBackfill_LimitCapsRowsProcessedNotJustWritten(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", ExternalID: "1", Source: "tripadvisor", Title: "A"},
		{ID: "2", ExternalID: "2", Source: "tripadvisor", Title: "B"},
		{ID: "3", ExternalID: "3", Source: "tripadvisor", Title: "C"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "places/a", "2": "places/b", "3": "places/c"}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, rows, 2, func() {})

	if result.processed != 2 {
		t.Fatalf("result.processed = %d, want 2 (bounded by limit, not scanned's 3)", result.processed)
	}
	if len(resolver.calls) != 2 {
		t.Fatalf("resolver called %d times, want exactly 2 (limit), leaving row 3 for the next run", len(resolver.calls))
	}
	if len(setter.writes) != 2 {
		t.Fatalf("setter.writes = %+v, want exactly 2 writes (row 3 left for the next run)", setter.writes)
	}
}
