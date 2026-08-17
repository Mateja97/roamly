package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"testing"

	"activities-service/internal/firecrawl"

	"backend/shared/models/activitiessvc"
)

// fakeLister serves a fixed per-category catalog with real pagination
// semantics — Total is the category's full size regardless of the page
// requested, which is what repository.List does and what publishedRows'
// loop termination depends on.
type fakeLister struct {
	byCategory map[activitiessvc.Category][]activitiessvc.Activity
	pageLimits []int // every Limit publishedRows asked for, in order
}

func (f *fakeLister) List(_ context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error) {
	f.pageLimits = append(f.pageLimits, filter.Limit)

	all := f.byCategory[filter.Category]
	start := min(filter.Offset, len(all))
	end := min(start+filter.Limit, len(all))
	return activitiessvc.ListResult{Activities: all[start:end], Total: len(all)}, nil
}

func catalog(counts map[activitiessvc.Category]int) map[activitiessvc.Category][]activitiessvc.Activity {
	out := map[activitiessvc.Category][]activitiessvc.Activity{}
	for category, n := range counts {
		rows := make([]activitiessvc.Activity, n)
		for i := range rows {
			rows[i] = activitiessvc.Activity{
				ID:       fmt.Sprintf("%s-%d", category, i),
				Category: category,
				Status:   activitiessvc.StatusPublished,
			}
		}
		out[category] = rows
	}
	return out
}

func countByCategory(rows []activitiessvc.Activity) map[activitiessvc.Category]int {
	out := map[activitiessvc.Category]int{}
	for _, r := range rows {
		out[r.Category]++
	}
	return out
}

func TestPublishedRows_PerCategoryLimit(t *testing.T) {
	categories := []activitiessvc.Category{
		activitiessvc.CategorySport,
		activitiessvc.CategoryShopping,
		activitiessvc.CategoryArt,
	}

	tests := []struct {
		name             string
		counts           map[activitiessvc.Category]int
		perCategoryLimit int
		pageSize         int
		want             map[activitiessvc.Category]int
	}{
		{
			name:             "the limit applies to each category independently, not to the total",
			counts:           map[activitiessvc.Category]int{activitiessvc.CategorySport: 100, activitiessvc.CategoryShopping: 100, activitiessvc.CategoryArt: 100},
			perCategoryLimit: 25,
			pageSize:         200,
			want:             map[activitiessvc.Category]int{activitiessvc.CategorySport: 25, activitiessvc.CategoryShopping: 25, activitiessvc.CategoryArt: 25},
		},
		{
			name:             "a category smaller than the limit contributes everything it has",
			counts:           map[activitiessvc.Category]int{activitiessvc.CategorySport: 100, activitiessvc.CategoryShopping: 3, activitiessvc.CategoryArt: 0},
			perCategoryLimit: 25,
			pageSize:         200,
			want:             map[activitiessvc.Category]int{activitiessvc.CategorySport: 25, activitiessvc.CategoryShopping: 3},
		},
		{
			name:             "zero means no cap",
			counts:           map[activitiessvc.Category]int{activitiessvc.CategorySport: 30, activitiessvc.CategoryShopping: 5, activitiessvc.CategoryArt: 1},
			perCategoryLimit: 0,
			pageSize:         200,
			want:             map[activitiessvc.Category]int{activitiessvc.CategorySport: 30, activitiessvc.CategoryShopping: 5, activitiessvc.CategoryArt: 1},
		},
		{
			name:             "the limit still holds when it spans several pages",
			counts:           map[activitiessvc.Category]int{activitiessvc.CategorySport: 100},
			perCategoryLimit: 25,
			pageSize:         10,
			want:             map[activitiessvc.Category]int{activitiessvc.CategorySport: 25},
		},
		{
			name:             "a limit above the catalog size is not an error",
			counts:           map[activitiessvc.Category]int{activitiessvc.CategorySport: 4},
			perCategoryLimit: 1000,
			pageSize:         200,
			want:             map[activitiessvc.Category]int{activitiessvc.CategorySport: 4},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lister := &fakeLister{byCategory: catalog(tt.counts)}

			rows, err := publishedRows(context.Background(), lister, categories, tt.pageSize, tt.perCategoryLimit)
			if err != nil {
				t.Fatalf("publishedRows() error: %v", err)
			}

			got := countByCategory(rows)
			for category, wantN := range tt.want {
				if got[category] != wantN {
					t.Errorf("category %s: got %d rows, want %d", category, got[category], wantN)
				}
			}
			for category, gotN := range got {
				if tt.want[category] == 0 && gotN != 0 {
					t.Errorf("category %s: got %d rows, want none", category, gotN)
				}
			}
		})
	}
}

