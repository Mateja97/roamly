package repository

import (
	"strings"
	"testing"

	"backend/shared/models/activitiessvc"
)

func TestBuildQuery(t *testing.T) {
	tests := []struct {
		name       string
		filter     activitiessvc.QueryFilter
		wantErr    bool
		wantSQL    []string // substrings that must appear
		wantArgs   []any
		notWantSQL []string
	}{
		{
			name: "home scope uses ST_DWithin against home location and orders by distance",
			filter: activitiessvc.QueryFilter{
				Scope:         activitiessvc.ScopeHome,
				HomeLocation:  &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				MaxDistanceKM: 50,
			},
			wantSQL:  []string{"ST_DWithin(location", "ORDER BY distance_km ASC"},
			wantArgs: []any{20.4, 44.8, 50.0 * 1000},
		},
		{
			name: "nearby scope uses current location",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 2},
				MaxDistanceKM:   10,
			},
			wantSQL:  []string{"ST_DWithin(location"},
			wantArgs: []any{2.0, 1.0, 10.0 * 1000},
		},
		{
			name: "home scope missing location is an error",
			filter: activitiessvc.QueryFilter{
				Scope: activitiessvc.ScopeHome,
			},
			wantErr: true,
		},
		{
			name: "outside_country scope filters by country and skips distance ordering",
			filter: activitiessvc.QueryFilter{
				Scope:       activitiessvc.ScopeOutsideCountry,
				HomeCountry: "Serbia",
			},
			wantSQL:    []string{"country <>", "ORDER BY rating DESC"},
			wantArgs:   []any{"Serbia"},
			notWantSQL: []string{"ST_DWithin"},
		},
		{
			name: "unknown scope is an error",
			filter: activitiessvc.QueryFilter{
				Scope: activitiessvc.Scope("bogus"),
			},
			wantErr: true,
		},
		{
			name: "category filter narrows with ANY",
			filter: activitiessvc.QueryFilter{
				Scope:       activitiessvc.ScopeOutsideCountry,
				HomeCountry: "Serbia",
				Categories:  []activitiessvc.Category{activitiessvc.CategorySports, activitiessvc.CategoryArtAndDesign},
			},
			wantSQL: []string{"category = ANY"},
		},
		{
			name: "price tier and min rating filters combine with AND",
			filter: activitiessvc.QueryFilter{
				Scope:       activitiessvc.ScopeOutsideCountry,
				HomeCountry: "Serbia",
				PriceTier:   activitiessvc.PriceTierBudget,
				MinRating:   4.5,
			},
			wantSQL:  []string{"price_tier =", "rating >=", " AND "},
			wantArgs: []any{"Serbia", "budget", 4.5},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			query, args, err := buildQuery(tt.filter)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("buildQuery() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("buildQuery() unexpected error: %v", err)
			}
			for _, want := range tt.wantSQL {
				if !strings.Contains(query, want) {
					t.Errorf("query = %q, want substring %q", query, want)
				}
			}
			for _, notWant := range tt.notWantSQL {
				if strings.Contains(query, notWant) {
					t.Errorf("query = %q, must not contain %q", query, notWant)
				}
			}
			if tt.wantArgs != nil {
				if len(args) != len(tt.wantArgs) {
					t.Fatalf("args = %v, want %v", args, tt.wantArgs)
				}
				for i, want := range tt.wantArgs {
					if args[i] != want {
						t.Errorf("args[%d] = %v, want %v", i, args[i], want)
					}
				}
			}
		})
	}
}
