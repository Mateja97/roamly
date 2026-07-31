package main

// ponytail: tests call rowYield directly, an unexported identifier — a
// deliberate, project-approved exception (not a lint-dodge), since rowYield
// is the one piece of this command testable without a live API key.

import (
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