// TestPublishedRows_LimitNarrowsThePageRequest is the cost half of the
// feature: a pilot must not enumerate 1,443 shopping rows to keep 25. The
// requested page Limit itself shrinks to what's still needed.
func TestPublishedRows_LimitNarrowsThePageRequest(t *testing.T) {
	lister := &fakeLister{byCategory: catalog(map[activitiessvc.Category]int{activitiessvc.CategoryShopping: 1443})}

	rows, err := publishedRows(context.Background(), lister,
		[]activitiessvc.Category{activitiessvc.CategoryShopping}, 200, 25)
	if err != nil {
		t.Fatalf("publishedRows() error: %v", err)
	}

	if len(rows) != 25 {
		t.Fatalf("got %d rows, want 25", len(rows))
	}
	if len(lister.pageLimits) != 1 {
		t.Fatalf("List called %d times, want 1 — 25 rows fit in one narrowed page", len(lister.pageLimits))
	}
	if lister.pageLimits[0] != 25 {
		t.Errorf("requested page Limit = %d, want 25 — the cap must narrow the query, not just truncate the result",
			lister.pageLimits[0])
	}
}

// TestSyncCategories_MatchTheServiceConfig would be the ideal guard, but
// extractionConfig lives in internal/service and is unexported. This is the
// next best thing: the enumeration list is the one place a category can be
// silently dropped from the job while its prompt and schema sit there
// unused, which is exactly what happened to Shopping and Nightlife when
// they were added to the service maps alone. Nightlife is deliberately not
// here — see the removal note on syncCategories.
func TestSyncCategories_IncludesEveryEnrichedCategory(t *testing.T) {
	want := []activitiessvc.Category{
		activitiessvc.CategoryWellness,
		activitiessvc.CategoryEntertainment,
		activitiessvc.CategoryCulture,
		activitiessvc.CategoryArt,
		activitiessvc.CategorySport,
		activitiessvc.CategoryShopping,
	}

	have := map[activitiessvc.Category]bool{}
	for _, c := range syncCategories {
		have[c] = true
	}
	for _, c := range want {
		if !have[c] {
			t.Errorf("syncCategories is missing %q — its rows are never enumerated, so its prompt and schema never run", c)
		}
	}
	if len(syncCategories) != len(want) {
		t.Errorf("syncCategories has %d entries, want %d — a category added here also needs extractionConfig and scraperOwnedFields entries in internal/service/websitesync.go",
			len(syncCategories), len(want))
	}
}

// fakeSyncer stands in for (*service.Activities).SyncWebsiteContent: errs
// maps a row ID to the error it should fail with — so runSync's abort
// behavior is testable without a real Places/Firecrawl client.
type fakeSyncer struct {
	errs      map[string]error
	calledIDs []string
}

func (f *fakeSyncer) SyncWebsiteContent(_ context.Context, id string, _ bool) error {
	f.calledIDs = append(f.calledIDs, id)
	return f.errs[id]
}

var discardLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

// TestRunSync_AbortsOnInsufficientCredits is finding 1's second half: the
// run loop must not grind through the remaining catalog once the account is
// out of credit — every remaining row would otherwise still cost a billed
// Places call to reach a Firecrawl call that cannot succeed either.
func TestRunSync_AbortsOnInsufficientCredits(t *testing.T) {
	rows := []activitiessvc.Activity{
		{ID: "a", Title: "A"}, {ID: "b", Title: "B"}, {ID: "c", Title: "C"}, {ID: "d", Title: "D"},
	}
	syncer := &fakeSyncer{errs: map[string]error{
		"b": fmt.Errorf("extracting website content for b: %w", firecrawl.ErrInsufficientCredits),
	}}

	synced, skippedOrFailed, aborted := runSync(context.Background(), syncer, rows, discardLogger)

	if !aborted {
		t.Fatal("aborted = false, want true — a credit-exhausted row must stop the run")
	}
	if got := []string{"a", "b"}; !slices.Equal(syncer.calledIDs, got) {
		t.Errorf("calledIDs = %v, want %v — rows c and d must never be attempted once credit is exhausted", syncer.calledIDs, got)
	}
	if synced != 1 {
		t.Errorf("synced = %d, want 1 (row a, before the abort)", synced)
	}
	if skippedOrFailed != 0 {
		t.Errorf("skippedOrFailed = %d, want 0 — the aborting row is not a per-row failure to tally, it stopped the whole run", skippedOrFailed)
	}
}

// TestRunSync_OrdinaryFailuresContinue proves a normal (non-credit) failure
// is still just a per-row skip, not an abort — only the credit sentinel
// stops the run.
func TestRunSync_OrdinaryFailuresContinue(t *testing.T) {
	rows := []activitiessvc.Activity{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	syncer := &fakeSyncer{errs: map[string]error{"b": fmt.Errorf("boom")}}

	synced, skippedOrFailed, aborted := runSync(context.Background(), syncer, rows, discardLogger)

	if aborted {
		t.Error("aborted = true, want false — an ordinary failure must not stop the run")
	}
	if synced != 2 {
		t.Errorf("synced = %d, want 2 (a and c)", synced)
	}
	if skippedOrFailed != 1 {
		t.Errorf("skippedOrFailed = %d, want 1 (b)", skippedOrFailed)
	}
	if len(syncer.calledIDs) != 3 {
		t.Errorf("calledIDs = %v, want all 3 rows attempted", syncer.calledIDs)
	}
}
