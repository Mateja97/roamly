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

// TestPhoto_RoundTripsProvider proves T2's Provider field round-trips for
// every fixed enum value, and that a legacy row with no "provider" key
// still decodes cleanly (empty/zero Provider, no error) — the field is
// additive only, same precedent as ThumbURL/Caption.
func TestPhoto_RoundTripsProvider(t *testing.T) {
	tests := []struct {
		name     string
		provider Provider
	}{
		{"admin", ProviderAdmin},
		{"google", ProviderGoogle},
		{"tripadvisor", ProviderTripadvisor},
		{"user", ProviderUser},
		{"empty", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			want := Photo{URL: "https://example.com/x.jpg", Provider: tt.provider}

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
		})
	}
}

func TestPhoto_LegacyRowWithNoProviderDecodesCleanly(t *testing.T) {
	raw := `{"url":"https://example.com/x.jpg","author":"Jane Doe","author_link":"https://example.com"}`

	var p Photo
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}
	if p.Provider != "" {
		t.Errorf("Provider = %q, want empty for a legacy row with no provider key", p.Provider)
	}
}
