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

	gotListFilter activitiessvc.ListFilter
	listOut       activitiessvc.ListResult
	listErr       error

	gotGetID string
	getOut   activitiessvc.Activity
	getErr   error

	gotCreate activitiessvc.NewActivity
	createOut activitiessvc.Activity
	createErr error

	gotUpdateID    string
	gotUpdatePatch activitiessvc.UpdatePatch
	updateOut      activitiessvc.Activity
	updateErr      error
}

func (f *fakeRepo) Query(_ context.Context, filter activitiessvc.QueryFilter) ([]activitiessvc.Activity, error) {
	f.got = filter
	return f.out, nil
}

func (f *fakeRepo) SuggestCities(_ context.Context, _ string) ([]activitiessvc.CitySuggestion, error) {
	return f.citySuggestOut, nil
}

func (f *fakeRepo) List(_ context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error) {
	f.gotListFilter = filter
	return f.listOut, f.listErr
}

func (f *fakeRepo) GetByID(_ context.Context, id string) (activitiessvc.Activity, error) {
	f.gotGetID = id
	return f.getOut, f.getErr
}

func (f *fakeRepo) Create(_ context.Context, in activitiessvc.NewActivity) (activitiessvc.Activity, error) {
	f.gotCreate = in
	return f.createOut, f.createErr
}

