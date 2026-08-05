package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"slices"
	"strings"
	"testing"

	"activities-service/internal/tripadvisor"

	"backend/shared/models/activitiessvc"
)

// fakeLister paginates a fixed in-memory activity set, honoring
// filter.Status/Limit/Offset the same way repository.Activities' real List
// does — enough to exercise candidateRows' own pagination/filter loop
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

	got, err := candidateRows(context.Background(), lister, listPageSize)
	if err != nil {
		t.Fatalf("candidateRows: %v", err)
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

	got, err := candidateRows(context.Background(), lister, 2)
	if err != nil {
		t.Fatalf("candidateRows: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("got %d rows, want all 5 across multiple pages", len(got))
	}
}

func TestEmptySubtypeRows_EmptyCatalogReturnsNilNotError(t *testing.T) {
	got, err := candidateRows(context.Background(), &fakeLister{}, listPageSize)
	if err != nil {
		t.Fatalf("candidateRows: %v", err)
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

func (f *fakeResolver) ResolveTripadvisorSubtype(_ context.Context, _ activitiessvc.Category, _ string, _, _ float64, locationID, _ string) (string, string) {
	f.calls = append(f.calls, locationID)
	return f.byID[locationID], ""
}

// fakeSetter records every write attempt and lets a test force a specific
// row to look "already set by something else" (wrote=false) or to error.
// unconditional records SetSubcategory calls (the T6 override path)
// separately from writes (SetSubcategoryIfEmpty) so a test can assert which
// path a given row went through.
type fakeSetter struct {
	writes        map[string]string
	unconditional map[string]string
	rejectIDs     map[string]bool
	errIDs        map[string]bool
}

func (f *fakeSetter) SetSubcategory(_ context.Context, id, subcategory string) error {
	if f.unconditional == nil {
		f.unconditional = map[string]string{}
	}
	f.unconditional[id] = subcategory
	return nil
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
		{ID: "db-1", ExternalID: "ta-1", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
		{ID: "db-2", ExternalID: "ta-2", Source: "firecrawl", Category: activitiessvc.CategoryBars, Title: "Sky Bar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-1": "fine_dining_restaurant", "ta-2": ""}}
	setter := &fakeSetter{}
	var paceCalls int

	result := runBackfill(context.Background(), resolver, setter, nil, rows, 0, func() { paceCalls++ })

	if result.resolved != 1 || result.stayedEmpty != 1 || result.alreadySet != 0 {
		t.Fatalf("got %+v, want resolved=1 stayedEmpty=1 alreadySet=0", result)
	}
	if setter.writes["db-1"] != "fine_dining_restaurant" {
		t.Fatalf("row db-1 not written with resolved subtype: %+v", setter.writes)
	}
	if _, wrote := setter.writes["db-2"]; wrote {
		t.Fatalf("row db-2 (unresolved) must not be written")
	}
	if paceCalls != 2 {
		t.Fatalf("pace called %d times, want once per row (2)", paceCalls)
	}
}

// TestRunBackfill_ResolvesByExternalIDNotDBID pins the fix for the resolver
// call passing the venue's own Tripadvisor location_id (ExternalID), not our
// internal activities UUID (ID) — the two are deliberately different values
// here so a regression back to a.ID fails this test.
func TestRunBackfill_ResolvesByExternalIDNotDBID(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "db-1", ExternalID: "ta-loc-42", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-loc-42": "fine_dining_restaurant"}}
	setter := &fakeSetter{}

	runBackfill(context.Background(), resolver, setter, nil, rows, 0, func() {})

	if len(resolver.calls) != 1 || resolver.calls[0] != "ta-loc-42" {
		t.Fatalf("resolver called with %+v, want [\"ta-loc-42\"] (the venue's ExternalID, not its DB ID)", resolver.calls)
	}
}

func TestRunBackfill_AlreadySetRowNotDoubleCounted(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", ExternalID: "1", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "fine_dining_restaurant"}}
	setter := &fakeSetter{rejectIDs: map[string]bool{"1": true}}

	result := runBackfill(context.Background(), resolver, setter, nil, rows, 0, func() {})

	if result.resolved != 0 || result.alreadySet != 1 {
		t.Fatalf("got %+v, want resolved=0 alreadySet=1", result)
	}
}

func TestRunBackfill_WriteErrorCountsAsFailedNotStayedEmpty(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", ExternalID: "1", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
		{ID: "2", ExternalID: "2", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Little Bay"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "fine_dining_restaurant", "2": "casual_dining"}}
	setter := &fakeSetter{errIDs: map[string]bool{"1": true}}

	result := runBackfill(context.Background(), resolver, setter, nil, rows, 0, func() {})

	// Row 1's write errors — a distinct outcome (failed) from a genuine
	// no-match (stayedEmpty), not a crash; row 2 still gets processed — one
	// bad row must not abort the whole run.
	if result.failed != 1 || result.stayedEmpty != 0 || result.resolved != 1 {
		t.Fatalf("got %+v, want failed=1 stayedEmpty=0 resolved=1", result)
	}
	if result.byKey["tripadvisor|restaurants"].failed != 1 {
		t.Fatalf("byKey failed not tracked: %+v", result.byKey["tripadvisor|restaurants"])
	}
	if setter.writes["2"] != "casual_dining" {
		t.Fatalf("row 2 should still have been written: %+v", setter.writes)
	}
}

func TestRunBackfill_LimitCapsRowsProcessedNotJustWritten(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", ExternalID: "1", Source: "tripadvisor", Title: "A"},
		{ID: "2", ExternalID: "2", Source: "tripadvisor", Title: "B"},
		{ID: "3", ExternalID: "3", Source: "tripadvisor", Title: "C"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "x", "2": "x", "3": "x"}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, nil, rows, 2, func() {})

	if len(resolver.calls) != 2 {
		t.Fatalf("resolver called %d times, want exactly 2 (limit), leaving row 3 for the next run", len(resolver.calls))
	}
	key := result.byKey["tripadvisor|"]
	if key == nil || key.before != 3 || key.attempted != 2 {
		t.Fatalf("tripadvisor| = %+v, want before=3 attempted=2 (row 3 left as a skip, not an empty)", key)
	}
}

func TestRunBackfill_ByKeyTracksBeforeAndResolvedPerSourceCategory(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", ExternalID: "1", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Ambar"},
		{ID: "2", ExternalID: "2", Source: "tripadvisor", Category: activitiessvc.CategoryRestaurants, Title: "Little Bay"},
		{ID: "3", ExternalID: "3", Source: "firecrawl", Category: activitiessvc.CategoryBars, Title: "Sky Bar"},
	}
	resolver := &fakeResolver{byID: map[string]string{"1": "fine_dining_restaurant", "2": "", "3": "cocktail_bar"}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, nil, rows, 0, func() {})

	ta := result.byKey["tripadvisor|restaurants"]
	if ta == nil || ta.before != 2 || ta.attempted != 2 || ta.resolved != 1 {
		t.Fatalf("tripadvisor|restaurants = %+v, want before=2 attempted=2 resolved=1", ta)
	}
	fc := result.byKey["firecrawl|bars"]
	if fc == nil || fc.before != 1 || fc.attempted != 1 || fc.resolved != 1 {
		t.Fatalf("firecrawl|bars = %+v, want before=1 attempted=1 resolved=1", fc)
	}
}

// TestReport_SortsRowsAndSplitsFailedSkippedFromEmpty pins two report fixes:
// row order is sorted (not random map iteration), and FAILED/SKIPPED are
// their own columns rather than folded into EMPTY.
func TestReport_SortsRowsAndSplitsFailedSkippedFromEmpty(t *testing.T) {
	byKey := map[string]*sourceCategoryCount{
		// before=5, attempted=4 (1 left by -limit), resolved=2, failed=1
		// -> skipped=1, empty=1 (attempted - resolved - failed).
		"tripadvisor|restaurants": {source: "tripadvisor", category: "restaurants", before: 5, attempted: 4, resolved: 2, failed: 1},
		"firecrawl|bars":          {source: "firecrawl", category: "bars", before: 2, attempted: 2, resolved: 1},
	}

	out := captureReport(t, byKey, false)
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("got %d lines, want header + 2 rows: %q", len(lines), out)
	}

	// "firecrawl" sorts before "tripadvisor" — proves the fix, since map
	// iteration order would be random and could print either row first.
	firecrawl := strings.Fields(lines[1])
	tripadvisor := strings.Fields(lines[2])
	if firecrawl[0] != "firecrawl" || tripadvisor[0] != "tripadvisor" {
		t.Fatalf("rows not sorted by key, got firecrawl row %q then tripadvisor row %q", lines[1], lines[2])
	}

	// tripadvisor row: SOURCE CATEGORY BEFORE RESOLVED FAILED SKIPPED EMPTY.
	want := []string{"tripadvisor", "restaurants", "5", "2", "1", "1", "1"}
	if len(tripadvisor) != len(want) {
		t.Fatalf("got fields %v, want %v", tripadvisor, want)
	}
	for i, w := range want {
		if tripadvisor[i] != w {
			t.Fatalf("field %d: got %q, want %q (full row %v)", i, tripadvisor[i], w, tripadvisor)
		}
	}
}

