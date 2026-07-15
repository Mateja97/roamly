package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
)

type fakeRepo struct {
	got            activitiessvc.QueryFilter
	out            []activitiessvc.Activity
	citySuggestOut []activitiessvc.CitySuggestion
}

func (f *fakeRepo) Query(_ context.Context, filter activitiessvc.QueryFilter) ([]activitiessvc.Activity, error) {
	f.got = filter
	return f.out, nil
}

func (f *fakeRepo) SuggestCities(_ context.Context, _ string) ([]activitiessvc.CitySuggestion, error) {
	return f.citySuggestOut, nil
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

func TestValidCategory(t *testing.T) {
	tests := []struct {
		name string
		cat  activitiessvc.Category
		want bool
	}{
		{"restaurants valid", activitiessvc.CategoryRestaurants, true},
		{"cafes valid", activitiessvc.CategoryCafes, true},
		{"bars valid", activitiessvc.CategoryBars, true},
		{"nightlife valid", activitiessvc.CategoryNightlife, true},
		{"nature valid", activitiessvc.CategoryNature, true},
		{"sport valid", activitiessvc.CategorySport, true},
		{"kids valid", activitiessvc.CategoryKids, true},
		{"culture valid", activitiessvc.CategoryCulture, true},
		{"art valid", activitiessvc.CategoryArt, true},
		{"wellness valid", activitiessvc.CategoryWellness, true},
		{"shopping valid", activitiessvc.CategoryShopping, true},
		{"entertainment valid", activitiessvc.CategoryEntertainment, true},
		{"retired food_and_drink rejected", activitiessvc.Category("food_and_drink"), false},
		{"retired history_and_culture rejected", activitiessvc.Category("history_and_culture"), false},
		{"retired nature_and_outdoors rejected", activitiessvc.Category("nature_and_outdoors"), false},
		{"retired art_and_design rejected", activitiessvc.Category("art_and_design"), false},
		{"retired sports rejected", activitiessvc.Category("sports"), false},
		{"retired entertainment_and_wellness rejected", activitiessvc.Category("entertainment_and_wellness"), false},
		{"unknown category rejected", activitiessvc.Category("bogus"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validCategory(tt.cat); got != tt.want {
				t.Errorf("validCategory(%q) = %v, want %v", tt.cat, got, tt.want)
			}
		})
	}
}

func TestValidateDetails(t *testing.T) {
	tests := []struct {
		name    string
		cat     activitiessvc.Category
		details string
		wantErr bool
	}{
		{"empty payload always valid", activitiessvc.CategorySport, "", false},
		{"empty object always valid", activitiessvc.CategorySport, "{}", false},
		{"matching restaurant shape accepted", activitiessvc.CategoryRestaurants,
			`{"cuisine":"Italian","price_tier":"$$","popular_dishes":[{"name":"Pizza","price":"$12"}]}`, false},
		{"restaurant field on sport category rejected", activitiessvc.CategorySport,
			`{"cuisine":"Italian"}`, true},
		{"matching sport shape accepted", activitiessvc.CategorySport,
			`{"difficulty":3,"effort_level":"moderate","what_to_bring":["water","boots"]}`, false},
		{"matching wellness shape accepted", activitiessvc.CategoryWellness,
			`{"treatments":[{"item":"Massage","duration":"60m","price":"$80"}],"external_booking_note":"book via website"}`, false},
		{"unknown field on wellness rejected", activitiessvc.CategoryWellness,
			`{"vibe":"chill"}`, true},
		{"unknown category rejected even with empty-ish payload", activitiessvc.Category("bogus"),
			`{"anything":"goes"}`, true},
		{"valid action_url on restaurants accepted", activitiessvc.CategoryRestaurants,
			`{"cuisine":"Italian","action_url":"https://example.com/book"}`, false},
		{"action_url missing scheme rejected", activitiessvc.CategoryRestaurants,
			`{"action_url":"example.com/book"}`, true},
		{"action_url with non-http(s) scheme rejected", activitiessvc.CategoryBars,
			`{"action_url":"ftp://example.com/book"}`, true},
		{"action_url with no host rejected", activitiessvc.CategoryNightlife,
			`{"action_url":"https:///book"}`, true},
		{"action_url on wellness accepted", activitiessvc.CategoryWellness,
			`{"action_url":"https://example.com/visit"}`, false},
		{"valid art year accepted", activitiessvc.CategoryArt,
			`{"artwork":{"artist":"Marina Abramović"},"year":2019}`, false},
		{"art year too low rejected", activitiessvc.CategoryArt,
			`{"year":42}`, true},
		{"art year too far in the future rejected", activitiessvc.CategoryArt,
			`{"year":9999}`, true},
		{"art action_url and year together accepted", activitiessvc.CategoryArt,
			`{"action_url":"https://tickets.example.com/show","year":1935}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateDetails(tt.cat, json.RawMessage(tt.details))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ValidateDetails() error = nil, want error")
				}
				if !errors.Is(err, sharederrors.ErrInvalidInput) {
					t.Errorf("ValidateDetails() error = %v, want wrapping ErrInvalidInput", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ValidateDetails() unexpected error: %v", err)
			}
		})
	}
}

func TestActivities_SuggestCities(t *testing.T) {
	tests := []struct {
		name    string
		query   string
		repoOut []activitiessvc.CitySuggestion
		wantLen int
	}{
		{
			name:    "blank query short-circuits without hitting the repo",
			query:   "   ",
			repoOut: []activitiessvc.CitySuggestion{{City: "Barcelona"}},
			wantLen: 0,
		},
		{
			name:    "matching prefix passes repo results through",
			query:   "Bar",
			repoOut: []activitiessvc.CitySuggestion{{City: "Barcelona", Country: "Spain", Centroid: activitiessvc.Point{Lat: 41.4, Lng: 2.17}}},
			wantLen: 1,
		},
		{
			name:    "non-matching prefix returns empty, not an error",
			query:   "Zzznope",
			repoOut: nil,
			wantLen: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{citySuggestOut: tt.repoOut}
			svc := New(repo)
			got, err := svc.SuggestCities(context.Background(), tt.query)
			if err != nil {
				t.Fatalf("SuggestCities() unexpected error: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Errorf("got %d suggestions, want %d", len(got), tt.wantLen)
			}
		})
	}
}