func (f *fakeRepo) Update(_ context.Context, id string, patch activitiessvc.UpdatePatch) (activitiessvc.Activity, error) {
	f.gotUpdateID = id
	f.gotUpdatePatch = patch
	return f.updateOut, f.updateErr
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

func TestValidStatus(t *testing.T) {
	tests := []struct {
		name string
		s    activitiessvc.Status
		want bool
	}{
		{"published valid", activitiessvc.StatusPublished, true},
		{"draft valid", activitiessvc.StatusDraft, true},
		{"pending valid", activitiessvc.StatusPending, true},
		{"empty rejected", activitiessvc.Status(""), false},
		{"unknown value rejected", activitiessvc.Status("bogus"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validStatus(tt.s); got != tt.want {
				t.Errorf("validStatus(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}
}

func TestActivities_List(t *testing.T) {
	tests := []struct {
		name         string
		req          ListRequest
		wantErr      bool
		wantPage     int
		wantPageSize int
		wantOffset   int
	}{
		{
			name:         "defaults page to 1 and page_size to 20",
			req:          ListRequest{},
			wantPage:     1,
			wantPageSize: DefaultListPageSize,
			wantOffset:   0,
		},
		{
			name:         "page_size clamped to the max, not trusted from the caller",
			req:          ListRequest{Page: 3, PageSize: 100000},
			wantPage:     3,
			wantPageSize: MaxListPageSize,
			wantOffset:   2 * MaxListPageSize,
		},
		{
			name:         "negative page treated as 1",
			req:          ListRequest{Page: -5},
			wantPage:     1,
			wantPageSize: DefaultListPageSize,
			wantOffset:   0,
		},
		{
			name:         "zero/negative page_size falls back to the default",
			req:          ListRequest{PageSize: -1},
			wantPage:     1,
			wantPageSize: DefaultListPageSize,
		},
		{
			name:    "unknown category rejected",
			req:     ListRequest{Category: "bogus"},
			wantErr: true,
		},
		{
			name:    "unknown status rejected",
			req:     ListRequest{Status: "bogus"},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			svc := New(repo)
			_, page, pageSize, err := svc.List(context.Background(), tt.req)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("List() error = nil, want error")
				}
				if !errors.Is(err, sharederrors.ErrInvalidInput) {
					t.Errorf("List() error = %v, want wrapping ErrInvalidInput", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("List() unexpected error: %v", err)
			}
			if page != tt.wantPage || pageSize != tt.wantPageSize {
				t.Errorf("List() page/pageSize = %d/%d, want %d/%d", page, pageSize, tt.wantPage, tt.wantPageSize)
			}
			if repo.gotListFilter.Offset != tt.wantOffset || repo.gotListFilter.Limit != tt.wantPageSize {
				t.Errorf("repo filter limit/offset = %d/%d, want %d/%d", repo.gotListFilter.Limit, repo.gotListFilter.Offset, tt.wantPageSize, tt.wantOffset)
			}
		})
	}
}

func TestActivities_GetByID(t *testing.T) {
	t.Run("passes through repo result", func(t *testing.T) {
		repo := &fakeRepo{getOut: activitiessvc.Activity{ID: "1", Title: "Kayaking"}}
		svc := New(repo)
		got, err := svc.GetByID(context.Background(), "1")
		if err != nil {
			t.Fatalf("GetByID() unexpected error: %v", err)
		}
		if got.ID != "1" || repo.gotGetID != "1" {
			t.Errorf("GetByID() = %+v, repo got id %q", got, repo.gotGetID)
		}
	})
	t.Run("not found propagates the sentinel", func(t *testing.T) {
		repo := &fakeRepo{getErr: sharederrors.ErrNotFound}
		svc := New(repo)
		_, err := svc.GetByID(context.Background(), "missing")
		if !errors.Is(err, sharederrors.ErrNotFound) {
			t.Errorf("GetByID() error = %v, want wrapping ErrNotFound", err)
		}
	})
}

func TestActivities_Create(t *testing.T) {
	tests := []struct {
		name       string
		in         activitiessvc.NewActivity
		wantErr    bool
		wantStatus activitiessvc.Status
	}{
		{
			name:    "blank title rejected",
			in:      activitiessvc.NewActivity{Title: "   ", Category: activitiessvc.CategorySport},
			wantErr: true,
		},
		{
			name:    "missing category rejected",
			in:      activitiessvc.NewActivity{Title: "New Activity"},
			wantErr: true,
		},
		{
			name:    "unknown status rejected",
			in:      activitiessvc.NewActivity{Title: "New Activity", Category: activitiessvc.CategorySport, Status: "bogus"},
			wantErr: true,
		},
		{
			name:    "details not matching category rejected",
			in:      activitiessvc.NewActivity{Title: "New Activity", Category: activitiessvc.CategorySport, Details: json.RawMessage(`{"cuisine":"Italian"}`)},
			wantErr: true,
		},
		{
			name:       "status defaults to draft when omitted",
			in:         activitiessvc.NewActivity{Title: "  New Activity  ", Category: activitiessvc.CategorySport},
			wantStatus: activitiessvc.StatusDraft,
		},
		{
			name:       "explicit status is honored",
			in:         activitiessvc.NewActivity{Title: "New Activity", Category: activitiessvc.CategorySport, Status: activitiessvc.StatusPending},
			wantStatus: activitiessvc.StatusPending,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			svc := New(repo)
			_, err := svc.Create(context.Background(), tt.in)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("Create() error = nil, want error")
				}
				if !errors.Is(err, sharederrors.ErrInvalidInput) {
					t.Errorf("Create() error = %v, want wrapping ErrInvalidInput", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Create() unexpected error: %v", err)
			}
			if repo.gotCreate.Status != tt.wantStatus {
				t.Errorf("repo received status = %q, want %q", repo.gotCreate.Status, tt.wantStatus)
			}
			if repo.gotCreate.Title != "New Activity" {
				t.Errorf("repo received title = %q, want trimmed %q", repo.gotCreate.Title, "New Activity")
			}
		})
	}

	t.Run("empty details is normalized to {}", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		if _, err := svc.Create(context.Background(), activitiessvc.NewActivity{Title: "X", Category: activitiessvc.CategorySport}); err != nil {
			t.Fatalf("Create() unexpected error: %v", err)
		}
		if string(repo.gotCreate.Details) != "{}" {
			t.Errorf("repo received details = %q, want {}", repo.gotCreate.Details)
		}
	})
}

func TestActivities_Update(t *testing.T) {
	strPtr := func(s string) *string { return &s }
	catPtr := func(c activitiessvc.Category) *activitiessvc.Category { return &c }
	statusPtr := func(s activitiessvc.Status) *activitiessvc.Status { return &s }
	rawPtr := func(s string) *json.RawMessage { r := json.RawMessage(s); return &r }

	t.Run("unknown status rejected before hitting the repo", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{Status: statusPtr("bogus")})
		if !errors.Is(err, sharederrors.ErrInvalidInput) {
			t.Errorf("Update() error = %v, want wrapping ErrInvalidInput", err)
		}
		if repo.gotUpdateID != "" {
			t.Error("Update() must not call the repo when validation fails")
		}
	})

	t.Run("unknown category rejected before hitting the repo", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{Category: catPtr("bogus")})
		if !errors.Is(err, sharederrors.ErrInvalidInput) {
			t.Errorf("Update() error = %v, want wrapping ErrInvalidInput", err)
		}
	})

	t.Run("omitted fields are left nil, untouched, in the repo patch", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{Title: strPtr("New Title")})
		if err != nil {
			t.Fatalf("Update() unexpected error: %v", err)
		}
		if repo.gotUpdatePatch.Title == nil || *repo.gotUpdatePatch.Title != "New Title" {
			t.Errorf("repo patch title = %v, want New Title", repo.gotUpdatePatch.Title)
		}
		if repo.gotUpdatePatch.Status != nil || repo.gotUpdatePatch.City != nil || repo.gotUpdatePatch.Category != nil {
			t.Errorf("repo patch = %+v, want every other field nil (untouched)", repo.gotUpdatePatch)
		}
	})

	t.Run("details validated against the patch's own new category when both are set", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{
			Category: catPtr(activitiessvc.CategorySport),
			Details:  rawPtr(`{"cuisine":"Italian"}`), // restaurant-only field on the new (sport) category
		})
		if !errors.Is(err, sharederrors.ErrInvalidInput) {
			t.Errorf("Update() error = %v, want wrapping ErrInvalidInput (details don't match the new category)", err)
		}
		if repo.gotUpdateID != "" {
			t.Error("Update() must not call the repo when details validation fails")
		}
	})

	t.Run("details validated against the current category when the patch doesn't change category", func(t *testing.T) {
		repo := &fakeRepo{getOut: activitiessvc.Activity{Category: activitiessvc.CategoryRestaurants}}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{
			Details: rawPtr(`{"cuisine":"Italian"}`),
		})
		if err != nil {
			t.Fatalf("Update() unexpected error: %v", err)
		}
		if repo.gotGetID != "1" {
			t.Error("Update() should fetch the current activity to resolve its category for details validation")
		}
	})

	t.Run("category resolution is skipped (no extra GetByID) when details isn't set", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		if _, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{Title: strPtr("New Title")}); err != nil {
			t.Fatalf("Update() unexpected error: %v", err)
		}
		if repo.gotGetID != "" {
			t.Error("Update() should not fetch the current activity when details isn't part of the patch")
		}
	})

	t.Run("not found propagates the sentinel", func(t *testing.T) {
		repo := &fakeRepo{updateErr: sharederrors.ErrNotFound}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "missing", activitiessvc.UpdatePatch{Title: strPtr("X")})
		if !errors.Is(err, sharederrors.ErrNotFound) {
			t.Errorf("Update() error = %v, want wrapping ErrNotFound", err)
		}
	})

	t.Run("empty details is normalized to {} before validation and the repo patch", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{
			Category: catPtr(activitiessvc.CategorySport),
			Details:  rawPtr(""),
		})
		if err != nil {
			t.Fatalf("Update() unexpected error: %v", err)
		}
		if repo.gotUpdatePatch.Details == nil || string(*repo.gotUpdatePatch.Details) != "{}" {
			t.Errorf("repo patch details = %v, want {}", repo.gotUpdatePatch.Details)
		}
	})
}