func TestReport_DryRunPrintsPlaceholdersForEveryAttemptedOutcome(t *testing.T) {
	byKey := map[string]*sourceCategoryCount{
		"tripadvisor|restaurants": {source: "tripadvisor", category: "restaurants", before: 5},
	}

	out := captureReport(t, byKey, true)
	fields := strings.Fields(strings.TrimSpace(strings.Split(out, "\n")[1]))
	want := []string{"tripadvisor", "restaurants", "5", "-", "-", "-", "-"}
	if len(fields) != len(want) {
		t.Fatalf("got fields %v, want %v", fields, want)
	}
	for i, w := range want {
		if fields[i] != w {
			t.Fatalf("field %d: got %q, want %q (full row %v)", i, fields[i], w, fields)
		}
	}
}

// TestCandidateRows_IncludesLocalKeywordRows proves the widened selection: a
// google_places row that already has a subtype is still a candidate when its
// name carries a local keyword.
func TestCandidateRows_IncludesLocalKeywordRows(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Title: "Jackson Pub", Category: activitiessvc.CategoryBars, Source: "tripadvisor", Subcategory: ""},
		{ID: "2", Title: "Kafana Moskva", Category: activitiessvc.CategoryNightlife, Source: "google_places", Subcategory: "lounge"},
		{ID: "3", Title: "Club Drugstore", Category: activitiessvc.CategoryNightlife, Source: "google_places", Subcategory: "nightclub"},
		{ID: "4", Title: "Some Cafe", Category: activitiessvc.CategoryCafes, Source: "google_places", Subcategory: ""},
	}

	got := candidateIDs(keepCandidates(rows))
	want := []string{"1", "2"}
	if !slices.Equal(got, want) {
		t.Errorf("candidates = %v, want %v", got, want)
	}
}

