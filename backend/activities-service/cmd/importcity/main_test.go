package main

import "testing"

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
	// <3 photos -> needs-photos tag; >=3 -> no tag.
	if !contains(statusAndTags(2), "needs-photos") {
		t.Fatalf("2 photos: want needs-photos tag, got %v", statusAndTags(2))
	}
	if contains(statusAndTags(3), "needs-photos") {
		t.Fatalf("3 photos should not be flagged: got %v", statusAndTags(3))
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
