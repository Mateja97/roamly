package main

import (
	"encoding/json"
	"testing"
)

// TestInputRow_ParsesPrimaryTypeAndTypes proves inputRow reads T1's
// primary_type/types fields off Stage-A's JSON (T2's prerequisite for
// deriving Subcategory, wired in importRow via placesmap.Subtype — see
// placesmap/subtype_test.go for that lookup's own coverage) rather than
// silently dropping them like before.
func TestInputRow_ParsesPrimaryTypeAndTypes(t *testing.T) {
	raw := []byte(`{"title":"Venue","category":"restaurants","lat":1,"lng":2,"source_url":"http://x/1","primary_type":"fine_dining_restaurant","types":["fine_dining_restaurant","restaurant"]}`)
	var r inputRow
	if err := json.Unmarshal(raw, &r); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if r.PrimaryType != "fine_dining_restaurant" {
		t.Errorf("PrimaryType = %q, want fine_dining_restaurant", r.PrimaryType)
	}
	if len(r.Types) != 2 {
		t.Errorf("Types = %v, want 2 entries", r.Types)
	}
}

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
	// <minPhotos (1) -> needs-photos tag; >=1 -> no tag. A venue with exactly
	// one (provisional) photo is complete, per T1.
	if !contains(statusAndTags(0), "needs-photos") {
		t.Fatalf("0 photos: want needs-photos tag, got %v", statusAndTags(0))
	}
	if contains(statusAndTags(1), "needs-photos") {
		t.Fatalf("1 photo should not be flagged: got %v", statusAndTags(1))
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