// TestRunBackfill_LocalKeywordUsesUnconditionalWrite proves the override path
// writes through SetSubcategory and never calls the resolver (no Places
// call), while an ordinary row still goes through the resolver and the
// if-empty write.
func TestRunBackfill_LocalKeywordUsesUnconditionalWrite(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Title: "Kafana Moskva", Category: activitiessvc.CategoryNightlife, Source: "google_places", Subcategory: "lounge"},
		{ID: "2", ExternalID: "ta-2", Title: "Jackson Pub", Category: activitiessvc.CategoryBars, Source: "tripadvisor", Subcategory: ""},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-2": "pub"}}
	setter := &fakeSetter{}

	runBackfill(context.Background(), resolver, setter, nil, rows, 0, func() {})

	if setter.unconditional["1"] != "kafana_live" {
		t.Errorf("row 1 unconditional write = %q, want kafana_live", setter.unconditional["1"])
	}
	if setter.writes["2"] != "pub" {
		t.Errorf("row 2 if-empty write = %q, want pub", setter.writes["2"])
	}
	if len(resolver.calls) != 1 || resolver.calls[0] != "ta-2" {
		t.Errorf("resolver calls = %v, want exactly one call for row 2 (the local-keyword row must not call the resolver)", resolver.calls)
	}
}

