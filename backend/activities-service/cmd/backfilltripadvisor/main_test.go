package main

import (
	"context"
	"testing"

	"backend/shared/models/activitiessvc"
)

// fakeLister paginates a fixed in-memory activity set, honoring
// filter.City/Limit/Offset the same way repository.Activities' real List
// does — enough to exercise tripadvisorSourcedRows' own pagination loop
// without a real DB.
type fakeLister struct {
	all []activitiessvc.Activity
}

func (f *fakeLister) List(_ context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error) {
	var matching []activitiessvc.Activity
	for _, a := range f.all {
		if filter.City == "" || a.City == filter.City {
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

func TestTripadvisorSourcedRows_FiltersBySourceAndExternalID(t *testing.T) {
	lister := &fakeLister{all: []activitiessvc.Activity{
		{ID: "1", Title: "Mosaic Restaurant", Source: "tripadvisor", ExternalID: "7678207", City: "Belgrade"},
		{ID: "2", Title: "The Old Palace", Source: "google_places", ExternalID: "ChIJabc", City: "Belgrade"},
		{ID: "3", Title: "Admin Special", Source: "", ExternalID: "", City: "Belgrade"},
		// A tripadvisor-sourced row with no ExternalID shouldn't happen in
		// practice, but must still be excluded defensively — nothing to
		// call RefreshTripadvisorLocation with.
		{ID: "4", Title: "Weird Row", Source: "tripadvisor", ExternalID: "", City: "Belgrade"},
	}}

	got, err := tripadvisorSourcedRows(context.Background(), lister, "", listPageSize)
	if err != nil {
		t.Fatalf("tripadvisorSourcedRows: %v", err)
	}
	if len(got) != 1 || got[0].ID != "1" {
		t.Fatalf("got %+v, want only the one real tripadvisor+external_id row", got)
	}
}

func TestTripadvisorSourcedRows_PagesAcrossMultiplePages(t *testing.T) {
	var all []activitiessvc.Activity
	for i := range 5 {
		all = append(all, activitiessvc.Activity{
			ID:         string(rune('a' + i)),
			Source:     "tripadvisor",
			ExternalID: string(rune('a' + i)),
			City:       "Belgrade",
		})
	}
	lister := &fakeLister{all: all}

	// Page size 2 over 5 rows forces 3 pages (2+2+1) without needing a
	// 200-row fixture to exercise the real listPageSize.
	got, err := tripadvisorSourcedRows(context.Background(), lister, "", 2)
	if err != nil {
		t.Fatalf("tripadvisorSourcedRows: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("got %d rows, want all 5 across multiple pages", len(got))
	}
}

func TestTripadvisorSourcedRows_CityFilterNarrowsBeforeClientSideFilter(t *testing.T) {
	lister := &fakeLister{all: []activitiessvc.Activity{
		{ID: "1", Source: "tripadvisor", ExternalID: "1", City: "Belgrade"},
		{ID: "2", Source: "tripadvisor", ExternalID: "2", City: "Rome"},
	}}

	got, err := tripadvisorSourcedRows(context.Background(), lister, "Rome", listPageSize)
	if err != nil {
		t.Fatalf("tripadvisorSourcedRows: %v", err)
	}
	if len(got) != 1 || got[0].ID != "2" {
		t.Fatalf("got %+v, want only the Rome row", got)
	}
}

func TestTripadvisorSourcedRows_EmptyCatalogReturnsNilNotError(t *testing.T) {
	got, err := tripadvisorSourcedRows(context.Background(), &fakeLister{}, "", listPageSize)
	if err != nil {
		t.Fatalf("tripadvisorSourcedRows: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %+v, want empty", got)
	}
}
