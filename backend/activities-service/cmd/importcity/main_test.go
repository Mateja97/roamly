package main

import (
	"testing"

	"backend/shared/models/activitiessvc"
)

func TestValidateRow(t *testing.T) {
	ok := inputRow{Title: "A", Category: "cafes", Lat: 1, Lng: 2, SourceURL: "http://x/1"}
	if err := validateRow(ok); err != nil {
		t.Fatalf("valid row rejected: %v", err)
	}
	bad := []inputRow{
		{Title: "", Category: "cafes", Lat: 1, Lng: 2, SourceURL: "http://x/1"},  // no title
		{Title: "A", Category: "food_and_drink", Lat: 1, Lng: 2, SourceURL: "u"}, // retired category
		{Title: "A", Category: "cafes", Lat: 0, Lng: 0, SourceURL: "http://x/1"}, // no coords
		{Title: "A", Category: "cafes", Lat: 1, Lng: 2, SourceURL: ""},           // no source_url
	}
	for i, r := range bad {
		if err := validateRow(r); err == nil {
			t.Errorf("bad row %d accepted, want error", i)
		}
	}
}

func TestNeedsPhotosTag(t *testing.T) {
	// <3 photos -> pending + needs-photos tag; >=3 -> pending, no tag.
	if got := statusAndTags(2); got.status != activitiessvc.StatusPending || !contains(got.tags, "needs-photos") {
		t.Fatalf("2 photos: got %+v", got)
	}
	if got := statusAndTags(3); contains(got.tags, "needs-photos") {
		t.Fatalf("3 photos should not be flagged: %+v", got)
	}
}

func contains(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}