// fakePriceLookup fakes tripadvisor.Client's LocationDetails, recording
// every locationID it was asked to price so tests can assert an
// already-resolved row never triggers a lookup.
type fakePriceLookup struct {
	byID    map[string]string
	errIDs  map[string]bool
	lookups []string
}

func (f *fakePriceLookup) LocationDetails(_ context.Context, locationID string) (tripadvisor.LocationDetails, error) {
	f.lookups = append(f.lookups, locationID)
	if f.errIDs[locationID] {
		return tripadvisor.LocationDetails{}, errLookupFailed
	}
	return tripadvisor.LocationDetails{PriceLevel: f.byID[locationID]}, nil
}

// errLookupFailed is its own sentinel, distinct from errWriteFailed: the
// tests that use it exist precisely to prove a Tripadvisor lookup failure is
// not a repository write failure, so it must not share a sentinel with one.
var errLookupFailed = errors.New("price lookup failed")

// TestRunBackfill_PriceOnlyWhenUnresolved proves the lazy fetch: a row the
// resolver already classified must not cost a Tripadvisor request (the
// load-bearing negative — asserting the lookup count, not merely the happy
// path), and a row it could not classify gets one more chance from the
// price tier. Row 1 is deliberately Restaurants + tripadvisor + resolved —
// not Bars — so this exercises the "already resolved, skip the lookup"
// laziness path itself, independent of the category/source gates row 2's
// category alone would already satisfy (see TestRunBackfill_PriceOnlyFor*
// for those gates in isolation).
func TestRunBackfill_PriceOnlyWhenUnresolved(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Title: "Restoran Zlatnik", Category: activitiessvc.CategoryRestaurants, Source: "tripadvisor", ExternalID: "ta-1"},
		{ID: "2", Title: "Restoran Da Giorgio", Category: activitiessvc.CategoryRestaurants, Source: "tripadvisor", ExternalID: "ta-2"},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-1": "fine_dining", "ta-2": ""}}
	prices := &fakePriceLookup{byID: map[string]string{"ta-2": "Mid Range"}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, prices, rows, 0, func() {})

	if setter.writes["1"] != "fine_dining" {
		t.Errorf("row 1 = %q, want fine_dining from the resolver", setter.writes["1"])
	}
	if setter.writes["2"] != "casual_dining" {
		t.Errorf("row 2 = %q, want casual_dining from the price tier", setter.writes["2"])
	}
	if got := prices.lookups; len(got) != 1 || got[0] != "ta-2" {
		t.Errorf("price lookups = %v, want exactly [ta-2] — the resolved row (ta-1) must not cost a request", got)
	}
	if result.resolved != 2 {
		t.Errorf("resolved = %d, want 2", result.resolved)
	}
}

// TestRunBackfill_PriceOnlyForRestaurants proves the category gate: an
// unresolved Bars row must not cost a Terra request at all, since
// service.SubtypeFromPriceLevel discards every non-Restaurants category's
// price outright — spending the call would be pure waste on quota Google
// already fails to resolve for roughly a third of Bars rows.
func TestRunBackfill_PriceOnlyForRestaurants(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Title: "Some Bar", Category: activitiessvc.CategoryBars, Source: "tripadvisor", ExternalID: "ta-1"},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-1": ""}}
	prices := &fakePriceLookup{byID: map[string]string{"ta-1": "Mid Range"}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, prices, rows, 0, func() {})

	if len(prices.lookups) != 0 {
		t.Errorf("price lookups = %v, want none — Bars price is discarded by SubtypeFromPriceLevel", prices.lookups)
	}
	if result.stayedEmpty != 1 || result.resolved != 0 {
		t.Errorf("got %+v, want stayedEmpty=1 resolved=0", result)
	}
}

