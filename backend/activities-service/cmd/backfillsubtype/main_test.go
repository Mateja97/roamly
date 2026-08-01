package main

import (
	"context"
	"errors"
	"testing"

	"backend/shared/models/activitiessvc"
)

// fakeLister paginates a fixed in-memory activity set, honoring
// filter.Status/Limit/Offset the same way repository.Activities' real List
// does — enough to exercise emptySubtypeRows' own pagination/filter loop
// without a real DB, same pattern as cmd/backfilltripadvisor's fakeLister.
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

func TestEmptySubtypeRows_FiltersBySourceStatusAndEmptySubcategory(t *testing.T) {
	lister := &fakeLister{all: []activitiessvc.Activity{
		{ID: "1", Source: "tripadvisor", Subcategory: "", Status: activitiessvc.StatusPublished},
		{ID: "2", Source: "firecrawl", Subcategory: "", Status: activitiessvc.StatusPublished},
		// Already classified — must be excluded.
		{ID: "3", Source: "tripadvisor", Subcategory: "fine_dining_restaurant", Status: activitiessvc.StatusPublished},
		// google_places is never a T3 backfill target, even with an empty subcategory.
		{ID: "4", Source: "google_places", Subcategory: "", Status: activitiessvc.StatusPublished},
		// Not published — the admin surface's draft/pending rows are out of scope.
		{ID: "5", Source: "tripadvisor", Subcategory: "", Status: activitiessvc.StatusDraft},
	}}

	got, err := emptySubtypeRows(context.Background(), lister, listPageSize)
	if err != nil {
		t.Fatalf("emptySubtypeRows: %v", err)
	}
	if len(got) != 2 || got[0].ID != "1" || got[1].ID != "2" {
		t.Fatalf("got %+v, want rows 1 and 2 only", got)
	}
}

func TestEmptySubtypeRows_PagesAcrossMultiplePages(t *testing.T) {
	var all []activitiessvc.Activity
	for i := range 5 {
		all = append(all, activitiessvc.Activity{
			ID:     string(rune('a' + i)),
			Source: "tripadvisor",
			Status: activitiessvc.StatusPublished,
		})
	}
	lister := &fakeLister{all: all}

	got, err := emptySubtypeRows(context.Background(), lister, 2)
	if err != nil {
		t.Fatalf("emptySubtypeRows: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("got %d rows, want all 5 across multiple pages", len(got))
	}
}

func TestEmptySubtypeRows_EmptyCatalogReturnsNilNotError(t *testing.T) {
	got, err := emptySubtypeRows(context.Background(), &fakeLister{}, listPageSize)
	if err != nil {
		t.Fatalf("emptySubtypeRows: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %+v, want empty", got)
	}
}

// fakeResolver returns byID[a.ID] (possibly "") for any resolve call, and
// records every call so tests can assert what runBackfill actually asked it
// to resolve.
type fakeResolver struct {
	byID  map[string]string
	calls []string
}

func (f *fakeResolver) ResolveTripadvisorSubtype(_ context.Context, _ activitiessvc.Category, _ string, _, _ float64, locationID string) string {
	f.calls = append(f.calls, locationID)
	return f.byID[locationID]
}

// fakeSetter records every write attempt and lets a test force a specific
// row to look "already set by something else" (wrote=false) or to error.
type fakeSetter struct {
	writes    map[string]string
	rejectIDs map[string]bool
	errIDs    map[string]bool
}

func (f *fakeSetter) SetSubcategoryIfEmpty(_ context.Context, id, subcategory string) (bool, error) {
	if f.errIDs[id] {
		return false, errWriteFailed
	}
	if f.rejectIDs[id] {
		return false, nil
	}
	if f.writes == nil {
		f.writes = map[string]string{}
	}
	f.writes[id] = subcategory
	return true, nil
}

var errWriteFailed = errors.New("write failed")

func TestRunBackfill_ResolvesAndWritesOnlyMatchedRows(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
		{ID: "2", Source: "firecrawl", Category: activitiessvc.CategoryBars, Title: "Sky Bar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "fine_dining_restaurant", "2": ""}}
	setter := &fakeSetter{}
	var paceCalls int

	result := runBackfill(context.Background(), resolver, setter, rows, 0, func() { paceCalls++ })

	if result.resolved != 1 || result.stayedEmpty != 1 || result.alreadySet != 0 {
		t.Fatalf("got %+v, want resolved=1 stayedEmpty=1 alreadySet=0", result)
	}
	if setter.writes["1"] != "fine_dining_restaurant" {
		t.Fatalf("row 1 not written with resolved subtype: %+v", setter.writes)
	}
	if _, wrote := setter.writes["2"]; wrote {
		t.Fatalf("row 2 (unresolved) must not be written")
	}
	if paceCalls != 2 {
		t.Fatalf("pace called %d times, want once per Places call (2)", paceCalls)
	}
}

func TestRunBackfill_AlreadySetRowNotDoubleCounted(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "fine_dining_restaurant"}}
	setter := &fakeSetter{rejectIDs: map[string]bool{"1": true}}

	result := runBackfill(context.Background(), resolver, setter, rows, 0, func() {})

	if result.resolved != 0 || result.alreadySet != 1 {
		t.Fatalf("got %+v, want resolved=0 alreadySet=1", result)
	}
}

func TestRunBackfill_WriteErrorCountsAsStayedEmptyNotFatal(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
		{ID: "2", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Little Bay"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "fine_dining_restaurant", "2": "casual_dining"}}
	setter := &fakeSetter{errIDs: map[string]bool{"1": true}}

	result := runBackfill(context.Background(), resolver, setter, rows, 0, func() {})

	// Row 1's write errors (counted as stayed-empty, not a crash); row 2
	// still gets processed — one bad row must not abort the whole run.
	if result.stayedEmpty != 1 || result.resolved != 1 {
		t.Fatalf("got %+v, want stayedEmpty=1 resolved=1", result)
	}
	if setter.writes["2"] != "casual_dining" {
		t.Fatalf("row 2 should still have been written: %+v", setter.writes)
	}
}

func TestRunBackfill_LimitCapsRowsProcessedNotJustWritten(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Source: "tripadvisor", Title: "A"},
		{ID: "2", Source: "tripadvisor", Title: "B"},
		{ID: "3", Source: "tripadvisor", Title: "C"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "x", "2": "x", "3": "x"}}
	setter := &fakeSetter{}

	runBackfill(context.Background(), resolver, setter, rows, 2, func() {})

	if len(resolver.calls) != 2 {
		t.Fatalf("resolver called %d times, want exactly 2 (limit), leaving row 3 for the next run", len(resolver.calls))
	}
}

func TestRunBackfill_ByKeyTracksBeforeAndResolvedPerSourceCategory(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
		{ID: "2", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Little Bay"},
		{ID: "3", Source: "firecrawl", Category: activitiessvc.CategoryBars, Title: "Sky Bar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "fine_dining_restaurant", "2": "", "3": "cocktail_bar"}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, rows, 0, func() {})

	ta := result.byKey["tripadvisor|restaurants"]
	if ta == nil || ta.before != 2 || ta.resolved != 1 {
		t.Fatalf("tripadvisor|restaurants = %+v, want before=2 resolved=1", ta)
	}
	fc := result.byKey["firecrawl|bars"]
	if fc == nil || fc.before != 1 || fc.resolved != 1 {
		t.Fatalf("firecrawl|bars = %+v, want before=1 resolved=1", fc)
	}
}
