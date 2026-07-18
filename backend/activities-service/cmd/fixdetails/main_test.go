package main

import (
	"encoding/json"
	"testing"

	"activities-service/internal/repository"
	"backend/shared/models/activitiessvc"
)

func TestRowDetails(t *testing.T) {
	// A row with a real Places raw is recomputed.
	scraped := repository.BackfillRow{
		ID:       "1",
		Category: activitiessvc.CategoryRestaurants,
		City:     "Belgrade",
		Raw:      json.RawMessage(`{"id":"abc","priceLevel":"PRICE_LEVEL_MODERATE"}`),
	}
	got, ok := rowDetails(scraped)
	if !ok {
		t.Fatal("scraped row: ok = false, want true")
	}
	var m map[string]any
	if err := json.Unmarshal(got, &m); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if m["price_tier"] != "$$" {
		t.Errorf("price_tier = %v, want $$", m["price_tier"])
	}

	// A seed/hand-authored row (no Places id in raw) is skipped — never wiped.
	for _, raw := range []string{`{}`, `null`, `{"cuisine":"Balkan"}`} {
		if _, ok := rowDetails(repository.BackfillRow{
			ID: "2", Category: activitiessvc.CategoryRestaurants, City: "Belgrade",
			Raw: json.RawMessage(raw),
		}); ok {
			t.Errorf("raw %q: ok = true, want false (must not overwrite non-scraped row)", raw)
		}
	}
}