// TestRunBackfill_PriceOnlyForTripadvisorSource proves the source gate: an
// unresolved firecrawl row must not cost a Terra request, since a legacy
// firecrawl row's ExternalID is not guaranteed to be a Terra location id
// (0029_strip_g_mp_from_source_url.sql) — only "tripadvisor" rows are.
func TestRunBackfill_PriceOnlyForTripadvisorSource(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Title: "Old Restoran", Category: activitiessvc.CategoryRestaurants, Source: "firecrawl", ExternalID: "legacy-1"},
	}
	resolver := &fakeResolver{byID: map[string]string{"legacy-1": ""}}
	prices := &fakePriceLookup{byID: map[string]string{"legacy-1": "Mid Range"}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, prices, rows, 0, func() {})

	if len(prices.lookups) != 0 {
		t.Errorf("price lookups = %v, want none — firecrawl ExternalID is not a Terra location id", prices.lookups)
	}
	if result.stayedEmpty != 1 || result.resolved != 0 {
		t.Errorf("got %+v, want stayedEmpty=1 resolved=0", result)
	}
}

// TestRunBackfill_NilPriceLookupSkipsPriceTier proves TRIPADVISOR_API_KEY
// unset (prices == nil) leaves an unresolved row empty, exactly like before
// T3, rather than panicking on a nil interface call.
func TestRunBackfill_NilPriceLookupSkipsPriceTier(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Title: "Restoran Da Giorgio", Category: activitiessvc.CategoryRestaurants, Source: "tripadvisor", ExternalID: "ta-1"},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-1": ""}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, nil, rows, 0, func() {})

	if result.stayedEmpty != 1 || result.resolved != 0 {
		t.Errorf("got %+v, want stayedEmpty=1 resolved=0", result)
	}
}

// TestRunBackfill_PriceLookupErrorLeavesRowEmpty proves a failed Tripadvisor
// call is logged and simply leaves that row unclassified — the backfill
// must never fail because one venue could not be priced.
func TestRunBackfill_PriceLookupErrorLeavesRowEmpty(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "1", Title: "Restoran Da Giorgio", Category: activitiessvc.CategoryRestaurants, Source: "tripadvisor", ExternalID: "ta-1"},
	}
	resolver := &fakeResolver{byID: map[string]string{"ta-1": ""}}
	prices := &fakePriceLookup{errIDs: map[string]bool{"ta-1": true}}
	setter := &fakeSetter{}

	result := runBackfill(context.Background(), resolver, setter, prices, rows, 0, func() {})

	if result.stayedEmpty != 1 || result.resolved != 0 || result.failed != 0 {
		t.Errorf("got %+v, want stayedEmpty=1 resolved=0 failed=0 (a price-lookup error is not a write failure)", result)
	}
}

func candidateIDs(rows []activitiessvc.Activity) []string {
	out := make([]string, 0, len(rows))
	for _, a := range rows {
		out = append(out, a.ID)
	}
	return out
}

// captureReport runs report against a redirected os.Stdout and returns what
// it printed — report writes straight to stdout (no io.Writer param; not
// worth threading one through for a hand-run CLI's own table) so this is the
// simplest way to assert on its output.
func captureReport(t *testing.T, byKey map[string]*sourceCategoryCount, dryRun bool) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	orig := os.Stdout
	os.Stdout = w
	report(byKey, dryRun)
	if err := w.Close(); err != nil {
		t.Fatalf("closing pipe writer: %v", err)
	}
	os.Stdout = orig

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		t.Fatalf("reading captured output: %v", err)
	}
	return buf.String()
}
