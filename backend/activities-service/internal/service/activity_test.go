package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"activities-service/internal/places"
	"activities-service/internal/placesmap"

	"backend/shared/contentkind"
	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
)

type fakeRepo struct {
	got            activitiessvc.QueryFilter
	out            []activitiessvc.Activity
	citySuggestOut []activitiessvc.CitySuggestion

	adminCitiesOut []string
	adminCitiesErr error

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
	// updateCalls (T2, places-live-details) explicitly counts Update calls —
	// the live-merge path's own acceptance criterion is "never persists",
	// asserted directly against this rather than inferred from gotUpdateID.
	updateCalls int

	upsertMu    sync.Mutex                     // Upsert runs syncVenueConcurrency-wide during a sweep
	gotUpsert   activitiessvc.IngestActivity   // most recent call
	gotUpserts  []activitiessvc.IngestActivity // every call, in call order
	upsertCalls int
	upsertOut   activitiessvc.Activity
	upsertErr   error

	syncMu      sync.Mutex           // MarkSynced runs concurrently once Google's sweep lands
	syncedAtOut map[string]time.Time // key: syncKey(provider, cellKey, category, subtype)
	markSynced  []string             // syncKey(...), in call order
}

func (f *fakeRepo) Query(_ context.Context, filter activitiessvc.QueryFilter) ([]activitiessvc.Activity, error) {
	f.got = filter
	return f.out, nil
}

func (f *fakeRepo) SuggestCities(_ context.Context, _ string) ([]activitiessvc.CitySuggestion, error) {
	return f.citySuggestOut, nil
}

func (f *fakeRepo) AdminDistinctCities(_ context.Context) ([]string, error) {
	return f.adminCitiesOut, f.adminCitiesErr
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
	f.updateCalls++
	f.gotUpdateID = id
	f.gotUpdatePatch = patch
	return f.updateOut, f.updateErr
}

func (f *fakeRepo) Upsert(_ context.Context, in activitiessvc.IngestActivity) (activitiessvc.Activity, error) {
	f.upsertMu.Lock()
	defer f.upsertMu.Unlock()
	f.gotUpsert = in
	f.gotUpserts = append(f.gotUpserts, in)
	f.upsertCalls++
	return f.upsertOut, f.upsertErr
}

func (f *fakeRepo) SyncedAt(_ context.Context, provider, cellKey, category, subtype string) (time.Time, bool, error) {
	t, ok := f.syncedAtOut[syncKey(provider, cellKey, category, subtype)]
	return t, ok, nil
}

// FreshSyncRows derives its answer from the same syncedAtOut fixture SyncedAt
// already reads, rather than a second fixture field, so a test only has to
// set up freshness once regardless of which of the two paths (or both) it
// exercises. category/subtype are recovered from the key syncKey built, which
// only fully round-trips for non-Tripadvisor keys (see syncKey) — fine here,
// since Google is FreshSyncRows' only caller.
func (f *fakeRepo) FreshSyncRows(_ context.Context, provider, cellKey string, since time.Time) (map[string]bool, error) {
	fresh := make(map[string]bool)
	prefix := provider + "|" + cellKey + "|"
	for key, syncedAt := range f.syncedAtOut {
		if !strings.HasPrefix(key, prefix) || !syncedAt.After(since) {
			continue
		}
		fresh[strings.TrimPrefix(key, prefix)] = true
	}
	return fresh, nil
}

func (f *fakeRepo) MarkSynced(_ context.Context, provider, cellKey, category, subtype string) error {
	f.syncMu.Lock()
	defer f.syncMu.Unlock()
	f.markSynced = append(f.markSynced, syncKey(provider, cellKey, category, subtype))
	return nil
}

// syncKey keeps Tripadvisor's existing "cell|category" test key shape so the
// pre-existing sync assertions are untouched, and extends it only for other
// providers or subtype-scoped rows.
func syncKey(provider, cellKey, category, subtype string) string {
	if provider == ProviderTripadvisor && subtype == "" {
		return cellKey + "|" + category
	}
	return provider + "|" + cellKey + "|" + category + "|" + subtype
}

