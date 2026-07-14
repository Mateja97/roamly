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
			name: "nearby scope uses ST_DWithin against current location and orders by distance",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 2},
				MaxDistanceKM:   10,
			},
			wantSQL:  []string{"ST_DWithin(location", "ORDER BY distance_km ASC"},
			wantArgs: []any{2.0, 1.0, 10.0 * 1000},
		},
		{
			name: "nearby scope missing location is an error",
			filter: activitiessvc.QueryFilter{
				Scope: activitiessvc.ScopeNearby,
			},
			wantErr: true,
		},
		{
			name: "anywhere scope with location and max_distance_km narrows with ST_DWithin",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeAnywhere,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				MaxDistanceKM:   200,
			},
			wantSQL:  []string{"ST_DWithin(location", "ORDER BY distance_km ASC"},
			wantArgs: []any{20.4, 44.8, 200.0 * 1000},
		},
		{
			name: "anywhere scope with location but no max_distance_km has no distance cap",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeAnywhere,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
			},
			wantSQL:    []string{"ORDER BY distance_km ASC"},
			notWantSQL: []string{"ST_DWithin"},
			wantArgs:   []any{20.4, 44.8},
		},
		{
			name:       "anywhere scope with no location and no filters falls back to TRUE and title order",
			filter:     activitiessvc.QueryFilter{Scope: activitiessvc.ScopeAnywhere},
			wantSQL:    []string{"WHERE TRUE", "ORDER BY title ASC"},
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
				Scope:      activitiessvc.ScopeAnywhere,
				Categories: []activitiessvc.Category{activitiessvc.CategorySports, activitiessvc.CategoryArtAndDesign},
			},
			wantSQL: []string{"category = ANY"},
		},
		{
			name: "min rating filter combines with AND alongside another filter",
			filter: activitiessvc.QueryFilter{
				Scope:      activitiessvc.ScopeAnywhere,
				Categories: []activitiessvc.Category{activitiessvc.CategorySports},
				MinRating:  4.5,
			},
			wantSQL: []string{"category = ANY", "rating >=", " AND "},
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
