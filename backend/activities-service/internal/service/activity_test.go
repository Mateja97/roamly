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
			svc := New(repo, 50)
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

func TestActivities_Query_ResolvesEffectiveRadius(t *testing.T) {
	tests := []struct {
		name           string
		defaultRadius  float64
		requestedMaxKM float64
		want           float64
	}{
		{"no filter uses default", 50, 0, 50},
		{"filter narrower than default wins", 50, 10, 10},
		{"filter wider than default is capped at default", 50, 200, 50},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			svc := New(repo, tt.defaultRadius)
			_, err := svc.Query(context.Background(), Request{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 1},
				MaxDistanceKM:   tt.requestedMaxKM,
			})
			if err != nil {
				t.Fatalf("Query() unexpected error: %v", err)
			}
			if repo.got.MaxDistanceKM != tt.want {
				t.Errorf("effective radius = %v, want %v", repo.got.MaxDistanceKM, tt.want)
			}
		})
	}
}

func TestActivities_Query_AnywhereNotCappedByDefaultRadius(t *testing.T) {
	repo := &fakeRepo{}
	svc := New(repo, 50) // default radius (nearby's) is 50km
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

func TestActivities_Query_AnywhereNoDistanceCapWhenOmitted(t *testing.T) {
	repo := &fakeRepo{}
	svc := New(repo, 50)
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