// fakeGooglePlaces stands in for internal/places.Client in sync tests.
type fakeGooglePlaces struct {
	mu          sync.Mutex
	nearbyOut   []placesmap.Place
	nearbyErr   error
	nearbyCalls int
	gotNearby   []places.NearbyRequest
	// blockNearby, if non-nil, is received from inside SearchNearby after
	// recording the call — lets concurrency tests hold a sweep "in flight"
	// deterministically instead of racing on goroutine scheduling.
	blockNearby chan struct{}

	photosOut         []activitiessvc.Photo
	photosErr         error
	resolvePhotoCalls int

	geocodeCity    string
	geocodeCountry string
	geocodeErr     error
	geocodeCalls   int

	// gotSearchTextInArea records each SearchTextInArea call's args so tests
	// can assert ResolveTripadvisorSubtype anchors the search on the
	// venue's own coordinates/radius, not some other value.
	gotSearchTextInArea []searchTextInAreaCall
}

type searchTextInAreaCall struct {
	lat, lng float64
	radiusKM float64
}

func (f *fakeGooglePlaces) SearchNearby(_ context.Context, req places.NearbyRequest, _ string) ([]placesmap.Place, error) {
	f.mu.Lock()
	f.nearbyCalls++
	f.gotNearby = append(f.gotNearby, req)
	block := f.blockNearby
	f.mu.Unlock()
	if block != nil {
		<-block
	}
	return f.nearbyOut, f.nearbyErr
}

func (f *fakeGooglePlaces) ResolvePhotos(_ context.Context, _ string, _ int) ([]activitiessvc.Photo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resolvePhotoCalls++
	return f.photosOut, f.photosErr
}

func (f *fakeGooglePlaces) PlaceDetails(_ context.Context, _ string) (placesmap.PlaceDetail, error) {
	return placesmap.PlaceDetail{}, nil
}

// SearchTextInArea shares nearbyOut/nearbyErr with SearchNearby: these tests
// exercise the sweep's behavior around a Places call succeeding or failing,
// not which of the two discovery paths a given row happens to take (see
// placesmap.DiscoveryRow's Types/TextQuery split).
func (f *fakeGooglePlaces) SearchTextInArea(_ context.Context, _ string, lat, lng, radiusKM float64, _ string) ([]placesmap.Place, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gotSearchTextInArea = append(f.gotSearchTextInArea, searchTextInAreaCall{lat: lat, lng: lng, radiusKM: radiusKM})
	return f.nearbyOut, f.nearbyErr
}

