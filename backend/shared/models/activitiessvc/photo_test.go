package activitiessvc

import (
	"encoding/json"
	"testing"
)

// TestPhoto_ExistingGoogleSourcedRowStillDecodes proves the T1 schema change
// (ThumbURL/Caption) is additive only: a photos[] row written before those
// fields existed (Google-sourced, no migration ran against the JSONB
// column) still decodes cleanly, with both new fields at their zero value.
func TestPhoto_ExistingGoogleSourcedRowStillDecodes(t *testing.T) {
	raw := `{"url":"https://example.com/x.jpg","author":"Jane Doe","author_link":"https://example.com"}`

	var p Photo
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}
	if p.URL != "https://example.com/x.jpg" || p.Author != "Jane Doe" || p.AuthorLink != "https://example.com" {
		t.Errorf("Photo = %+v, want the three pre-T1 fields preserved", p)
	}
	if p.ThumbURL != "" || p.Caption != "" {
		t.Errorf("Photo = %+v, want ThumbURL/Caption zero-valued for a pre-T1 row", p)
	}
}

func TestPhoto_RoundTripsThumbURLAndCaption(t *testing.T) {
	want := Photo{URL: "https://example.com/x.jpg", Author: "Jane Doe", AuthorLink: "https://example.com/jane",
		ThumbURL: "/photos/1/abc_t.jpg", Caption: "Sunset over the river"}

	data, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("Marshal() error: %v", err)
	}
	var got Photo
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}
	if got != want {
		t.Errorf("round trip = %+v, want %+v", got, want)
	}
}
