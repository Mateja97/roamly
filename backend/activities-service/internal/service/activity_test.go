package service

import (
	"context"
	"errors"
	"testing"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
)

type fakeRepo struct {
	got activitiessvc.QueryFilter
	out []activitiessvc.Activity
}

func (f *fakeRepo) Query(_ context.Context, filter activitiessvc.QueryFilter) ([]activitiessvc.Activity, error) {
	f.got = filter
	return f.out, nil
}

func TestActivities_Query_Validation(t *testing.T) {
	tests := []struct {
		name    string
		req     Request
		wantErr bool
	}{
		{
			name:    "unknown scope rejected",
			req:     Request{Scope: "bogus"},
			wantErr: true,
		},
		{
			name:    "nearby scope without current_location rejected",
			req:     Request{Scope: activitiessvc.ScopeNearby},
			wantErr: true,
		},
		{
			name: "nearby scope with malformed lat rejected",
			req: Request{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 999, Lng: 20},
			},
			wantErr: true,
		},
		{
			name: "unknown category rejected",
			req: Request{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				Categories:      []activitiessvc.Category{"not-a-category"},
			},
			wantErr: true,
		},
		{
			name: "min_rating out of range rejected",
			req: Request{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				MinRating:       6,
			},
			wantErr: true,
		},
		{
			name: "negative max_distance_km rejected",
			req: Request{
				Scope:           activitiessvc.ScopeAnywhere,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				MaxDistanceKM:   -1,
			},
			wantErr: true,
		},
		{
			name: "valid nearby scope request accepted",
			req: Request{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
			},
			wantErr: false,
		},
		{
			name:    "anywhere scope with no location and no distance filter accepted",
			req:     Request{Scope: activitiessvc.ScopeAnywhere},
			wantErr: false,
		},
		{
			name: "anywhere scope with location and max_distance_km accepted",
			req: Request{
				Scope:           activitiessvc.ScopeAnywhere,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				MaxDistanceKM:   200,
			},
			wantErr: false,
		},
		{
			name: "anywhere scope with max_distance_km but no location rejected",
			req: Request{
				Scope:         activitiessvc.ScopeAnywhere,
				MaxDistanceKM: 200,
			},
			wantErr: true,
		},
		{
			name: "anywhere scope with cities and max_distance_km but no current_location accepted",
			req: Request{
				Scope:         activitiessvc.ScopeAnywhere,
				Cities:        []activitiessvc.Point{{Lat: 41.9, Lng: 12.5}},
				MaxDistanceKM: 200,
			},
			wantErr: false,
		},
		{
			name: "anywhere scope with malformed city rejected",
			req: Request{
				Scope:  activitiessvc.ScopeAnywhere,
				Cities: []activitiessvc.Point{{Lat: 999, Lng: 12.5}},
			},
			wantErr: true,
		},
		{
			name: "anywhere scope with malformed location rejected",
			req: Request{
				Scope:           activitiessvc.ScopeAnywhere,
				CurrentLocation: &activitiessvc.Point{Lat: 999, Lng: 20},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			svc := New(repo)
			_, err := svc.Query(context.Background(), tt.req)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("Query() error = nil, want error")
				}
				if !errors.Is(err, sharederrors.ErrInvalidInput) {
					t.Errorf("Query() error = %v, want wrapping ErrInvalidInput", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Query() unexpected error: %v", err)
			}
		})
	}
}

func TestActivities_Query_NearbyIgnoresRequestedDistance(t *testing.T) {
	tests := []struct {
		name           string
		requestedMaxKM float64
	}{
		{"no filter supplied", 0},
		{"smaller filter supplied", 5},
		{"larger filter supplied", 200},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			svc := New(repo)
			_, err := svc.Query(context.Background(), Request{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 1},
				MaxDistanceKM:   tt.requestedMaxKM,
			})
			if err != nil {
				t.Fatalf("Query() unexpected error: %v", err)
			}
			if repo.got.MaxDistanceKM != NearbyRadiusKM {
				t.Errorf("nearby radius = %v, want fixed %v", repo.got.MaxDistanceKM, NearbyRadiusKM)
			}
		})
	}
}

func TestActivities_Query_AnywhereNotCappedByNearbyRadius(t *testing.T) {
	repo := &fakeRepo{}
	svc := New(repo)
	_, err := svc.Query(context.Background(), Request{
		Scope:           activitiessvc.ScopeAnywhere,
		CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 1},
		MaxDistanceKM:   500,
	})
	if err != nil {
		t.Fatalf("Query() unexpected error: %v", err)
	}
	if repo.got.MaxDistanceKM != 500 {
		t.Errorf("anywhere max_distance_km = %v, want 500 (uncapped)", repo.got.MaxDistanceKM)
	}
}

func TestActivities_Query_AnywhereCitiesPassThroughAndOutrankLocation(t *testing.T) {
	repo := &fakeRepo{}
	svc := New(repo)
	cities := []activitiessvc.Point{{Lat: 41.9, Lng: 12.5}, {Lat: 48.85, Lng: 2.35}}
	_, err := svc.Query(context.Background(), Request{
		Scope:           activitiessvc.ScopeAnywhere,
		CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 1},
		Cities:          cities,
		MaxDistanceKM:   50,
	})
	if err != nil {
		t.Fatalf("Query() unexpected error: %v", err)
	}
	if len(repo.got.Cities) != 2 || repo.got.Cities[0] != cities[0] || repo.got.Cities[1] != cities[1] {
		t.Errorf("Cities = %v, want %v", repo.got.Cities, cities)
	}
	if repo.got.MaxDistanceKM != 50 {
		t.Errorf("MaxDistanceKM = %v, want 50 (uncapped)", repo.got.MaxDistanceKM)
	}
}

func TestActivities_Query_AnywhereNoDistanceCapWhenOmitted(t *testing.T) {
	repo := &fakeRepo{}
	svc := New(repo)
	_, err := svc.Query(context.Background(), Request{
		Scope:           activitiessvc.ScopeAnywhere,
		CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 1},
	})
	if err != nil {
		t.Fatalf("Query() unexpected error: %v", err)
	}
	if repo.got.MaxDistanceKM != 0 {
		t.Errorf("anywhere max_distance_km = %v, want 0 (no cap)", repo.got.MaxDistanceKM)
	}
}
