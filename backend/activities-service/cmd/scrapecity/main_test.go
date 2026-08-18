package main

// ponytail: tests call rowYield directly, an unexported identifier — a
// deliberate, project-approved exception (not a lint-dodge), since rowYield
// is the one piece of this command testable without a live API key.

import (
	"strings"
	"testing"

	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

func TestRowYield_FlagsEmptyRows(t *testing.T) {
	rows := []placesmap.DiscoveryRow{
		{Category: activitiessvc.CategoryNature, Subtype: "beach", Types: []string{"beach"}},
		{Category: activitiessvc.CategoryNature, Subtype: "viewpoint", Types: []string{"observation_deck"}},
	}
	counts := map[string]yield{
		"nature|beach": {found: 12, kept: 9},
		// viewpoint absent entirely: zero results, the case worth catching
	}

	lines := rowYield(rows, counts)
	if len(lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(lines))
	}
	if lines[0].kept != 9 || lines[0].empty {
		t.Errorf("beach line = %+v, want kept=9 empty=false", lines[0])
	}
	if lines[1].kept != 0 || !lines[1].empty {
		t.Errorf("viewpoint line = %+v, want kept=0 empty=true (a zero-yield row is a mapping bug)", lines[1])
	}
}

func TestSumCalls(t *testing.T) {
	got := sumCalls(map[string]int{"Enterprise": 3, "Photos": 2})
	if got != 5 {
		t.Errorf("sumCalls() = %d, want 5", got)
	}
}

// TestBudgetReport_FlagsPartialRuns is T7's "report calls made / input
// coverage as partial" contract — budgetReport is the shared render step
// both scrapecity's count-only loop and its prewarm summary use.
func TestBudgetReport_FlagsPartialRuns(t *testing.T) {
	tests := []struct {
		name       string
		partial    bool
		wantSubstr string
		dontWant   string
	}{
		{"partial run says so", true, "PARTIAL RUN", ""},
		{"complete run does not say partial", false, "covered", "PARTIAL RUN"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := budgetReport(3, 53, map[string]int{"Enterprise": 3}, tt.partial)
			if !strings.Contains(out, tt.wantSubstr) {
				t.Errorf("budgetReport() = %q, want it to contain %q", out, tt.wantSubstr)
			}
			if tt.dontWant != "" && strings.Contains(out, tt.dontWant) {
				t.Errorf("budgetReport() = %q, want it to NOT contain %q", out, tt.dontWant)
			}
			if !strings.Contains(out, "Enterprise") {
				t.Errorf("budgetReport() = %q, want the per-SKU-tier breakdown", out)
			}
		})
	}
}
