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
			name:    "home scope without home_location rejected",
			req:     Request{Scope: activitiessvc.ScopeHome},
			wantErr: true,
		},
		{
			name: "home scope with malformed lat rejected",
			req: Request{
				Scope:        activitiessvc.ScopeHome,
				HomeLocation: &activitiessvc.Point{Lat: 999, Lng: 20},
			},
			wantErr: true,
		},
		{
			name:    "nearby scope without current_location rejected",
			req:     Request{Scope: activitiessvc.ScopeNearby},
			wantErr: true,
		},
		{
			name:    "my_country scope without home_country rejected",
			req:     Request{Scope: activitiessvc.ScopeMyCountry},
			wantErr: true,
		},
		{
			name: "my_country scope with max_distance_km rejected",
			req: Request{
				Scope:         activitiessvc.ScopeMyCountry,
				HomeCountry:   "Serbia",
				MaxDistanceKM: 10,
			},
			wantErr: true,
		},
		{
			name: "unknown category rejected",
			req: Request{
				Scope:       activitiessvc.ScopeMyCountry,
				HomeCountry: "Serbia",
				Categories:  []activitiessvc.Category{"not-a-category"},
			},
			wantErr: true,
		},
		{
			name: "unknown price tier rejected",
			req: Request{
				Scope:       activitiessvc.ScopeMyCountry,
				HomeCountry: "Serbia",
				PriceTier:   "not-a-tier",
			},
			wantErr: true,
		},
		{
			name: "min_rating out of range rejected",
			req: Request{
				Scope:       activitiessvc.ScopeMyCountry,
				HomeCountry: "Serbia",
				MinRating:   6,
			},
			wantErr: true,
		},
		{
			name: "valid home scope request accepted",
			req: Request{
				Scope:        activitiessvc.ScopeHome,
				HomeLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
			},
			wantErr: false,
		},
		{
			name: "valid my_country request accepted",
			req: Request{
				Scope:       activitiessvc.ScopeMyCountry,
				HomeCountry: "Serbia",
			},
			wantErr: false,
		},
		{
			name: "unknown sort rejected",
			req: Request{
				Scope:       activitiessvc.ScopeMyCountry,
				HomeCountry: "Serbia",
				Sort:        "bogus",
			},
			wantErr: true,
		},
		{
			name: "sort=top_rated for scope home rejected",
			req: Request{
				Scope:        activitiessvc.ScopeHome,
				HomeLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				Sort:         activitiessvc.SortTopRated,
			},
			wantErr: true,
		},
		{
			name: "sort=top_rated for scope nearby rejected",
			req: Request{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				Sort:            activitiessvc.SortTopRated,
			},
			wantErr: true,
		},
		{
			name: "sort=top_rated for scope my_country accepted",
			req: Request{
				Scope:       activitiessvc.ScopeMyCountry,
				HomeCountry: "Serbia",
				Sort:        activitiessvc.SortTopRated,
			},
			wantErr: false,
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

func TestActivities_Query_ForwardsSortToRepository(t *testing.T) {
	repo := &fakeRepo{}
	svc := New(repo, 50)
	_, err := svc.Query(context.Background(), Request{
		Scope:       activitiessvc.ScopeMyCountry,
		HomeCountry: "Serbia",
		Sort:        activitiessvc.SortTopRated,
	})
	if err != nil {
		t.Fatalf("Query() unexpected error: %v", err)
	}
	if repo.got.Sort != activitiessvc.SortTopRated {
		t.Errorf("repo filter Sort = %q, want %q", repo.got.Sort, activitiessvc.SortTopRated)
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
				Scope:         activitiessvc.ScopeHome,
				HomeLocation:  &activitiessvc.Point{Lat: 1, Lng: 1},
				MaxDistanceKM: tt.requestedMaxKM,
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
