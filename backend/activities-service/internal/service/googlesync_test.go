// These tests call googleDueRows directly even though it's unexported —
// a deliberate, project-sanctioned exception (see GO_STANDARDS.md) so the
// row-selection and priority logic can be verified without a database or a
// live Google client standing behind Query.
package service

import (
	"testing"

	"backend/shared/models/activitiessvc"
)

func allStale(_, _, _ string) bool { return false }

func TestGoogleDueRows_CapsAtBudget(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
	}
	jobs := googleDueRows(req, allStale)
	if len(jobs) != maxGoogleRowsPerQuery {
		t.Errorf("jobs = %d, want the budget cap %d", len(jobs), maxGoogleRowsPerQuery)
	}
}

func TestGoogleDueRows_PrioritizesRequestedCategory(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryWellness},
	}
	jobs := googleDueRows(req, allStale)
	if len(jobs) == 0 {
		t.Fatal("jobs = 0, want the wellness rows")
	}
	// Wellness has fewer rows (4 subtypes + 1 category-level) than the
	// budget, so other categories legitimately fill the remainder. What must
	// hold is ordering: every wellness row comes before any non-wellness one,
	// so a user filtering on Wellness gets wellness venues on their next
	// search rather than their seventh.
	seenOther := false
	for _, j := range jobs {
		if j.row.Category != activitiessvc.CategoryWellness {
			seenOther = true
			continue
		}
		if seenOther {
			t.Errorf("wellness row %q scheduled after a non-requested category; requested categories must come first", j.row.Subtype)
		}
	}
}

func TestGoogleDueRows_PrioritizesRequestedSubtype(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryNature},
		Subcategories:   []string{"beach"},
	}
	jobs := googleDueRows(req, allStale)
	if len(jobs) == 0 {
		t.Fatal("jobs = 0, want the beach row")
	}
	if jobs[0].row.Subtype != "beach" {
		t.Errorf("first job subtype = %q, want beach — a user filtering on a subtype should get that subtype synced first", jobs[0].row.Subtype)
	}
}

func TestGoogleDueRows_SkipsFreshRows(t *testing.T) {
	req := Request{
		Scope:           activitiessvc.ScopeNearby,
		CurrentLocation: &activitiessvc.Point{Lat: 44.81, Lng: 20.46},
		Categories:      []activitiessvc.Category{activitiessvc.CategoryNature},
	}
	fresh := func(_, category, subtype string) bool {
		return category == string(activitiessvc.CategoryNature) && subtype == "beach"
	}
	for _, j := range googleDueRows(req, fresh) {
		if j.row.Subtype == "beach" {
			t.Error("a fresh row was scheduled; freshness must be checked per (cell, category, subtype)")
		}
	}
}

func TestGoogleDueRows_NoAnchorNoWork(t *testing.T) {
	req := Request{Scope: activitiessvc.ScopeAnywhere}
	if jobs := googleDueRows(req, allStale); len(jobs) != 0 {
		t.Errorf("jobs = %d, want 0 — an unanchored query has nowhere to sync", len(jobs))
	}
}