func (f *fakeGooglePlaces) ReverseGeocodeCity(_ context.Context, _, _ float64) (string, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.geocodeCalls++
	return f.geocodeCity, f.geocodeCountry, f.geocodeErr
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
		{"tours_experiences valid", activitiessvc.CategoryToursExperiences, true},
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
		{"cafe tripadvisor shape accepted — cafés is the one dual-sourced category (#103/#104)",
			activitiessvc.CategoryCafes,
			`{"known_for_brew":"Pour-over","tripadvisor":{"review_count":104},"reviews":[{"rating":5}]}`, false},
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
			_, err := ValidateDetails(tt.cat, json.RawMessage(tt.details))
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

func TestValidateDetails_OpeningHours(t *testing.T) {
	tests := []struct {
		name    string
		cat     activitiessvc.Category
		details string
		wantErr bool
	}{
		{"valid weekly periods accepted", activitiessvc.CategoryRestaurants,
			`{"opening_hours":{"timezone":"Europe/Belgrade","periods":[{"day":"monday","open":"09:00","close":"17:00"}]}}`, false},
		{"always_open true with no periods accepted", activitiessvc.CategoryCafes,
			`{"opening_hours":{"timezone":"UTC","always_open":true}}`, false},
		{"past-midnight close before open accepted", activitiessvc.CategoryBars,
			`{"opening_hours":{"timezone":"America/New_York","periods":[{"day":"friday","open":"20:00","close":"02:00"}]}}`, false},
		{"missing timezone rejected", activitiessvc.CategoryShopping,
			`{"opening_hours":{"periods":[{"day":"monday","open":"09:00","close":"17:00"}]}}`, true},
		{"Local sentinel rejected as not a real IANA zone", activitiessvc.CategoryShopping,
			`{"opening_hours":{"timezone":"Local","always_open":true}}`, true},
		{"bogus timezone rejected", activitiessvc.CategoryNightlife,
			`{"opening_hours":{"timezone":"Bogus/Nowhere","always_open":true}}`, true},
		{"invalid day-of-week rejected", activitiessvc.CategoryCulture,
			`{"opening_hours":{"timezone":"UTC","periods":[{"day":"someday","open":"09:00","close":"17:00"}]}}`, true},
		{"open time not HH:MM rejected", activitiessvc.CategoryArt,
			`{"opening_hours":{"timezone":"UTC","periods":[{"day":"monday","open":"9am","close":"17:00"}]}}`, true},
		{"close time not HH:MM rejected", activitiessvc.CategoryArt,
			`{"opening_hours":{"timezone":"UTC","periods":[{"day":"monday","open":"09:00","close":"5pm"}]}}`, true},
		{"non-zero-padded hour rejected", activitiessvc.CategoryArt,
			`{"opening_hours":{"timezone":"UTC","periods":[{"day":"monday","open":"9:00","close":"17:00"}]}}`, true},
		{"always_open false with no periods rejected as malformed", activitiessvc.CategoryRestaurants,
			`{"opening_hours":{"timezone":"UTC","always_open":false}}`, true},
		{"unknown key inside opening_hours still rejected by strict decode", activitiessvc.CategoryRestaurants,
			`{"opening_hours":{"timezone":"UTC","always_open":true,"holiday_note":"closed Dec 25"}}`, true},
		{"opening_hours on a category with no hours chip rejected as unknown field", activitiessvc.CategorySport,
			`{"opening_hours":{"timezone":"UTC","always_open":true}}`, true},
		{"activity with opening_hours plus existing free-text hours field accepted", activitiessvc.CategoryRestaurants,
			`{"hours":"Mon-Fri 9-5","opening_hours":{"timezone":"UTC","always_open":true}}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ValidateDetails(tt.cat, json.RawMessage(tt.details))
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

// TestValidateDetails_ClearsDenylistedFields covers T1's guard: a
// denylisted value is stored empty (never rejected), across every field the
// spec's kind-declarations table names (typical_visit, price_from,
// treatments[].price, good_to_know[], vibe) plus Entertainment's
// typical_show_length, and Nature's good_to_know (previously an unhandled
// default case in validateExtraFields).
func TestValidateDetails_ClearsDenylistedFields(t *testing.T) {
	t.Run("wellness typical_visit and price_from cleared for every denylist entry", func(t *testing.T) {
		for _, entry := range contentkind.Denylist() {
			raw := fmt.Sprintf(`{"typical_visit":%q,"price_from":%q}`, entry, entry)
			cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
			if err != nil {
				t.Fatalf("entry %q: ValidateDetails() unexpected error: %v", entry, err)
			}
			var got activitiessvc.WellnessDetails
			if err := json.Unmarshal(cleaned, &got); err != nil {
				t.Fatalf("entry %q: unmarshaling cleaned details: %v", entry, err)
			}
			if got.TypicalVisit != "" {
				t.Errorf("entry %q: typical_visit = %q, want cleared", entry, got.TypicalVisit)
			}
			if got.PriceFrom != "" {
				t.Errorf("entry %q: price_from = %q, want cleared", entry, got.PriceFrom)
			}
		}
	})

	t.Run("wellness legitimate spec-example values pass unchanged", func(t *testing.T) {
		for _, v := range []string{"60–90 min", "from €25", "Smart casual", "2 h 30 min", "EN, DE"} {
			raw := fmt.Sprintf(`{"typical_visit":%q,"price_from":%q}`, v, v)
			cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
			if err != nil {
				t.Fatalf("value %q: ValidateDetails() unexpected error: %v", v, err)
			}
			var got activitiessvc.WellnessDetails
			if err := json.Unmarshal(cleaned, &got); err != nil {
				t.Fatalf("value %q: unmarshaling cleaned details: %v", v, err)
			}
			if got.TypicalVisit != v || got.PriceFrom != v {
				t.Errorf("value %q: got typical_visit=%q price_from=%q, want unchanged", v, got.TypicalVisit, got.PriceFrom)
			}
		}
	})

	t.Run("normalization across case, whitespace, and trailing punctuation", func(t *testing.T) {
		for _, v := range []string{
			"NOT SPECIFIED", "Not Specified", "  not specified  ", "not   specified",
			"Not specified.", "NOT SPECIFIED!", "not specified?",
		} {
			raw := fmt.Sprintf(`{"typical_visit":%q}`, v)
			cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
			if err != nil {
				t.Fatalf("variant %q: unexpected error: %v", v, err)
			}
			var got activitiessvc.WellnessDetails
			if err := json.Unmarshal(cleaned, &got); err != nil {
				t.Fatalf("variant %q: unmarshaling: %v", v, err)
			}
			if got.TypicalVisit != "" {
				t.Errorf("variant %q: typical_visit = %q, want cleared", v, got.TypicalVisit)
			}
		}
	})

	t.Run("wellness treatments[].price cleared per-entry, item/duration/other rows untouched", func(t *testing.T) {
		raw := `{"treatments":[{"item":"Massage","duration":"60m","price":"Nije navedeno"},{"item":"Facial","duration":"45m","price":"from €40"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.WellnessDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.Treatments) != 2 {
			t.Fatalf("treatments = %+v, want 2 rows (only price denylisted, item is legitimate)", got.Treatments)
		}
		if got.Treatments[0].Price != "" {
			t.Errorf("treatments[0].price = %q, want cleared", got.Treatments[0].Price)
		}
		if got.Treatments[0].Item != "Massage" || got.Treatments[0].Duration != "60m" {
			t.Errorf("treatments[0] item/duration changed unexpectedly: %+v", got.Treatments[0])
		}
		if got.Treatments[1].Price != "from €40" {
			t.Errorf("treatments[1].price = %q, want unchanged", got.Treatments[1].Price)
		}
	})

	t.Run("wellness treatments[].duration cleared per-entry when denylisted", func(t *testing.T) {
		raw := `{"treatments":[{"item":"Massage","duration":"not specified","price":"from €40"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.WellnessDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.Treatments) != 1 {
			t.Fatalf("treatments = %+v, want 1 row (item is legitimate)", got.Treatments)
		}
		if got.Treatments[0].Duration != "" {
			t.Errorf("treatments[0].duration = %q, want cleared", got.Treatments[0].Duration)
		}
		if got.Treatments[0].Item != "Massage" || got.Treatments[0].Price != "from €40" {
			t.Errorf("treatments[0] item/price changed unexpectedly: %+v", got.Treatments[0])
		}
	})

	t.Run("wellness treatments row dropped entirely when item is denylisted, other rows kept", func(t *testing.T) {
		raw := `{"treatments":[{"item":"Not specified","duration":"60m","price":"from €40"},{"item":"Facial","duration":"45m","price":"from €35"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.WellnessDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.Treatments) != 1 {
			t.Fatalf("treatments = %+v, want 1 row (denylisted item drops the whole row)", got.Treatments)
		}
		if got.Treatments[0].Item != "Facial" {
			t.Errorf("treatments[0].item = %q, want %q kept", got.Treatments[0].Item, "Facial")
		}
	})

	t.Run("wellness good_to_know drops only denylisted entries", func(t *testing.T) {
		raw := `{"good_to_know":["Bring your own towel","Nije navedeno","Cash only"]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.WellnessDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if want := []string{"Bring your own towel", "Cash only"}; !slices.Equal(got.GoodToKnow, want) {
			t.Errorf("good_to_know = %v, want %v", got.GoodToKnow, want)
		}
	})

	t.Run("entertainment price_from, typical_show_length, good_to_know cleared", func(t *testing.T) {
		raw := `{"price_from":"not available","typical_show_length":"N/A","good_to_know":["Doors open early","none"]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryEntertainment, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.EntertainmentDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.PriceFrom != "" {
			t.Errorf("price_from = %q, want cleared", got.PriceFrom)
		}
		if got.TypicalShowLength != "" {
			t.Errorf("typical_show_length = %q, want cleared", got.TypicalShowLength)
		}
		if want := []string{"Doors open early"}; !slices.Equal(got.GoodToKnow, want) {
			t.Errorf("good_to_know = %v, want %v", got.GoodToKnow, want)
		}
	})

	t.Run("entertainment upcoming_shows[].date/time_or_price cleared per-entry, title-legitimate rows kept", func(t *testing.T) {
		raw := `{"upcoming_shows":[{"date":"not available","title":"Jazz Night","time_or_price":"unknown"},{"date":"2026-09-01","title":"Comedy Hour","time_or_price":"from $20"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryEntertainment, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.EntertainmentDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.UpcomingShows) != 2 {
			t.Fatalf("upcoming_shows = %+v, want 2 rows (both titles legitimate)", got.UpcomingShows)
		}
		if got.UpcomingShows[0].Date != "" || got.UpcomingShows[0].TimeOrPrice != "" {
			t.Errorf("upcoming_shows[0] = %+v, want date/time_or_price cleared", got.UpcomingShows[0])
		}
		if got.UpcomingShows[0].Title != "Jazz Night" {
			t.Errorf("upcoming_shows[0].title = %q, want unchanged", got.UpcomingShows[0].Title)
		}
		if got.UpcomingShows[1].Date != "2026-09-01" || got.UpcomingShows[1].TimeOrPrice != "from $20" {
			t.Errorf("upcoming_shows[1] changed unexpectedly: %+v", got.UpcomingShows[1])
		}
	})

	t.Run("entertainment upcoming_shows row dropped entirely when title is denylisted, other rows kept", func(t *testing.T) {
		raw := `{"upcoming_shows":[{"date":"2026-09-01","title":"N/A","time_or_price":"from $20"},{"date":"2026-09-02","title":"Comedy Hour","time_or_price":"from $15"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryEntertainment, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.EntertainmentDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.UpcomingShows) != 1 {
			t.Fatalf("upcoming_shows = %+v, want 1 row (denylisted title drops the whole row)", got.UpcomingShows)
		}
		if got.UpcomingShows[0].Title != "Comedy Hour" {
			t.Errorf("upcoming_shows[0].title = %q, want %q kept", got.UpcomingShows[0].Title, "Comedy Hour")
		}
	})

	t.Run("bars vibe cleared when denylisted, legit scalar kept", func(t *testing.T) {
		cleaned, err := ValidateDetails(activitiessvc.CategoryBars, json.RawMessage(`{"vibe":"Nema podataka"}`))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.BarDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.Vibe != "" {
			t.Errorf("vibe = %q, want cleared", got.Vibe)
		}

		cleaned, err = ValidateDetails(activitiessvc.CategoryBars, json.RawMessage(`{"vibe":"Intimate"}`))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.Vibe != "Intimate" {
			t.Errorf("vibe = %q, want unchanged", got.Vibe)
		}
	})

	t.Run("nature good_to_know cleared", func(t *testing.T) {
		raw := `{"good_to_know":["Wear sturdy shoes","Nepoznato"]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryNature, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.NatureDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if want := []string{"Wear sturdy shoes"}; !slices.Equal(got.GoodToKnow, want) {
			t.Errorf("good_to_know = %v, want %v", got.GoodToKnow, want)
		}
	})

	t.Run("a denylist match clears the field but never rejects the write", func(t *testing.T) {
		_, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(`{"typical_visit":"not specified","action_url":"https://example.com"}`))
		if err != nil {
			t.Fatalf("ValidateDetails() unexpected error: %v (a denylist match must clear the field, not fail the request)", err)
		}
	})

	t.Run("sport effort_level, duration, gear, what_to_bring cleared, difficulty untouched", func(t *testing.T) {
		raw := `{"effort_level":"Unknown","duration":"N/A","gear":"none","what_to_bring":["Water bottle","Not specified"],"difficulty":3}`
		cleaned, err := ValidateDetails(activitiessvc.CategorySport, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.SportDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.EffortLevel != "" {
			t.Errorf("effort_level = %q, want cleared", got.EffortLevel)
		}
		if got.Duration != "" {
			t.Errorf("duration = %q, want cleared", got.Duration)
		}
		if got.Gear != "" {
			t.Errorf("gear = %q, want cleared", got.Gear)
		}
		if want := []string{"Water bottle"}; !slices.Equal(got.WhatToBring, want) {
			t.Errorf("what_to_bring = %v, want %v", got.WhatToBring, want)
		}
		if got.Difficulty != 3 {
			t.Errorf("difficulty = %d, want unchanged (not a denylist-guarded field)", got.Difficulty)
		}
	})

	t.Run("sport legitimate values pass unchanged", func(t *testing.T) {
		raw := `{"effort_level":"Moderate","duration":"2 hours","gear":"Helmet provided","what_to_bring":["Comfortable shoes"]}`
		cleaned, err := ValidateDetails(activitiessvc.CategorySport, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.SportDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.EffortLevel != "Moderate" || got.Duration != "2 hours" || got.Gear != "Helmet provided" {
			t.Errorf("got %+v, want values unchanged", got)
		}
		if want := []string{"Comfortable shoes"}; !slices.Equal(got.WhatToBring, want) {
			t.Errorf("what_to_bring = %v, want %v", got.WhatToBring, want)
		}
	})

	t.Run("culture now_showing dropped entirely when title is denylisted, even if description is legitimate", func(t *testing.T) {
		raw := `{"now_showing":{"title":"Unknown","description":"A real description of the current show."}}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryCulture, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.CultureDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.NowShowing != nil {
			t.Errorf("now_showing = %+v, want nil (denylisted title drops the whole banner)", got.NowShowing)
		}
	})

	t.Run("culture now_showing dropped entirely when title is whitespace-only", func(t *testing.T) {
		raw := `{"now_showing":{"title":"   ","description":"A real description of the current show."}}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryCulture, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.CultureDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.NowShowing != nil {
			t.Errorf("now_showing = %+v, want nil (whitespace-only title counts as absent, same as blank)", got.NowShowing)
		}
	})

	t.Run("culture now_showing description cleared but banner kept when title is legitimate", func(t *testing.T) {
		raw := `{"now_showing":{"title":"Impressionists Retrospective","description":"not specified"}}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryCulture, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.CultureDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.NowShowing == nil {
			t.Fatalf("now_showing = nil, want kept (title is legitimate)")
		}
		if got.NowShowing.Title != "Impressionists Retrospective" {
			t.Errorf("now_showing.title = %q, want unchanged", got.NowShowing.Title)
		}
		if got.NowShowing.Description != "" {
			t.Errorf("now_showing.description = %q, want cleared", got.NowShowing.Description)
		}
	})

	t.Run("art current_exhibition dropped entirely when title is denylisted", func(t *testing.T) {
		raw := `{"current_exhibition":{"title":"N/A","description":"Some description."}}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryArt, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.ArtDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.CurrentExhibition != nil {
			t.Errorf("current_exhibition = %+v, want nil (denylisted title drops the whole banner)", got.CurrentExhibition)
		}
	})

	t.Run("art current_exhibition passes unchanged when both title and description are legitimate", func(t *testing.T) {
		raw := `{"current_exhibition":{"title":"Modern Sculpture","description":"A collection of works from local artists."}}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryArt, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.ArtDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.CurrentExhibition == nil || got.CurrentExhibition.Title != "Modern Sculpture" || got.CurrentExhibition.Description != "A collection of works from local artists." {
			t.Errorf("current_exhibition = %+v, want unchanged", got.CurrentExhibition)
		}
	})
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

func TestActivities_AdminListCities(t *testing.T) {
	repo := &fakeRepo{adminCitiesOut: []string{"Barcelona", "Belgrade"}}
	svc := New(repo)

	got, err := svc.AdminListCities(context.Background())
	if err != nil {
		t.Fatalf("AdminListCities() unexpected error: %v", err)
	}
	if len(got) != 2 || got[0] != "Barcelona" || got[1] != "Belgrade" {
		t.Errorf("got %v, want [Barcelona Belgrade]", got)
	}
}

func TestActivities_AdminListCities_RepoErrorWraps(t *testing.T) {
	repo := &fakeRepo{adminCitiesErr: errors.New("db exploded")}
	svc := New(repo)

	if _, err := svc.AdminListCities(context.Background()); err == nil {
		t.Fatal("expected an error, got nil")
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
		{
			name:       "valid subcategory for category accepted",
			in:         activitiessvc.NewActivity{Title: "New Activity", Category: activitiessvc.CategoryNightlife, Subcategory: "nightclub"},
			wantStatus: activitiessvc.StatusDraft,
		},
		{
			name:       "empty subcategory accepted",
			in:         activitiessvc.NewActivity{Title: "New Activity", Category: activitiessvc.CategoryNightlife, Subcategory: ""},
			wantStatus: activitiessvc.StatusDraft,
		},
		{
			name:    "wrong-category subcategory rejected",
			in:      activitiessvc.NewActivity{Title: "New Activity", Category: activitiessvc.CategoryNightlife, Subcategory: "fine_dining"},
			wantErr: true,
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

	// T1: a denylisted value in Details is never handed to the repo — the
	// write itself must still succeed, with the offending field cleared.
	// Bars/Restaurants/Cafes can't be admin-Created (blocked above), so
	// Wellness is used here — its typical_visit is the exact field named in
	// the production bug report.
	t.Run("denylisted typical_visit is cleared before reaching the repo, write still succeeds", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Create(context.Background(), activitiessvc.NewActivity{
			Title: "New Spa", Category: activitiessvc.CategoryWellness,
			Details: json.RawMessage(`{"typical_visit":"Nije navedeno"}`),
		})
		if err != nil {
			t.Fatalf("Create() unexpected error: %v", err)
		}
		var got activitiessvc.WellnessDetails
		if err := json.Unmarshal(repo.gotCreate.Details, &got); err != nil {
			t.Fatalf("unmarshaling repo-received details: %v", err)
		}
		if got.TypicalVisit != "" {
			t.Errorf("repo received typical_visit = %q, want cleared", got.TypicalVisit)
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

	t.Run("subcategory validated against the patch's own new category when both are set", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{
			Category:    catPtr(activitiessvc.CategorySport),
			Subcategory: strPtr("fine_dining"), // restaurants-only subtype on the new (sport) category
		})
		if !errors.Is(err, sharederrors.ErrInvalidInput) {
			t.Errorf("Update() error = %v, want wrapping ErrInvalidInput (subcategory doesn't match the new category)", err)
		}
		if repo.gotUpdateID != "" {
			t.Error("Update() must not call the repo when subcategory validation fails")
		}
	})

	t.Run("subcategory validated against the current category when the patch doesn't change category", func(t *testing.T) {
		repo := &fakeRepo{getOut: activitiessvc.Activity{Category: activitiessvc.CategoryRestaurants}}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{
			Subcategory: strPtr("fine_dining"),
		})
		if err != nil {
			t.Fatalf("Update() unexpected error: %v", err)
		}
		if repo.gotGetID != "1" {
			t.Error("Update() should fetch the current activity to resolve its category for subcategory validation")
		}
	})

	t.Run("empty subcategory accepted (clears it)", func(t *testing.T) {
		repo := &fakeRepo{getOut: activitiessvc.Activity{Category: activitiessvc.CategoryRestaurants}}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{
			Subcategory: strPtr(""),
		})
		if err != nil {
			t.Fatalf("Update() unexpected error: %v", err)
		}
		if repo.gotUpdatePatch.Subcategory == nil || *repo.gotUpdatePatch.Subcategory != "" {
			t.Errorf("repo patch subcategory = %v, want empty string", repo.gotUpdatePatch.Subcategory)
		}
	})

	// T1: same guard as Create, on the Update path — the write still
	// succeeds, with the denylisted field cleared in what reaches the repo.
	t.Run("denylisted vibe is cleared before reaching the repo, write still succeeds", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Update(context.Background(), "1", activitiessvc.UpdatePatch{
			Category: catPtr(activitiessvc.CategoryBars),
			Details:  rawPtr(`{"vibe":"nema podataka"}`),
		})
		if err != nil {
			t.Fatalf("Update() unexpected error: %v", err)
		}
		if repo.gotUpdatePatch.Details == nil {
			t.Fatalf("repo patch details = nil, want the cleaned payload")
		}
		var got activitiessvc.BarDetails
		if err := json.Unmarshal(*repo.gotUpdatePatch.Details, &got); err != nil {
			t.Fatalf("unmarshaling repo-received details: %v", err)
		}
		if got.Vibe != "" {
			t.Errorf("repo received vibe = %q, want cleared", got.Vibe)
		}
	})
}

func TestActivities_Create_BlocksTripadvisorSourcedCategories(t *testing.T) {
	for _, cat := range []activitiessvc.Category{activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes, activitiessvc.CategoryBars} {
		t.Run(string(cat), func(t *testing.T) {
			repo := &fakeRepo{}
			svc := New(repo)

			_, err := svc.Create(context.Background(), activitiessvc.NewActivity{Title: "Hand-Created Venue", Category: cat})
			if !errors.Is(err, sharederrors.ErrInvalidInput) {
				t.Fatalf("Create() error = %v, want ErrInvalidInput", err)
			}
			if repo.gotCreate.Title != "" {
				t.Error("repo.Create was called, want the request rejected before reaching the repository")
			}
		})
	}
}

func TestActivities_Create_StillAllowsOtherCategories(t *testing.T) {
	repo := &fakeRepo{createOut: activitiessvc.Activity{ID: "1", Category: activitiessvc.CategoryCulture}}
	svc := New(repo)

	if _, err := svc.Create(context.Background(), activitiessvc.NewActivity{Title: "Museum", Category: activitiessvc.CategoryCulture}); err != nil {
		t.Fatalf("Create() error: %v, want culture still allowed", err)
	}
}
