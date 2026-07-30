package service

import (
	"encoding/json"
	"testing"
	"time"

	"activities-service/internal/tripadvisor"

	"backend/shared/models/activitiessvc"
)

func TestRankingText(t *testing.T) {
	tests := []struct {
		name     string
		rankings []tripadvisor.Ranking
		want     string
	}{
		{"no rankings returns empty, never invented", nil, ""},
		{"ranking present but display_text empty returns empty", []tripadvisor.Ranking{{Rank: 12, Total: 1780}}, ""},
		{
			"display_text without a date gets the dated suffix appended",
			[]tripadvisor.Ranking{{DisplayText: "#12 of 1,780 Restaurants in Belgrade"}},
			"#12 of 1,780 Restaurants in Belgrade, as rated by Tripadvisor travelers as of " + time.Now().Format("January 2006"),
		},
		{
			"display_text already carrying a date is passed through unchanged",
			[]tripadvisor.Ranking{{DisplayText: "#12 of 1,780 Restaurants in Belgrade as of July 2026"}},
			"#12 of 1,780 Restaurants in Belgrade as of July 2026",
		},
		{
			"only the first ranking entry is used",
			[]tripadvisor.Ranking{{DisplayText: "#12 of 1,780 Restaurants in Belgrade"}, {DisplayText: "#3 of 90 Steakhouses in Belgrade"}},
			"#12 of 1,780 Restaurants in Belgrade, as rated by Tripadvisor travelers as of " + time.Now().Format("January 2006"),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rankingText(tt.rankings); got != tt.want {
				t.Errorf("rankingText(%+v) = %q, want %q", tt.rankings, got, tt.want)
			}
		})
	}
}

func TestCategoryTags(t *testing.T) {
	tests := []struct {
		name       string
		categories []tripadvisor.Category
		want       []string
	}{
		{"no categories returns nil", nil, nil},
		{"multi-level hierarchy returns the leaf segment", []tripadvisor.Category{{Hierarchy: "restaurants > fine_dining"}}, []string{"fine_dining"}},
		{"single-level hierarchy returns it trimmed", []tripadvisor.Category{{Hierarchy: "wine_bar"}}, []string{"wine_bar"}},
		{
			"multiple categories each contribute their leaf",
			[]tripadvisor.Category{{Hierarchy: "restaurants > fine_dining"}, {Hierarchy: "bars > wine_bar"}},
			[]string{"fine_dining", "wine_bar"},
		},
		{"empty hierarchy contributes nothing", []tripadvisor.Category{{Hierarchy: ""}}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := categoryTags(tt.categories)
			if len(got) != len(tt.want) {
				t.Fatalf("categoryTags(%+v) = %v, want %v", tt.categories, got, tt.want)
			}
			for i := range tt.want {
				if got[i] != tt.want[i] {
					t.Errorf("categoryTags(%+v)[%d] = %q, want %q", tt.categories, i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestToAspectRating(t *testing.T) {
	if got := toAspectRating(nil); got != nil {
		t.Errorf("toAspectRating(nil) = %+v, want nil", got)
	}
	got := toAspectRating(&tripadvisor.Aspect{Rating: 4.5, IconURL: "https://ta/food.svg"})
	want := &activitiessvc.TripadvisorAspectRating{Rating: 4.5, IconURL: "https://ta/food.svg"}
	if got == nil || *got != *want {
		t.Errorf("toAspectRating(...) = %+v, want %+v", got, want)
	}
}

// TestTripadvisorIngestActivity_AbsentOptionalFieldsStayAbsent proves the
// "never a fabricated value" contract for every optional Tripadvisor field
// this task added: a LocationDetails with none of them set must produce an
// attribution block with all of them nil/empty, not zero-valued structs.
func TestTripadvisorIngestActivity_AbsentOptionalFieldsStayAbsent(t *testing.T) {
	d := tripadvisor.LocationDetails{LocationID: "1", Name: "Bare Bones", WebURL: "https://ta/1"}

	ingest := tripadvisorIngestActivity(activitiessvc.CategoryRestaurants, d, nil, nil)

	var details activitiessvc.RestaurantDetails
	if err := json.Unmarshal(ingest.Details, &details); err != nil {
		t.Fatalf("unmarshaling details: %v", err)
	}
	if details.Tripadvisor == nil {
		t.Fatal("Tripadvisor attribution = nil, want a populated (but mostly empty) block")
	}
	if details.Tripadvisor.RankingText != "" {
		t.Errorf("RankingText = %q, want empty (no rankings supplied)", details.Tripadvisor.RankingText)
	}
	if details.Tripadvisor.Award != nil {
		t.Errorf("Award = %+v, want nil (no award supplied)", details.Tripadvisor.Award)
	}
	if details.Tripadvisor.PriceLevel != "" {
		t.Errorf("PriceLevel = %q, want empty", details.Tripadvisor.PriceLevel)
	}
	if details.Tripadvisor.Cuisine != "" {
		t.Errorf("Cuisine = %q, want empty (no categories supplied)", details.Tripadvisor.Cuisine)
	}
	if details.Tripadvisor.Subratings != nil {
		t.Errorf("Subratings = %+v, want nil (no subratings supplied)", details.Tripadvisor.Subratings)
	}
	if ingest.Subcategory != "" {
		t.Errorf("Subcategory = %q, want empty (no categories to map)", ingest.Subcategory)
	}
}
