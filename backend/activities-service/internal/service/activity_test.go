package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
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
	// radiusOut is each syncedAtOut entry's stored covered radius, same key.
	// A key absent here defaults to "wide enough for any request" (see
	// radiusFor) — legacy fixtures that only set syncedAtOut, written before
	// T1 (rating-and-anywhere-radius) gave freshness a radius dimension,
	// keep behaving exactly as before; a test exercising radius-narrow
	// reclassification sets this explicitly.
	radiusOut  map[string]float64
	markSynced []string // syncKey(...), in call order
	// markSyncedRadius is the radiusKM MarkSynced was called with, keyed the
	// same way — T1's D3 assertion ("Tripadvisor still records radius_km=8")
	// and any Google radius-write assertion read this.
	markSyncedRadius map[string]float64
}

// radiusFor returns key's fixtured covered radius, or math.MaxFloat64 when
// unset — see radiusOut's own doc.
func (f *fakeRepo) radiusFor(key string) float64 {
	if r, ok := f.radiusOut[key]; ok {
		return r
	}
	return math.MaxFloat64
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

func (f *fakeRepo) SyncedAt(_ context.Context, provider, cellKey, category, subtype string, minRadiusKM float64) (time.Time, bool, error) {
	key := syncKey(provider, cellKey, category, subtype)
	t, ok := f.syncedAtOut[key]
	if !ok || f.radiusFor(key) < minRadiusKM {
		return time.Time{}, false, nil
	}
	return t, true, nil
}

// FreshSyncRows derives its answer from the same syncedAtOut/radiusOut
// fixtures SyncedAt already reads, rather than separate fixture fields, so a
// test only has to set up freshness once regardless of which of the two
// paths (or both) it exercises. category/subtype are recovered from the key
// syncKey built, which only fully round-trips for non-Tripadvisor keys (see
// syncKey) — fine here, since Google is FreshSyncRows' only caller.
func (f *fakeRepo) FreshSyncRows(_ context.Context, provider, cellKey string, since time.Time, minRadiusKM float64) (map[string]bool, error) {
	fresh := make(map[string]bool)
	prefix := provider + "|" + cellKey + "|"
	for key, syncedAt := range f.syncedAtOut {
		if !strings.HasPrefix(key, prefix) || !syncedAt.After(since) || f.radiusFor(key) < minRadiusKM {
			continue
		}
		fresh[strings.TrimPrefix(key, prefix)] = true
	}
	return fresh, nil
}

func (f *fakeRepo) MarkSynced(_ context.Context, provider, cellKey, category, subtype string, radiusKM float64) error {
	f.syncMu.Lock()
	defer f.syncMu.Unlock()
	key := syncKey(provider, cellKey, category, subtype)
	f.markSynced = append(f.markSynced, key)
	if f.markSyncedRadius == nil {
		f.markSyncedRadius = make(map[string]float64)
	}
	f.markSyncedRadius[key] = radiusKM
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
			`{"treatments":[{"item":"Massage"}],"external_booking_note":"book via website"}`, false},
		{"wellness treatments row with legacy duration/price accepted, keys silently dropped", activitiessvc.CategoryWellness,
			`{"treatments":[{"item":"Massage","duration":"60m","price":"$80"}]}`, false},
		{"unknown field on wellness rejected", activitiessvc.CategoryWellness,
			`{"vibe":"chill"}`, true},
		{"unknown category rejected even with empty-ish payload", activitiessvc.Category("bogus"),
			`{"anything":"goes"}`, true},
		{"valid website_url on restaurants accepted", activitiessvc.CategoryRestaurants,
			`{"cuisine":"Italian","website_url":"https://example.com/book"}`, false},
		{"website_url missing scheme rejected", activitiessvc.CategoryRestaurants,
			`{"website_url":"example.com/book"}`, true},
		{"website_url with non-http(s) scheme rejected", activitiessvc.CategoryBars,
			`{"website_url":"ftp://example.com/book"}`, true},
		{"website_url with no host rejected", activitiessvc.CategoryNightlife,
			`{"website_url":"https:///book"}`, true},
		{"website_url on wellness accepted", activitiessvc.CategoryWellness,
			`{"website_url":"https://example.com/visit"}`, false},
		{"website_url on cafes accepted (T1 new category)", activitiessvc.CategoryCafes,
			`{"website_url":"https://example.com/cafe"}`, false},
		{"website_url on cafes rejected when malformed", activitiessvc.CategoryCafes,
			`{"website_url":"not-a-url"}`, true},
		{"website_url on nature accepted (T1 new category)", activitiessvc.CategoryNature,
			`{"website_url":"https://example.com/park"}`, false},
		{"website_url on nature rejected when malformed", activitiessvc.CategoryNature,
			`{"website_url":"not-a-url"}`, true},
		{"website_url on kids accepted (T1 new category)", activitiessvc.CategoryKids,
			`{"website_url":"https://example.com/playground"}`, false},
		{"website_url on kids rejected when malformed", activitiessvc.CategoryKids,
			`{"website_url":"not-a-url"}`, true},
		{"website_url on shopping accepted (T1 new category)", activitiessvc.CategoryShopping,
			`{"website_url":"https://example.com/shop"}`, false},
		{"website_url on shopping rejected when malformed", activitiessvc.CategoryShopping,
			`{"website_url":"not-a-url"}`, true},
		{"website_url on tours_experiences accepted (T1 new category)", activitiessvc.CategoryToursExperiences,
			`{"website_url":"https://example.com/tour"}`, false},
		{"website_url on tours_experiences rejected when malformed", activitiessvc.CategoryToursExperiences,
			`{"website_url":"not-a-url"}`, true},
		{"website_url on sport accepted (already-covered category)", activitiessvc.CategorySport,
			`{"website_url":"https://example.com/gym"}`, false},
		{"valid art year accepted", activitiessvc.CategoryArt,
			`{"artwork":{"artist":"Marina Abramović"},"year":2019}`, false},
		{"art year too low rejected", activitiessvc.CategoryArt,
			`{"year":42}`, true},
		{"art year too far in the future rejected", activitiessvc.CategoryArt,
			`{"year":9999}`, true},
		{"art website_url and year together accepted", activitiessvc.CategoryArt,
			`{"website_url":"https://tickets.example.com/show","year":1935}`, false},
		{"matching tours_experiences shape accepted", activitiessvc.CategoryToursExperiences,
			`{"duration":"2 h 30 min","group_size":"Max 12","languages":"EN, DE","difficulty_level":"Moderate","included":["Guide","Entry fee"],"not_included":["Lunch"],"meeting_point":"Meet at the fountain in the main square, look for the blue umbrella.","itinerary":["Old town square","Riverside walk","Castle viewpoint"]}`, false},
		{"restaurant field on tours_experiences rejected", activitiessvc.CategoryToursExperiences,
			`{"cuisine":"Italian"}`, true},
		{"unknown field on tours_experiences rejected", activitiessvc.CategoryToursExperiences,
			`{"treatments":[{"item":"Massage"}]}`, true},
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

	// website_url is optional everywhere: an absent key must validate for
	// every one of the 13 categories, not just one. activitiessvc.Subcategories
	// is the existing full-category-set source of truth (also used to drive
	// ValidSubcategory), reused here instead of hand-listing 13 categories.
	for cat := range activitiessvc.Subcategories {
		t.Run("website_url absent is valid for "+string(cat), func(t *testing.T) {
			if _, err := ValidateDetails(cat, json.RawMessage(`{}`)); err != nil {
				t.Fatalf("ValidateDetails() unexpected error for category %s: %v", cat, err)
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
// spec's kind-declarations table names (good_to_know[], vibe) plus Nature's
// good_to_know (previously an unhandled default case in
// validateExtraFields). typical_visit, price_from, treatments[].duration/
// price, typical_show_length, and upcoming_shows[].time_or_price no longer
// exist (detail-price-duration-purge T1 stopped collecting them) — there is
// nothing left to guard for those fields.
func TestValidateDetails_ClearsDenylistedFields(t *testing.T) {
	t.Run("wellness treatments row dropped entirely when item is denylisted, other rows kept", func(t *testing.T) {
		raw := `{"treatments":[{"item":"Not specified"},{"item":"Facial"}]}`
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

	t.Run("wellness treatments row dropped entirely when item is whitespace-only, other rows kept (T2 fix)", func(t *testing.T) {
		raw := `{"treatments":[{"item":"   "},{"item":"Facial"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.WellnessDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.Treatments) != 1 {
			t.Fatalf("treatments = %+v, want 1 row (whitespace-only item drops the whole row, same as a denylisted one — a bare denylist check let this through and would have locked the row via isComplete forever)", got.Treatments)
		}
		if got.Treatments[0].Item != "Facial" {
			t.Errorf("treatments[0].item = %q, want %q kept", got.Treatments[0].Item, "Facial")
		}
	})

	t.Run("wellness accepts a legacy treatments row still carrying duration/price keys, silently dropping them", func(t *testing.T) {
		// Treatment (detail-price-duration-purge T1) no longer has
		// Duration/Price fields. A pre-T1 row can still store them (no
		// migration, see T1's acceptance criteria), and fillGaps/an admin's
		// own edit round-trips the whole stored object back through this
		// same validator — stripLegacyDetailFields drops the retired keys
		// before the strict decode so that row isn't rejected forever.
		raw := `{"treatments":[{"item":"Massage","duration":"60m","price":"from €40"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("ValidateDetails() unexpected error: %v (legacy duration/price keys must be dropped, not rejected)", err)
		}
		var got activitiessvc.WellnessDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.Treatments) != 1 || got.Treatments[0].Item != "Massage" {
			t.Errorf("treatments = %+v, want 1 row with item %q kept", got.Treatments, "Massage")
		}
		if !strings.Contains(string(cleaned), `"item":"Massage"`) || strings.Contains(string(cleaned), "duration") || strings.Contains(string(cleaned), "price") {
			t.Errorf("cleaned = %s, want duration/price keys gone", cleaned)
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

	t.Run("entertainment good_to_know cleared", func(t *testing.T) {
		raw := `{"good_to_know":["Doors open early","none"]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryEntertainment, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.EntertainmentDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if want := []string{"Doors open early"}; !slices.Equal(got.GoodToKnow, want) {
			t.Errorf("good_to_know = %v, want %v", got.GoodToKnow, want)
		}
	})

	t.Run("entertainment upcoming_shows[].date cleared per-entry, title-legitimate rows kept", func(t *testing.T) {
		raw := `{"upcoming_shows":[{"date":"not available","title":"Jazz Night"},{"date":"2026-09-01","title":"Comedy Hour"}]}`
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
		if got.UpcomingShows[0].Date != "" {
			t.Errorf("upcoming_shows[0].date = %q, want cleared", got.UpcomingShows[0].Date)
		}
		if got.UpcomingShows[0].Title != "Jazz Night" {
			t.Errorf("upcoming_shows[0].title = %q, want unchanged", got.UpcomingShows[0].Title)
		}
		if got.UpcomingShows[1].Date != "2026-09-01" {
			t.Errorf("upcoming_shows[1] changed unexpectedly: %+v", got.UpcomingShows[1])
		}
	})

	t.Run("entertainment upcoming_shows row dropped entirely when title is denylisted, other rows kept", func(t *testing.T) {
		raw := `{"upcoming_shows":[{"date":"2026-09-01","title":"N/A"},{"date":"2026-09-02","title":"Comedy Hour"}]}`
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

	t.Run("entertainment upcoming_shows row dropped entirely when title is whitespace-only, other rows kept (T2 fix)", func(t *testing.T) {
		raw := `{"upcoming_shows":[{"date":"2026-09-01","title":"   "},{"date":"2026-09-02","title":"Comedy Hour"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryEntertainment, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.EntertainmentDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.UpcomingShows) != 1 {
			t.Fatalf("upcoming_shows = %+v, want 1 row (whitespace-only title drops the whole row, same as a denylisted one)", got.UpcomingShows)
		}
		if got.UpcomingShows[0].Title != "Comedy Hour" {
			t.Errorf("upcoming_shows[0].title = %q, want %q kept", got.UpcomingShows[0].Title, "Comedy Hour")
		}
	})

	t.Run("entertainment accepts a legacy upcoming_shows row still carrying time_or_price, silently dropping it", func(t *testing.T) {
		// Show (detail-price-duration-purge T1) no longer has a TimeOrPrice
		// field — same drop-not-reject guard as the wellness Treatment case
		// above.
		raw := `{"upcoming_shows":[{"date":"2026-09-01","title":"Comedy Hour","time_or_price":"from $20"}]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryEntertainment, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("ValidateDetails() unexpected error: %v (legacy time_or_price key must be dropped, not rejected)", err)
		}
		var got activitiessvc.EntertainmentDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if len(got.UpcomingShows) != 1 || got.UpcomingShows[0].Title != "Comedy Hour" {
			t.Errorf("upcoming_shows = %+v, want 1 row with title %q kept", got.UpcomingShows, "Comedy Hour")
		}
		if strings.Contains(string(cleaned), "time_or_price") {
			t.Errorf("cleaned = %s, want time_or_price key gone", cleaned)
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
		_, err := ValidateDetails(activitiessvc.CategoryWellness, json.RawMessage(`{"good_to_know":["not specified"],"website_url":"https://example.com"}`))
		if err != nil {
			t.Fatalf("ValidateDetails() unexpected error: %v (a denylist match must clear the field, not fail the request)", err)
		}
	})

	t.Run("sport effort_level, gear, what_to_bring cleared, difficulty untouched", func(t *testing.T) {
		raw := `{"effort_level":"Unknown","gear":"none","what_to_bring":["Water bottle","Not specified"],"difficulty":3}`
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
		raw := `{"effort_level":"Moderate","gear":"Helmet provided","what_to_bring":["Comfortable shoes"]}`
		cleaned, err := ValidateDetails(activitiessvc.CategorySport, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.SportDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.EffortLevel != "Moderate" || got.Gear != "Helmet provided" {
			t.Errorf("got %+v, want values unchanged", got)
		}
		if want := []string{"Comfortable shoes"}; !slices.Equal(got.WhatToBring, want) {
			t.Errorf("what_to_bring = %v, want %v", got.WhatToBring, want)
		}
	})

	t.Run("sport accepts a legacy payload still carrying duration, silently dropping it", func(t *testing.T) {
		// SportDetails (detail-price-duration-purge T1) no longer has a
		// Duration field — same drop-not-reject guard as wellness/entertainment
		// above.
		raw := `{"duration":"2 hours","effort_level":"Moderate"}`
		cleaned, err := ValidateDetails(activitiessvc.CategorySport, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("ValidateDetails() unexpected error: %v (legacy duration key must be dropped, not rejected)", err)
		}
		var got activitiessvc.SportDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.EffortLevel != "Moderate" {
			t.Errorf("effort_level = %q, want unchanged", got.EffortLevel)
		}
		if strings.Contains(string(cleaned), "duration") {
			t.Errorf("cleaned = %s, want duration key gone", cleaned)
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

	// Tours & Experiences (T2): no provider populates these fields yet, but
	// the kind guard is wired ahead of that integration — these subtests
	// cover both halves it adds over every other category: denylist
	// clearing (shared with everyone else) and, new in this task, the
	// `scalar`/`phrase` shape check itself (clearInvalidScalar/
	// dropInvalidPhrases), which no other category's fields are guarded by.
	t.Run("tours_experiences scalar fields cleared for every denylist entry", func(t *testing.T) {
		for _, entry := range contentkind.Denylist() {
			raw := fmt.Sprintf(`{"duration":%q,"group_size":%q,"languages":%q,"difficulty_level":%q}`, entry, entry, entry, entry)
			cleaned, err := ValidateDetails(activitiessvc.CategoryToursExperiences, json.RawMessage(raw))
			if err != nil {
				t.Fatalf("entry %q: unexpected error: %v", entry, err)
			}
			var got activitiessvc.ToursExperiencesDetails
			if err := json.Unmarshal(cleaned, &got); err != nil {
				t.Fatalf("entry %q: unmarshaling: %v", entry, err)
			}
			if got.Duration != "" || got.GroupSize != "" || got.Languages != "" || got.DifficultyLevel != "" {
				t.Errorf("entry %q: got %+v, want every scalar field cleared", entry, got)
			}
		}
	})

	t.Run("tours_experiences scalar fields cleared when they violate the scalar shape, not just the denylist", func(t *testing.T) {
		raw := `{"duration":"Approximately two and a half hours total","group_size":"Max 12.","languages":"EN, DE"}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryToursExperiences, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.ToursExperiencesDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.Duration != "" {
			t.Errorf("duration = %q, want cleared (40 chars, exceeds ScalarMaxChars)", got.Duration)
		}
		if got.GroupSize != "" {
			t.Errorf("group_size = %q, want cleared (terminal punctuation)", got.GroupSize)
		}
		if got.Languages != "EN, DE" {
			t.Errorf("languages = %q, want unchanged (legitimate spec example)", got.Languages)
		}
	})

	t.Run("tours_experiences included/not_included/itinerary drop entries that are denylisted or violate the phrase shape, keep the rest", func(t *testing.T) {
		// T11: "Gratuities." (a short phrase ending in a period) is now kept
		// — IsValidPhrase strips one trailing terminal-punctuation char for
		// the length check only, matching fieldKind.ts's T9-round-3 fix. The
		// over-length item still drops even though it too ends without
		// punctuation (already over PhraseMaxChars before any stripping).
		raw := `{"included":["Professional guide","Not specified","A description so long it clearly exceeds the eighty character phrase limit for a checklist item"],"not_included":["Lunch","Gratuities."],"itinerary":["Old town square","N/A"]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryToursExperiences, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.ToursExperiencesDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if want := []string{"Professional guide"}; !slices.Equal(got.Included, want) {
			t.Errorf("included = %v, want %v (denylisted + over-length dropped)", got.Included, want)
		}
		if want := []string{"Lunch", "Gratuities."}; !slices.Equal(got.NotIncluded, want) {
			t.Errorf("not_included = %v, want %v (short phrase ending in a period is kept, punctuation intact)", got.NotIncluded, want)
		}
		if want := []string{"Old town square"}; !slices.Equal(got.Itinerary, want) {
			t.Errorf("itinerary = %v, want %v (denylisted dropped)", got.Itinerary, want)
		}
	})

	t.Run("tours_experiences meeting_point cleared on denylist but not on length, since prose has no length-based rejection", func(t *testing.T) {
		cleaned, err := ValidateDetails(activitiessvc.CategoryToursExperiences, json.RawMessage(`{"meeting_point":"Not specified"}`))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.ToursExperiencesDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.MeetingPoint != "" {
			t.Errorf("meeting_point = %q, want cleared (denylisted)", got.MeetingPoint)
		}

		longButLegit := strings.Repeat("Meet your guide by the fountain in the main square. ", 6) // well over 280 chars
		cleaned, err = ValidateDetails(activitiessvc.CategoryToursExperiences, json.RawMessage(fmt.Sprintf(`{"meeting_point":%q}`, longButLegit)))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.MeetingPoint != longButLegit {
			t.Errorf("meeting_point over 280 chars was cleared/changed, want unchanged (prose has no length-based rejection, per contentkind.ProseMaxChars' doc — it's a UI clamp threshold, not a rejection limit)")
		}
	})

	t.Run("tours_experiences fully legitimate payload passes unchanged", func(t *testing.T) {
		raw := `{"duration":"2 h 30 min","group_size":"Max 12","languages":"EN, DE","difficulty_level":"Moderate","included":["Guide","Entry fee"],"not_included":["Lunch"],"meeting_point":"Meet at the fountain in the main square.","itinerary":["Old town square","Riverside walk"]}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryToursExperiences, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.ToursExperiencesDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.Duration != "2 h 30 min" || got.GroupSize != "Max 12" || got.Languages != "EN, DE" || got.DifficultyLevel != "Moderate" {
			t.Errorf("scalar fields changed unexpectedly: %+v", got)
		}
		if want := []string{"Guide", "Entry fee"}; !slices.Equal(got.Included, want) {
			t.Errorf("included = %v, want unchanged %v", got.Included, want)
		}
		if want := []string{"Lunch"}; !slices.Equal(got.NotIncluded, want) {
			t.Errorf("not_included = %v, want unchanged %v", got.NotIncluded, want)
		}
		if want := []string{"Old town square", "Riverside walk"}; !slices.Equal(got.Itinerary, want) {
			t.Errorf("itinerary = %v, want unchanged %v", got.Itinerary, want)
		}
		if got.MeetingPoint != "Meet at the fountain in the main square." {
			t.Errorf("meeting_point = %q, want unchanged", got.MeetingPoint)
		}
	})

	t.Run("tours_experiences whitespace-only values are cleared/dropped like empty ones", func(t *testing.T) {
		raw := `{"duration":"   ","group_size":"\t","included":["  ",""],"itinerary":[""],"meeting_point":"  "}`
		cleaned, err := ValidateDetails(activitiessvc.CategoryToursExperiences, json.RawMessage(raw))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var got activitiessvc.ToursExperiencesDetails
		if err := json.Unmarshal(cleaned, &got); err != nil {
			t.Fatalf("unmarshaling: %v", err)
		}
		if got.Duration != "" {
			t.Errorf("duration = %q, want cleared (whitespace-only)", got.Duration)
		}
		if got.GroupSize != "" {
			t.Errorf("group_size = %q, want cleared (whitespace-only)", got.GroupSize)
		}
		if len(got.Included) != 0 {
			t.Errorf("included = %v, want all entries dropped (whitespace-only/empty)", got.Included)
		}
		if len(got.Itinerary) != 0 {
			t.Errorf("itinerary = %v, want entry dropped (empty)", got.Itinerary)
		}
		if got.MeetingPoint != "" {
			t.Errorf("meeting_point = %q, want cleared (whitespace-only)", got.MeetingPoint)
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
	// Wellness is used here — good_to_know is Wellness' surviving
	// denylist-guarded free-text field (detail-price-duration-purge T1
	// dropped typical_visit/price_from, the fields the original production
	// bug report named, from the schema entirely).
	t.Run("denylisted good_to_know entry is dropped before reaching the repo, write still succeeds", func(t *testing.T) {
		repo := &fakeRepo{}
		svc := New(repo)
		_, err := svc.Create(context.Background(), activitiessvc.NewActivity{
			Title: "New Spa", Category: activitiessvc.CategoryWellness,
			Details: json.RawMessage(`{"good_to_know":["Nije navedeno"]}`),
		})
		if err != nil {
			t.Fatalf("Create() unexpected error: %v", err)
		}
		var got activitiessvc.WellnessDetails
		if err := json.Unmarshal(repo.gotCreate.Details, &got); err != nil {
			t.Fatalf("unmarshaling repo-received details: %v", err)
		}
		if len(got.GoodToKnow) != 0 {
			t.Errorf("repo received good_to_know = %v, want cleared", got.GoodToKnow)
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

// TestSubtypeFromPriceLevel pins the price tier. The Cheap Eats case is the
// load-bearing one: "Cheap Eats" is a price band, while fast_casual and
// casual_dining differ by service format, which the band does not report. A
// future change that makes it return a slug has re-introduced exactly the
// guess this function exists to refuse.
func TestSubtypeFromPriceLevel(t *testing.T) {
	tests := []struct {
		name  string
		cat   activitiessvc.Category
		price string
		want  string
	}{
		{"fine dining is the same concept under the same name", activitiessvc.CategoryRestaurants, "Fine Dining", "fine_dining"},
		{"mid range is a sit-down mid-priced venue", activitiessvc.CategoryRestaurants, "Mid Range", "casual_dining"},
		{"cheap eats is deliberately unclassified", activitiessvc.CategoryRestaurants, "Cheap Eats", ""},
		{"absent price yields nothing", activitiessvc.CategoryRestaurants, "", ""},
		{"unknown value yields nothing", activitiessvc.CategoryRestaurants, "$$$$", ""},

		// Restaurants-only: Bars and Cafés carry a price_level too, but their
		// subtypes are not price-shaped.
		{"bars get no tier", activitiessvc.CategoryBars, "Mid Range", ""},
		{"cafes get no tier", activitiessvc.CategoryCafes, "Fine Dining", ""},
		{"nightlife gets no tier", activitiessvc.CategoryNightlife, "Mid Range", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SubtypeFromPriceLevel(tt.cat, tt.price); got != tt.want {
				t.Errorf("SubtypeFromPriceLevel(%q, %q) = %q, want %q", tt.cat, tt.price, got, tt.want)
			}
		})
	}
}

// TestSubtypeFromPriceLevel_OnlyValidSlugs guards against a typo producing a
// slug the rest of the system would reject at write time.
func TestSubtypeFromPriceLevel_OnlyValidSlugs(t *testing.T) {
	for _, p := range []string{"Fine Dining", "Mid Range", "Cheap Eats", "", "nonsense"} {
		got := SubtypeFromPriceLevel(activitiessvc.CategoryRestaurants, p)
		if !activitiessvc.ValidSubcategory(activitiessvc.CategoryRestaurants, got) {
			t.Errorf("SubtypeFromPriceLevel(restaurants, %q) returned %q, not a valid Restaurants subcategory", p, got)
		}
	}
}

// TestResolveTripadvisorSubtype_PriceIsLastResort pins the precedence chain.
// Price must never outrank a Google type or a name keyword — it only fills
// what both left empty.
func TestResolveTripadvisorSubtype_PriceIsLastResort(t *testing.T) {
	// No Places client configured, so Google always yields nothing and the
	// name/price precedence is what is under test.
	svc := New(nil)

	tests := []struct {
		name  string
		cat   activitiessvc.Category
		venue string
		price string
		want  string
	}{
		{"price fills what nothing else knows", activitiessvc.CategoryRestaurants, "Restoran Da Giorgio", "Mid Range", "casual_dining"},
		{"fine dining tier", activitiessvc.CategoryRestaurants, "Nekakav Restoran", "Fine Dining", "fine_dining"},
		{"cheap eats alone yields nothing", activitiessvc.CategoryRestaurants, "Casual Pizza", "Cheap Eats", ""},
		{"no price, no name, nothing", activitiessvc.CategoryRestaurants, "Splav restoran Veso", "", ""},
		{"bars ignore price entirely", activitiessvc.CategoryBars, "Neki Bar", "Mid Range", ""},

		// Cuisine words must NOT imply a service format. A burger place in
		// Belgrade is an ordinary sit-down restaurant, so these take the price
		// tier — never fast_casual. A change that makes either return
		// fast_casual has re-introduced the inference spec D4 rejects.
		{"burger name does not imply fast_casual", activitiessvc.CategoryRestaurants, "Burger Bar", "Mid Range", "casual_dining"},
		{"cevap name does not imply fast_casual", activitiessvc.CategoryRestaurants, "Ćevap Kuća", "Cheap Eats", ""},
		{"pekara name does not imply bakery_dessert", activitiessvc.CategoryRestaurants, "Pekara Trpkovic", "", ""},

		// The load-bearing negative from the design spec: Cheap Eats plus a
		// Google type that resolves to nothing (namemap.Subtype has no
		// Restaurants rule — D4) must still yield "", never a guessed slug.
		{"cheap eats plus an unresolved google type stays empty", activitiessvc.CategoryRestaurants, "Restoran Kod Marka", "Cheap Eats", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, placeID := svc.ResolveTripadvisorSubtype(context.Background(), tt.cat, tt.venue, 44.8, 20.4, "loc-1", tt.price)
			if got != tt.want {
				t.Errorf("ResolveTripadvisorSubtype(%q, price=%q) = %q, want %q", tt.venue, tt.price, got, tt.want)
			}
			if placeID != "" {
				t.Errorf("place id = %q, want empty when no Places client is configured", placeID)
			}
		})
	}
}

// TestResolveTripadvisorSubtype_Idempotent: the backfill rewrites rows, so
// the same inputs must always produce the same subtype.
func TestResolveTripadvisorSubtype_Idempotent(t *testing.T) {
	svc := New(nil)
	first, _ := svc.ResolveTripadvisorSubtype(context.Background(), activitiessvc.CategoryRestaurants, "Restoran Da Giorgio", 44.8, 20.4, "loc-1", "Mid Range")
	second, _ := svc.ResolveTripadvisorSubtype(context.Background(), activitiessvc.CategoryRestaurants, "Restoran Da Giorgio", 44.8, 20.4, "loc-1", "Mid Range")
	if first != second {
		t.Errorf("not idempotent: %q then %q", first, second)
	}
	if first != "casual_dining" {
		t.Errorf("got %q, want casual_dining", first)
	}
}
