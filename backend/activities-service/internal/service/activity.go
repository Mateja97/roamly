// Package service holds activities-service's business logic: input
// validation and scope/filter resolution. It passes sentinel errors through
// untouched (wrapped with context), never swallowing or replacing them —
// see GO_STANDARDS.md "Errors".
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"activities-service/internal/places"
	"activities-service/internal/placesmap"
	"activities-service/internal/tripadvisor"
	"activities-service/internal/tripadvisormap"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
)

type repository interface {
	Query(ctx context.Context, filter activitiessvc.QueryFilter) ([]activitiessvc.Activity, error)
	SuggestCities(ctx context.Context, prefix string) ([]activitiessvc.CitySuggestion, error)
	AdminDistinctCities(ctx context.Context) ([]string, error)
	List(ctx context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error)
	GetByID(ctx context.Context, id string) (activitiessvc.Activity, error)
	Create(ctx context.Context, in activitiessvc.NewActivity) (activitiessvc.Activity, error)
	Update(ctx context.Context, id string, patch activitiessvc.UpdatePatch) (activitiessvc.Activity, error)
	// Upsert inserts or updates an ingested activity, keyed on
	// (source_url, category) — T4's Restaurants/Cafés/Bars lazy sync (see
	// syncTripadvisorAnchor) reuses the same upsert the batch Google
	// pipeline already relies on. Each source_url now maps to exactly one
	// category, decided by tripadvisormap.Category before Upsert is called.
	Upsert(ctx context.Context, in activitiessvc.IngestActivity) (activitiessvc.Activity, error)
	// SyncedAt reports the last successful sync time for
	// (provider, cellKey, category, subtype), and whether one has happened.
	SyncedAt(ctx context.Context, provider, cellKey, category, subtype string) (time.Time, bool, error)
	// FreshSyncRows returns every (category, subtype) pair for (provider,
	// cellKey) synced more recently than since, keyed category+"|"+subtype —
	// see googleDueRows' use of it for why this replaced ~53 SyncedAt calls
	// per cell with one query.
	FreshSyncRows(ctx context.Context, provider, cellKey string, since time.Time) (map[string]bool, error)
	// MarkSynced records a fresh sync for (provider, cellKey, category, subtype).
	MarkSynced(ctx context.Context, provider, cellKey, category, subtype string) error
}

// Sync providers, the first column of sync_regions. Adding a tours provider
// later means a new constant here and its own syncXIfNeeded — not a schema
// change.
//
// Not to be confused with activities.source, a different namespace with
// different values: a Google-discovered row has provider "google" in
// sync_regions but source "google_places" in activities (the value the
// existing catalog and GetPhotos' provider branch already use).
const (
	ProviderTripadvisor = "tripadvisor"
	ProviderGoogle      = "google"
)

// placesClient is the subset of internal/places.Client the service layer
// needs: GetPhotos uses ResolvePhotos; GetByID's live-merge (T2,
// places-live-details) uses PlaceDetails. Optional (see WithPlaces) — a
// server with none configured, or with GOOGLE_MAPS_API_KEY unset, still
// serves stored data, it just never resolves anything live.
type placesClient interface {
	ResolvePhotos(ctx context.Context, placeID string, limit int) ([]activitiessvc.Photo, error)
	// PlaceDetails fetches live Place Details for one placeID — the data
	// source for GetByID's live merge (see withLiveDetails).
	PlaceDetails(ctx context.Context, placeID string) (placesmap.PlaceDetail, error)
	// SearchNearby is the type-driven discovery call: one per (cell,
	// category, subtype) row, circle-restricted, max 20 results.
	SearchNearby(ctx context.Context, req places.NearbyRequest, fieldMask string) ([]placesmap.Place, error)
	// SearchTextInArea is the phrase fallback for discovery rows whose
	// subtype has no Table A type. Without it those subtypes would never
	// populate from the lazy sync at all.
	SearchTextInArea(ctx context.Context, query string, lat, lng, radiusKM float64, fieldMask string) ([]placesmap.Place, error)
	// ReverseGeocodeCity resolves a sync cell's anchor to a stable English
	// city/country once per cell — see syncGoogleIfNeeded and
	// places.Client.ReverseGeocodeCity for why this replaced per-venue
	// derivation from addressComponents.
	ReverseGeocodeCity(ctx context.Context, lat, lng float64) (city, country string, err error)
}

// tripadvisorClient is the subset of internal/tripadvisor.Client the
// service layer needs: GetPhotos uses LocationPhotos; the lazy
// Restaurants/Cafés/Bars sync (below) uses the other three. Optional (see
// WithTripadvisor) — a server with none configured never triggers a live
// sync and GetPhotos falls back to whatever's already cached.
type tripadvisorClient interface {
	LocationPhotos(ctx context.Context, locationID string, limit int) ([]activitiessvc.Photo, error)
	NearbySearch(ctx context.Context, lat, lng, radiusKM float64, category string) ([]tripadvisor.LocationSummary, error)
	LocationDetails(ctx context.Context, locationID string) (tripadvisor.LocationDetails, error)
	LocationReviews(ctx context.Context, locationID string) ([]tripadvisor.Review, error)
}

// Request is the pre-validation shape of a query: MaxDistanceKM is the
// caller's raw filter value (0 = not set). ScopeNearby ignores it entirely
// (fixed NearbyRadiusKM); ScopeAnywhere passes it through uncapped.
type Request struct {
	Scope           activitiessvc.Scope
	CurrentLocation *activitiessvc.Point
	// Cities is ScopeAnywhere-only: resolved city centroids to anchor the
	// distance filter on instead of (and taking priority over)
	// CurrentLocation.
	Cities     []activitiessvc.Point
	Categories []activitiessvc.Category
	// Subcategories (T1) narrows results to any of these subtype slugs (OR),
	// AND-ed with Categories. Not validated against Subcategories here — an
	// unrecognized slug simply matches nothing, the same way an unrecognized
	// value would on any other filter with no enum behind it.
	Subcategories []string
	MinRating     float64
	MaxDistanceKM float64
}

// NearbyRadiusKM is the fixed, non-adjustable radius for ScopeNearby
// (T2): any client-supplied MaxDistanceKM is ignored for this scope.
const NearbyRadiusKM = 10

type Activities struct {
	repo        repository
	places      placesClient
	tripadvisor tripadvisorClient
	// syncTimeout bounds one Tripadvisor anchor sweep. A field rather than
	// a direct tripadvisorSyncTimeout read only so tests can shrink it to
	// exercise deadline truncation without waiting out the real value.
	syncTimeout time.Duration
	// googleSync tracks in-flight background discovery passes. Production
	// never waits on it — it exists so tests can join the goroutine instead
	// of sleeping (see waitForGoogleSync).
	googleSync sync.WaitGroup
}

func New(repo repository) *Activities {
	return &Activities{repo: repo, syncTimeout: tripadvisorSyncTimeout}
}

// WithPlaces attaches a live Places client for GetPhotos' on-demand
// resolve-on-first-view path (T2). Optional: without it (nil, the
// zero-value default), GetPhotos always returns the stored photo set with
// no Google call — the same fallback behavior a configured client falls
// back to on error/timeout. Returns itself so call sites can chain it onto New.
func (a *Activities) WithPlaces(p placesClient) *Activities {
	a.places = p
	return a
}

// waitForGoogleSync blocks until every in-flight background discovery pass
// finishes. Test-only: production deliberately never waits.
func (a *Activities) waitForGoogleSync() { a.googleSync.Wait() }

// WithTripadvisor attaches a live Tripadvisor client for the
// Restaurants/Bars lazy sync and GetPhotos' Tripadvisor-sourced resolve
// path. Optional, same nil-safe contract as WithPlaces.
func (a *Activities) WithTripadvisor(t tripadvisorClient) *Activities {
	a.tripadvisor = t
	return a
}

func (a *Activities) Query(ctx context.Context, req Request) ([]activitiessvc.Activity, error) {
	filter, err := a.resolve(req)
	if err != nil {
		return nil, fmt.Errorf("resolving query: %w", err)
	}

	a.syncTripadvisorIfNeeded(ctx, req)
	a.syncGoogleIfNeeded(ctx, req)

	activities, err := a.repo.Query(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("querying activities: %w", err)
	}
	return activities, nil
}

// SuggestCities returns catalog city matches for a typeahead query. An
// empty (after trimming) query returns an empty, non-nil list rather than
// hitting the database — a blank prefix matches everything, which is never
// a useful suggestion set for a typeahead.
func (a *Activities) SuggestCities(ctx context.Context, query string) ([]activitiessvc.CitySuggestion, error) {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return []activitiessvc.CitySuggestion{}, nil
	}
	suggestions, err := a.repo.SuggestCities(ctx, trimmed)
	if err != nil {
		return nil, fmt.Errorf("suggesting cities: %w", err)
	}
	return suggestions, nil
}

// AdminListCities returns every distinct city across the whole catalog
// (T2) — no published-only restriction and no prefix filter, unlike
// SuggestCities, since it backs a dropdown of every filterable value.
func (a *Activities) AdminListCities(ctx context.Context) ([]string, error) {
	cities, err := a.repo.AdminDistinctCities(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing admin cities: %w", err)
	}
	return cities, nil
}

func (a *Activities) resolve(req Request) (activitiessvc.QueryFilter, error) {
	switch req.Scope {
	case activitiessvc.ScopeNearby, activitiessvc.ScopeAnywhere:
	default:
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: unknown scope %q", sharederrors.ErrInvalidInput, req.Scope)
	}

	if req.MaxDistanceKM < 0 {
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: max_distance_km must not be negative", sharederrors.ErrInvalidInput)
	}

	filter := activitiessvc.QueryFilter{
		Scope:         req.Scope,
		Categories:    req.Categories,
		Subcategories: req.Subcategories,
		MinRating:     req.MinRating,
	}

	switch req.Scope {
	case activitiessvc.ScopeNearby:
		if err := validatePoint(req.CurrentLocation); err != nil {
			return activitiessvc.QueryFilter{}, fmt.Errorf("%w: current_location %s", sharederrors.ErrInvalidInput, err)
		}
		filter.CurrentLocation = req.CurrentLocation
		filter.MaxDistanceKM = NearbyRadiusKM // fixed range, req.MaxDistanceKM ignored

	case activitiessvc.ScopeAnywhere:
		// current_location is optional: device location denied/unavailable
		// still yields broad, distance-unfiltered results.
		if req.CurrentLocation != nil {
			if err := validatePoint(req.CurrentLocation); err != nil {
				return activitiessvc.QueryFilter{}, fmt.Errorf("%w: current_location %s", sharederrors.ErrInvalidInput, err)
			}
			filter.CurrentLocation = req.CurrentLocation
		}
		for _, c := range req.Cities {
			if err := validatePoint(&c); err != nil {
				return activitiessvc.QueryFilter{}, fmt.Errorf("%w: cities %s", sharederrors.ErrInvalidInput, err)
			}
		}
		filter.Cities = req.Cities
		if req.MaxDistanceKM > 0 {
			if req.CurrentLocation == nil && len(req.Cities) == 0 {
				return activitiessvc.QueryFilter{}, fmt.Errorf("%w: current_location or cities is required when max_distance_km is set for scope anywhere", sharederrors.ErrInvalidInput)
			}
			// Unlike ScopeNearby's fixed NearbyRadiusKM, anywhere has no
			// default radius to cap against, so any positive value passes
			// straight through as the requested distance.
			filter.MaxDistanceKM = req.MaxDistanceKM
		}
	}

	for _, c := range req.Categories {
		if !validCategory(c) {
			return activitiessvc.QueryFilter{}, fmt.Errorf("%w: unknown category %q", sharederrors.ErrInvalidInput, c)
		}
	}
	if req.MinRating < 0 || req.MinRating > 5 {
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: min_rating must be between 0 and 5", sharederrors.ErrInvalidInput)
	}

	return filter, nil
}

func validatePoint(p *activitiessvc.Point) error {
	if p == nil {
		return fmt.Errorf("is required")
	}
	if p.Lat < -90 || p.Lat > 90 {
		return fmt.Errorf("lat %v out of range [-90,90]", p.Lat)
	}
	if p.Lng < -180 || p.Lng > 180 {
		return fmt.Errorf("lng %v out of range [-180,180]", p.Lng)
	}
	return nil
}

// ValidateDetails rejects a details payload whose fields don't match its
// category's shape (T2), e.g. `cuisine` set on a CategorySport row. An
// empty payload ("" or "{}") is always valid regardless of category — a
// category with no detail data yet is the common case, not an error.
// Called from Create and Update (below) — the write path this validator
// was written ahead of in T1.
func ValidateDetails(category activitiessvc.Category, details json.RawMessage) error {
	if len(bytes.TrimSpace(details)) == 0 {
		return nil
	}
	target, err := detailsTarget(category)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(details))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return fmt.Errorf("%w: details do not match category %q: %s", sharederrors.ErrInvalidInput, category, err)
	}
	return validateExtraFields(target)
}

// validateExtraFields runs semantic checks the strict decode above can't
// express structurally: action_url (T7, 8 categories) must be an absolute
// http(s) URL, Art's year must be a plausible 4-digit year, and opening_hours
// (T1, the 7 categories that already show an hours chip) must be a
// well-formed weekly schedule.
func validateExtraFields(target any) error {
	switch t := target.(type) {
	case *activitiessvc.RestaurantDetails:
		if err := validateActionURL(t.ActionURL); err != nil {
			return err
		}
		return validateOpeningHours(t.OpeningHours)
	case *activitiessvc.BarDetails:
		if err := validateActionURL(t.ActionURL); err != nil {
			return err
		}
		return validateOpeningHours(t.OpeningHours)
	case *activitiessvc.CafeDetails:
		return validateOpeningHours(t.OpeningHours)
	case *activitiessvc.NightlifeDetails:
		if err := validateActionURL(t.ActionURL); err != nil {
			return err
		}
		return validateOpeningHours(t.OpeningHours)
	case *activitiessvc.SportDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.CultureDetails:
		if err := validateActionURL(t.ActionURL); err != nil {
			return err
		}
		return validateOpeningHours(t.OpeningHours)
	case *activitiessvc.ArtDetails:
		if err := validateActionURL(t.ActionURL); err != nil {
			return err
		}
		if err := validateYear(t.Year); err != nil {
			return err
		}
		return validateOpeningHours(t.OpeningHours)
	case *activitiessvc.WellnessDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.EntertainmentDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.ShoppingDetails:
		return validateOpeningHours(t.OpeningHours)
	default:
		return nil
	}
}

// validateActionURL rejects a non-nil action_url that isn't an absolute
// http(s) URL. A nil value (field absent) is always valid.
func validateActionURL(raw *string) error {
	if raw == nil {
		return nil
	}
	u, err := url.Parse(*raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("%w: action_url %q is not an absolute http(s) URL", sharederrors.ErrInvalidInput, *raw)
	}
	return nil
}

// validateYear rejects a non-nil year outside a plausible 4-digit range. A
// nil value (field absent) is always valid.
func validateYear(year *int) error {
	if year == nil {
		return nil
	}
	if *year < 1000 || *year > time.Now().Year()+1 {
		return fmt.Errorf("%w: year %d is not a plausible year", sharederrors.ErrInvalidInput, *year)
	}
	return nil
}

// validateOpeningHours rejects a non-nil OpeningHours whose timezone isn't a
// valid IANA zone, whose periods contain an invalid day-of-week or a time
// not in 24h "HH:MM" form, or that has always_open false with no periods at
// all (nothing would tell a caller when the venue is open). A nil value
// (field absent) is always valid. A period's close time earlier than its
// open time is not rejected — see Period's doc, it means the window rolls
// past midnight.
func validateOpeningHours(oh *activitiessvc.OpeningHours) error {
	if oh == nil {
		return nil
	}
	// "Local" is time.LoadLocation's sentinel for the system's local zone,
	// not a real IANA name, and LoadLocation("") silently succeeds as UTC —
	// both must be rejected explicitly rather than let through as valid.
	if oh.Timezone == "" || strings.EqualFold(oh.Timezone, "Local") {
		return fmt.Errorf("%w: opening_hours.timezone %q is not a valid IANA zone", sharederrors.ErrInvalidInput, oh.Timezone)
	}
	if _, err := time.LoadLocation(oh.Timezone); err != nil {
		return fmt.Errorf("%w: opening_hours.timezone %q is not a valid IANA zone", sharederrors.ErrInvalidInput, oh.Timezone)
	}
	if !oh.AlwaysOpen && len(oh.Periods) == 0 {
		return fmt.Errorf("%w: opening_hours.periods must not be empty when always_open is false", sharederrors.ErrInvalidInput)
	}
	for i, p := range oh.Periods {
		if !validDayOfWeek(p.Day) {
			return fmt.Errorf("%w: opening_hours.periods[%d].day %q is not a valid day of week", sharederrors.ErrInvalidInput, i, p.Day)
		}
		if !isHHMM(p.Open) {
			return fmt.Errorf("%w: opening_hours.periods[%d].open %q is not in 24h HH:MM form", sharederrors.ErrInvalidInput, i, p.Open)
		}
		if !isHHMM(p.Close) {
			return fmt.Errorf("%w: opening_hours.periods[%d].close %q is not in 24h HH:MM form", sharederrors.ErrInvalidInput, i, p.Close)
		}
	}
	return nil
}

// isHHMM reports whether s is a strict zero-padded 24h "HH:MM" time.
// time.Parse("15:04", s) alone accepts non-padded hours like "9:00", so the
// length is checked first to reject those before parsing catches out-of-range
// values (hour > 23, minute > 59).
func isHHMM(s string) bool {
	if len(s) != 5 {
		return false
	}
	_, err := time.Parse("15:04", s)
	return err == nil
}

func validDayOfWeek(d activitiessvc.DayOfWeek) bool {
	switch d {
	case activitiessvc.Monday, activitiessvc.Tuesday, activitiessvc.Wednesday, activitiessvc.Thursday,
		activitiessvc.Friday, activitiessvc.Saturday, activitiessvc.Sunday:
		return true
	}
	return false
}

// detailsTarget returns a fresh, addressable instance of category's detail
// struct for ValidateDetails to strict-decode into. One switch arm per
// category from APP_STANDARDS.md's per-category table.
func detailsTarget(category activitiessvc.Category) (any, error) {
	switch category {
	case activitiessvc.CategoryRestaurants:
		return &activitiessvc.RestaurantDetails{}, nil
	case activitiessvc.CategoryBars:
		return &activitiessvc.BarDetails{}, nil
	case activitiessvc.CategoryCafes:
		return &activitiessvc.CafeDetails{}, nil
	case activitiessvc.CategoryNightlife:
		return &activitiessvc.NightlifeDetails{}, nil
	case activitiessvc.CategoryNature:
		return &activitiessvc.NatureDetails{}, nil
	case activitiessvc.CategorySport:
		return &activitiessvc.SportDetails{}, nil
	case activitiessvc.CategoryKids:
		return &activitiessvc.KidsDetails{}, nil
	case activitiessvc.CategoryCulture:
		return &activitiessvc.CultureDetails{}, nil
	case activitiessvc.CategoryArt:
		return &activitiessvc.ArtDetails{}, nil
	case activitiessvc.CategoryWellness:
		return &activitiessvc.WellnessDetails{}, nil
	case activitiessvc.CategoryEntertainment:
		return &activitiessvc.EntertainmentDetails{}, nil
	case activitiessvc.CategoryShopping:
		return &activitiessvc.ShoppingDetails{}, nil
	default:
		return nil, fmt.Errorf("%w: unknown category %q", sharederrors.ErrInvalidInput, category)
	}
}

// DefaultListPageSize and MaxListPageSize bound ListActivities' page_size
// (T2): a caller-supplied page_size is always clamped to this range, never
// trusted as-is — an unbounded page_size would let a caller force a
// full-table load.
const (
	DefaultListPageSize = 20
	MaxListPageSize     = 100
)

// ListRequest is the admin list's caller-supplied query (T2), pre-clamp:
// Page/PageSize are the raw requested values (<= 0 meaning "use the
// default"). "" means "no filter" for Q/Category/City/Status.
type ListRequest struct {
	Q        string
	Category activitiessvc.Category
	City     string
	Status   activitiessvc.Status
	Page     int
	PageSize int
}

// List validates the filter, clamps Page/PageSize, and returns the
// resolved page/pageSize alongside the repository result so the caller can
// echo back what was actually used (never the raw, unclamped request).
func (a *Activities) List(ctx context.Context, req ListRequest) (result activitiessvc.ListResult, page int, pageSize int, err error) {
	if req.Category != "" && !validCategory(req.Category) {
		return activitiessvc.ListResult{}, 0, 0, fmt.Errorf("%w: unknown category %q", sharederrors.ErrInvalidInput, req.Category)
	}
	if req.Status != "" && !validStatus(req.Status) {
		return activitiessvc.ListResult{}, 0, 0, fmt.Errorf("%w: unknown status %q", sharederrors.ErrInvalidInput, req.Status)
	}

	page = req.Page
	if page < 1 {
		page = 1
	}
	pageSize = req.PageSize
	switch {
	case pageSize <= 0:
		pageSize = DefaultListPageSize
	case pageSize > MaxListPageSize:
		pageSize = MaxListPageSize
	}

	result, err = a.repo.List(ctx, activitiessvc.ListFilter{
		Q:        strings.TrimSpace(req.Q),
		Category: req.Category,
		City:     req.City,
		Status:   req.Status,
		Limit:    pageSize,
		Offset:   (page - 1) * pageSize,
	})
	if err != nil {
		return activitiessvc.ListResult{}, 0, 0, fmt.Errorf("listing activities: %w", err)
	}
	return result, page, pageSize, nil
}

// GetByID returns a single activity by id exactly as stored, sentinel
// errors passed through untouched (wrapped for context) — see
// GO_STANDARDS.md "Errors". No live Places call, ever: this backs the
// admin GetActivity RPC (whose edit form round-trips whatever it reads
// straight back into a PATCH) and every other internal read (Update's own
// category lookup, UpdateActivity's pre-write photo snapshot) — none of
// them may see live-merged Google content, or an admin save would
// re-persist exactly the Places data T4's migration exists to keep out of
// the DB. The live-merged view for the public detail-page path lives in
// GetByIDWithLiveDetails (T2 resolve, round 1: this split replaces an
// earlier version that merged directly in GetByID).
func (a *Activities) GetByID(ctx context.Context, id string) (activitiessvc.Activity, error) {
	activity, err := a.repo.GetByID(ctx, id)
	if err != nil {
		return activitiessvc.Activity{}, fmt.Errorf("getting activity %s: %w", id, err)
	}
	return activity, nil
}

// GetByIDWithLiveDetails returns id's activity like GetByID, plus a live
// Google Place Details merge for a Places-sourced row (T2,
// places-live-details) — see withLiveDetails for the merge/fallback
// contract. Reserved for the public detail-page path (T3's proxy route);
// never call this from an admin or other internal read — see GetByID's doc
// for why.
//
// Public surface, so it enforces the same published-only visibility
// QueryActivities' repo query already does (T3 resolve, round 1): a
// draft/pending row 404s here exactly like an unknown id, rather than
// leaking unpublished catalog content and burning a billed Places call on a
// row nobody should see yet.
func (a *Activities) GetByIDWithLiveDetails(ctx context.Context, id string) (activitiessvc.Activity, error) {
	activity, err := a.GetByID(ctx, id)
	if err != nil {
		return activitiessvc.Activity{}, err
	}
	if activity.Status != activitiessvc.StatusPublished {
		return activitiessvc.Activity{}, fmt.Errorf("getting activity %s: %w", id, sharederrors.ErrNotFound)
	}
	return a.withLiveDetails(ctx, activity), nil
}

// detailResolveTimeout bounds GetByIDWithLiveDetails' live Place Details
// lookup (T2, places-live-details): request-scoped and deliberately short,
// same reasoning as photoResolveTimeout — a detail-page load can't block on
// a third-party call.
const detailResolveTimeout = 4 * time.Second

// withLiveDetails live-merges fresh Google Place Details onto activity for
// a Places-sourced row (T2, places-live-details), mirroring GetPhotos'
// fallback-on-error contract exactly: an unconfigured places client, any
// resolve error, or a timeout all fall back to the bare stored row, no
// error surfaced. Tripadvisor-sourced rows (source == "tripadvisor") and
// admin-created rows (source == "") never reach a.places. The one
// deliberate difference from GetPhotos: this result is never passed to
// a.repo.Update or any other persistence call — Places Terms §14.3 forbids
// caching anything but place_id/lat-lng, so every call re-fetches fresh.
//
// Details is replaced outright, not deep-merged: BuildLiveDetails has no
// case for Sport/Entertainment (always "{}"), so any admin-curated details
// on a Places-sourced row in one of those two categories would be
// overwritten on every live-merged read (harmless today only because T4's
// migration already blanks every Places-sourced row's stored details;
// worth remembering if admin curation of those rows is ever added back).
func (a *Activities) withLiveDetails(ctx context.Context, activity activitiessvc.Activity) activitiessvc.Activity {
	if activity.Source == "" || activity.Source == "tripadvisor" || activity.ExternalID == "" || a.places == nil {
		return activity
	}

	resolveCtx, cancel := context.WithTimeout(ctx, detailResolveTimeout)
	defer cancel()

	detail, err := a.places.PlaceDetails(resolveCtx, activity.ExternalID)
	if err != nil {
		slog.Warn("live place details resolve failed, falling back to stored row", "activity_id", activity.ID, "error", err)
		return activity
	}

	activity.Details = placesmap.BuildLiveDetails(activity.Category, activity.Country, detail)
	if desc := liveDescription(detail); desc != "" {
		activity.Description = desc
	}
	// Rating/ReviewCount: guarded on Rating > 0, not just "detail resolved
	// successfully" — Places omits both fields together for a venue with no
	// ratings yet, which decodes as the zero value indistinguishable from
	// "not present" (same ambiguity T1's amenity booleans already document);
	// a guarded overwrite means a rating-less live response never clobbers a
	// real stored rating with a fabricated 0.0.
	if detail.Rating > 0 {
		activity.Rating = detail.Rating
		activity.ReviewCount = detail.UserRatingCount
	}
	activity.GoogleReviews = toGoogleReviews(detail.Reviews)
	activity.GoogleMapsURI = detail.GoogleMapsURI
	return activity
}

// liveDescription reads a Place Details response's description (T2): the
// spec's merge order is editorialSummary first, generativeSummary.overview
// as the fallback. "" when Places supplied neither, so withLiveDetails
// leaves the stored (currently always empty) Description untouched instead
// of blanking it.
func liveDescription(d placesmap.PlaceDetail) string {
	if d.EditorialSummary.Text != "" {
		return d.EditorialSummary.Text
	}
	return d.GenerativeSummary.Overview.Text
}

// toGoogleReviews maps a live Place Details response's reviews onto
// activitiessvc's own wire-agnostic GoogleReview shape (T2): a
// backend/shared model can't import internal/placesmap (Go's internal
// package rule), so this is a small field-for-field copy, not a reshape.
// nil (not an empty slice) when Places returned no reviews, matching
// Photos/Tags' own "absent means nil" convention on Activity.
func toGoogleReviews(reviews []placesmap.Review) []activitiessvc.GoogleReview {
	if len(reviews) == 0 {
		return nil
	}
	out := make([]activitiessvc.GoogleReview, len(reviews))
	for i, r := range reviews {
		out[i] = activitiessvc.GoogleReview{
			AuthorAttribution: activitiessvc.GoogleAuthorAttribution{
				DisplayName: r.AuthorAttribution.DisplayName,
				PhotoURI:    r.AuthorAttribution.PhotoURI,
				URI:         r.AuthorAttribution.URI,
			},
			Rating:      r.Rating,
			Text:        r.Text.Text,
			PublishTime: r.PublishTime,
		}
	}
	return out
}

// photoResolveTimeout bounds GetPhotos' live Places lookup (T2):
// request-scoped and deliberately short — a detail-page load can't block on
// a third-party call. Not internal/places' own http.Client timeout (20s,
// sized for a seed-time batch tool), a separate, smaller value for this,
// the first live per-request Places call in the codebase.
const photoResolveTimeout = 4 * time.Second

// maxResolvedPhotos caps how many Google photos GetPhotos resolves and
// persists per venue on first view.
const maxResolvedPhotos = 8

// GetPhotos returns activity id's full photo set (T2): resolve-on-first-
// view-and-persist. A stored photo count of <= 1 is the "provisional only,
// never fully resolved" signal (see product-tasks.md's T2 note on this
// heuristic) — GetPhotos then resolves the rest live via a.places using the
// activity's own ExternalID and persists the result, so every later call
// for the same activity returns the persisted set with no new Google call.
// Returns the stored set with no Google call when: no places client is
// configured, the activity has no ExternalID, or a resolve is already
// unnecessary (count > 1). A live-resolve error, timeout, or empty result
// also falls back to the stored set — this must never fail the request.
//
// ponytail: the <=1 heuristic misfires for a venue whose real Google photo
// count is exactly 1 — every view re-attempts (harmless: same result,
// bounded by photoResolveTimeout) rather than caching a "fully resolved"
// state. Add a dedicated "photos_resolved" column if that traffic pattern
// ever matters; product-tasks.md's T2 note explicitly defers this.
func (a *Activities) GetPhotos(ctx context.Context, id string) ([]activitiessvc.Photo, error) {
	activity, err := a.repo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("getting activity %s: %w", id, err)
	}
	if activity.ExternalID == "" || len(activity.Photos) > 1 {
		return activity.Photos, nil
	}

	resolveCtx, cancel := context.WithTimeout(ctx, photoResolveTimeout)
	defer cancel()

	var resolved []activitiessvc.Photo
	switch {
	case activity.Source == "tripadvisor" && a.tripadvisor != nil:
		resolved, err = a.tripadvisor.LocationPhotos(resolveCtx, activity.ExternalID, maxResolvedPhotos)
	case activity.Source != "tripadvisor" && a.places != nil:
		resolved, err = a.places.ResolvePhotos(resolveCtx, activity.ExternalID, maxResolvedPhotos)
	default:
		return activity.Photos, nil
	}
	if err != nil || len(resolved) == 0 {
		// Live resolve failure/timeout/empty result: fall back to what's
		// already stored (at minimum the provisional photo) rather than
		// error or block the request.
		return activity.Photos, nil
	}

	updated, err := a.repo.Update(ctx, id, activitiessvc.UpdatePatch{Photos: &resolved})
	if err != nil {
		// Resolved successfully but couldn't persist: still answer this
		// call with what was resolved, just don't claim it's cached yet —
		// the next call will simply retry the resolve.
		return resolved, nil
	}
	return updated.Photos, nil
}

// Create validates and inserts a new activity (T2): title is required,
// category must be a known value, status defaults to StatusDraft when
// unset, and any details payload must match the (possibly just-validated)
// category's shape.
func (a *Activities) Create(ctx context.Context, in activitiessvc.NewActivity) (activitiessvc.Activity, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return activitiessvc.Activity{}, fmt.Errorf("%w: title is required", sharederrors.ErrInvalidInput)
	}
	if !validCategory(in.Category) {
		return activitiessvc.Activity{}, fmt.Errorf("%w: unknown category %q", sharederrors.ErrInvalidInput, in.Category)
	}
	if in.Category == activitiessvc.CategoryRestaurants || in.Category == activitiessvc.CategoryCafes || in.Category == activitiessvc.CategoryBars {
		return activitiessvc.Activity{}, fmt.Errorf("%w: category %q is populated by an automated ingestion pipeline and cannot be admin-created", sharederrors.ErrInvalidInput, in.Category)
	}
	if !activitiessvc.ValidSubcategory(in.Category, in.Subcategory) {
		return activitiessvc.Activity{}, fmt.Errorf("%w: subcategory %q does not belong to category %q", sharederrors.ErrInvalidInput, in.Subcategory, in.Category)
	}

	newStatus := in.Status
	switch {
	case newStatus == "":
		newStatus = activitiessvc.StatusDraft
	case !validStatus(newStatus):
		return activitiessvc.Activity{}, fmt.Errorf("%w: unknown status %q", sharederrors.ErrInvalidInput, newStatus)
	}

	details := normalizeDetails(in.Details)
	if err := ValidateDetails(in.Category, details); err != nil {
		return activitiessvc.Activity{}, err
	}

	created, err := a.repo.Create(ctx, activitiessvc.NewActivity{
		Title: title, Description: in.Description, Category: in.Category,
		City: in.City, Address: in.Address, Status: newStatus, Details: details, Photos: in.Photos,
		Subcategory: in.Subcategory,
	})
	if err != nil {
		return activitiessvc.Activity{}, fmt.Errorf("creating activity: %w", err)
	}
	return created, nil
}

// Update applies a partial update (T2): only patch's non-nil fields are
// validated/persisted, everything else stays untouched (see
// activitiessvc.UpdatePatch's doc). A details payload or subcategory (T1) is
// validated against the patch's own category when set in the same request,
// otherwise against the activity's current category — fetched at most once,
// shared by both checks, and only when either needs it, not on every update.
func (a *Activities) Update(ctx context.Context, id string, patch activitiessvc.UpdatePatch) (activitiessvc.Activity, error) {
	if patch.Category != nil && !validCategory(*patch.Category) {
		return activitiessvc.Activity{}, fmt.Errorf("%w: unknown category %q", sharederrors.ErrInvalidInput, *patch.Category)
	}
	if patch.Status != nil && !validStatus(*patch.Status) {
		return activitiessvc.Activity{}, fmt.Errorf("%w: unknown status %q", sharederrors.ErrInvalidInput, *patch.Status)
	}

	// category is the patch's own category when set, otherwise the
	// activity's current one — fetched at most once, shared by the Details
	// and Subcategory checks below, and only when either needs it.
	var category activitiessvc.Category
	switch {
	case patch.Category != nil:
		category = *patch.Category
	case patch.Details != nil || patch.Subcategory != nil:
		current, err := a.repo.GetByID(ctx, id)
		if err != nil {
			return activitiessvc.Activity{}, fmt.Errorf("getting activity %s: %w", id, err)
		}
		category = current.Category
	}

	if patch.Details != nil {
		normalized := normalizeDetails(*patch.Details)
		patch.Details = &normalized

		if err := ValidateDetails(category, normalized); err != nil {
			return activitiessvc.Activity{}, err
		}
	}

	if patch.Subcategory != nil && !activitiessvc.ValidSubcategory(category, *patch.Subcategory) {
		return activitiessvc.Activity{}, fmt.Errorf("%w: subcategory %q does not belong to category %q", sharederrors.ErrInvalidInput, *patch.Subcategory, category)
	}

	updated, err := a.repo.Update(ctx, id, patch)
	if err != nil {
		return activitiessvc.Activity{}, fmt.Errorf("updating activity %s: %w", id, err)
	}
	return updated, nil
}

// normalizeDetails treats an empty payload as an explicit "{}" (no detail
// data): an admin submitting a blank details field is choosing to clear it,
// not sending malformed JSON — same "empty is always valid" rule
// ValidateDetails already applies.
func normalizeDetails(raw json.RawMessage) json.RawMessage {
	if len(bytes.TrimSpace(raw)) == 0 {
		return json.RawMessage("{}")
	}
	return raw
}

// validStatus is the Go-side boundary validator T1 deferred to T2 (see
// engineering-notes.md): activitiessvc.Status is just a typed string with
// no runtime enforcement on its own (`Status("bogus")` compiles fine) — the
// DB CHECK constraint is T1's actual guard, but Create/Update are the first
// write path, so this is the first place a bad value must be rejected
// before it ever reaches SQL.
func validStatus(s activitiessvc.Status) bool {
	switch s {
	case activitiessvc.StatusPublished, activitiessvc.StatusDraft, activitiessvc.StatusPending:
		return true
	}
	return false
}

func validCategory(c activitiessvc.Category) bool {
	switch c {
	case activitiessvc.CategoryRestaurants,
		activitiessvc.CategoryCafes,
		activitiessvc.CategoryBars,
		activitiessvc.CategoryNightlife,
		activitiessvc.CategoryNature,
		activitiessvc.CategorySport,
		activitiessvc.CategoryKids,
		activitiessvc.CategoryCulture,
		activitiessvc.CategoryArt,
		activitiessvc.CategoryWellness,
		activitiessvc.CategoryShopping,
		activitiessvc.CategoryEntertainment,
		activitiessvc.CategoryToursExperiences:
		return true
	}
	return false
}

// tripadvisorSyncRadiusKM is the fixed local radius the lazy sync sweeps
// around each anchor point, independent of the request's own
// MaxDistanceKM — same reasoning as Google being seeded per-city rather
// than swept over arbitrary radii (design doc "Sync trigger"). Capped at
// 8 km: Terra's nearby-search endpoint rejects any radius above 8.0 KM
// with a 400 (confirmed live) — a larger value here fails every sync
// unconditionally.
const tripadvisorSyncRadiusKM = 8

// tripadvisorSubtypeRadiusKM bounds resolveTripadvisorSubtype's Places Text
// Search to a 50m box around the venue's own Tripadvisor coordinates —
// deliberately much tighter than tripadvisorSyncRadiusKM's 8km discovery
// sweep. The search is by name, and a chain or a generic name ("Coffee
// Shop") can easily recur elsewhere in the same city; 50m keeps the match
// pinned to the one building the venue's own lat/lng already identifies,
// while still tolerating the small, real offset between Tripadvisor's and
// Google's pin placement for the same venue (entrance vs. building centroid).
const tripadvisorSubtypeRadiusKM = 0.05

// tripadvisorSyncTTL is how long a synced area's data is considered fresh
// before the next query for that area re-syncs.
const tripadvisorSyncTTL = 14 * 24 * time.Hour

// tripadvisorSyncTimeout bounds one anchor sync sweep — bounded and
// request-scoped, same fallback philosophy as photoResolveTimeout: a
// search query can't block indefinitely on a third-party call. Sized for
// the paginated sweep: ~5 nearby pages plus per-food-venue detail calls
// running syncVenueConcurrency-wide (see syncTripadvisorAnchor) normally
// finish well under this; a sweep that still overruns is cut off and left
// unmarked so the next query resumes it (see the MarkSynced gate there).
const tripadvisorSyncTimeout = 15 * time.Second

// tripadvisorSyncTotalTimeout caps one Query call's whole sync pass across
// every due anchor (see syncTripadvisorIfNeeded). Without it, worst-case
// search latency would be maxSyncAnchorsPerQuery × tripadvisorSyncTimeout
// (45s); with it, a multi-anchor pass degrades to truncated anchors that
// resume on later queries instead of a blocked search.
const tripadvisorSyncTotalTimeout = 20 * time.Second

// syncVenueConcurrency is how many candidates one anchor sweep resolves at
// once (LocationDetails/LocationReviews/LocationPhotos per candidate).
// Serial resolution of a paginated sweep's ~20-40 food venues would blow
// tripadvisorSyncTimeout on its own; 6-wide keeps the sweep a few seconds
// while staying under Terra's rate-limit radar (doJSON's 429 backoff is
// the safety net).
const syncVenueConcurrency = 6

// maxSyncAnchorsPerQuery caps how many distinct stale anchors one Query call
// can trigger a live sync for — an Anywhere query with many selected cities
// must not fan out into a dozen live Tripadvisor calls at once. One anchor
// costs exactly one Terra NearbySearch call regardless of how many of its
// due categories it covers (Restaurants, Cafés and Bars share the same
// search — see syncTripadvisorAnchor), so this is a true per-anchor cap: staleness is
// still checked per (anchor, category) pair before the cap is applied (see
// syncTripadvisorIfNeeded), but the cap itself counts distinct anchors, not
// (anchor, category) pairs.
const maxSyncAnchorsPerQuery = 3

// syncCategories returns which of requested (or, if empty, all three) of
// Restaurants/Cafés/Bars a lazy sync should cover for this query.
func syncCategories(requested []activitiessvc.Category) []activitiessvc.Category {
	if len(requested) == 0 {
		return []activitiessvc.Category{activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes, activitiessvc.CategoryBars}
	}
	var out []activitiessvc.Category
	for _, c := range requested {
		if c == activitiessvc.CategoryRestaurants || c == activitiessvc.CategoryCafes || c == activitiessvc.CategoryBars {
			out = append(out, c)
		}
	}
	return out
}

// syncAnchors collects the points a lazy sync should sweep for req:
// CurrentLocation for ScopeNearby; CurrentLocation and/or each city
// centroid for ScopeAnywhere.
func syncAnchors(req Request) []activitiessvc.Point {
	var anchors []activitiessvc.Point
	if req.CurrentLocation != nil {
		anchors = append(anchors, *req.CurrentLocation)
	}
	anchors = append(anchors, req.Cities...)
	return anchors
}

// syncCellKey snaps lat/lng to a coarse ~0.1-degree (~11km) grid so nearby
// queries share one freshness record instead of each re-triggering a sync.
func syncCellKey(lat, lng float64) string {
	return fmt.Sprintf("%.1f,%.1f", lat, lng)
}

// syncGroup is one anchor and the due categories a live sync should cover
// for this query — categories whose cached data at that anchor is missing
// or stale. Terra has no per-category search distinction (see
// terraNearbySearchCategory), so grouping by anchor lets syncTripadvisorAnchor
// make exactly one NearbySearch call regardless of how many categories are
// due.
type syncGroup struct {
	anchor     activitiessvc.Point
	categories []activitiessvc.Category
}

// syncTripadvisorIfNeeded triggers a live Tripadvisor sync for req's
// Restaurants/Cafés/Bars anchors when the resolved category filter could include
// them and their cached data is missing or stale. Never fails Query — a
// sync problem at any step is logged and simply leaves the DB as-is; the
// SQL query that follows just sees whatever's already cached (possibly
// nothing, for a never-synced area, until the next successful attempt).
//
// Staleness is checked for every (anchor, category) pair *before* the
// maxSyncAnchorsPerQuery cap is applied, not after — capping the raw anchor
// list first would let a handful of already-fresh low-index anchors starve
// a genuinely stale anchor further down the list (e.g. anchor #4 or #5 of
// an Anywhere request's cities) indefinitely across repeated requests with
// the same anchor set. The cap itself then applies to distinct anchors
// (groups), not (anchor, category) pairs — see maxSyncAnchorsPerQuery.
func (a *Activities) syncTripadvisorIfNeeded(ctx context.Context, req Request) {
	if a.tripadvisor == nil {
		return
	}
	categories := syncCategories(req.Categories)
	if len(categories) == 0 {
		return
	}

	var groups []syncGroup
	for _, anchor := range syncAnchors(req) {
		cell := syncCellKey(anchor.Lat, anchor.Lng)
		var due []activitiessvc.Category
		for _, cat := range categories {
			syncedAt, ok, err := a.repo.SyncedAt(ctx, ProviderTripadvisor, cell, string(cat), "")
			if err != nil {
				slog.Warn("tripadvisor synced-at lookup failed", "cell", cell, "category", cat, "error", err)
			} else if ok && time.Since(syncedAt) < tripadvisorSyncTTL {
				continue
			}
			due = append(due, cat)
		}
		if len(due) > 0 {
			groups = append(groups, syncGroup{anchor: anchor, categories: due})
		}
	}

	if len(groups) > maxSyncAnchorsPerQuery {
		groups = groups[:maxSyncAnchorsPerQuery]
	}
	// One shared budget across all of this query's anchors, so worst-case
	// query latency is bounded by tripadvisorSyncTotalTimeout rather than
	// maxSyncAnchorsPerQuery × the per-anchor timeout. An anchor cut off by
	// the shared budget behaves exactly like one cut off by its own: partial
	// upserts kept, cell left unmarked, re-swept on a later query.
	totalCtx, cancel := context.WithTimeout(ctx, tripadvisorSyncTotalTimeout)
	defer cancel()
	for _, g := range groups {
		a.syncTripadvisorAnchor(totalCtx, g.anchor, g.categories)
	}
}

// syncTripadvisorAnchor syncs one anchor for categories (the due
// Restaurants/Cafés/Bars subset — see syncTripadvisorIfNeeded): a single
// live NearbySearch (paginated inside the client; Terra has no per-category
// distinction — see terraNearbySearchCategory), then a
// LocationDetails/LocationReviews/LocationPhotos pass per surviving
// candidate, syncVenueConcurrency at a time. Candidates are gated and
// classified from the summary alone, before any per-venue call:
// hasFoodDrinkSignal on the summary's WebURL drops the non-food noise
// Terra's unfiltered search returns, and tripadvisormap.Category on the
// summary's name — Terra gives no per-venue category signal (see that
// function's doc) — decides the venue's one Roamly category, never the
// caller's due-category loop. A candidate only gets a repo.Upsert when its
// classified category is itself due at this anchor; a candidate classified
// into an already-fresh category is left alone; that category's data is
// untouched until its own turn comes due. This is what keeps a venue to
// exactly one row instead of the one-row-per-due-category duplication the
// old per-category upsert loop caused (see 0017/0021's migration comments).
// A NearbySearch failure aborts this anchor's sync entirely (no upserts, no
// MarkSynced calls); a single candidate's LocationDetails failure only
// skips that candidate — the rest of the anchor's candidates still proceed,
// same rule internal/places.ResolvePhotos already follows. MarkSynced is
// called once per due category after all candidates are processed — but
// only when the sweep beat its deadline: a deadline-truncated sweep
// ingested only a prefix of the candidates, and stamping it synced would
// freeze that prefix for the whole tripadvisorSyncTTL (exactly how
// Belgrade got stuck at 2 restaurants for 14 days). Left unmarked, the
// upserted prefix stays (Upsert is idempotent) and the next query for the
// area re-runs the whole sweep from scratch — no checkpoint, so
// already-ingested venues are re-resolved and re-upserted; the cost of a
// retried sweep, accepted for the simplicity of not persisting per-venue
// progress.
func (a *Activities) syncTripadvisorAnchor(ctx context.Context, anchor activitiessvc.Point, categories []activitiessvc.Category) {
	syncCtx, cancel := context.WithTimeout(ctx, a.syncTimeout)
	defer cancel()

	summaries, err := a.tripadvisor.NearbySearch(syncCtx, anchor.Lat, anchor.Lng, tripadvisorSyncRadiusKM, terraNearbySearchCategory)
	if err != nil {
		slog.Warn("tripadvisor nearby search failed", "categories", categories, "error", err)
		return
	}

	type candidate struct {
		summary  tripadvisor.LocationSummary
		category activitiessvc.Category
	}
	var candidates []candidate
	var withURL, food int
	for _, s := range summaries {
		if s.WebURL != "" {
			withURL++
		}
		if !hasFoodDrinkSignal(s.WebURL) {
			continue
		}
		food++
		category := tripadvisormap.Category(s.Name)
		if !slices.Contains(categories, category) {
			continue
		}
		candidates = append(candidates, candidate{summary: s, category: category})
	}
	slog.Info("tripadvisor sync sweep filtered", "summaries", len(summaries), "with_web_url", withURL, "food_venues", food, "candidates", len(candidates), "categories", categories)

	// The whole gate hangs on the summary's WebURL. If Terra stops
	// returning urls.tripadvisor.main (entitlement or schema change), every
	// candidate would drop silently, the empty sweep would "succeed", and
	// MarkSynced would freeze the cell at zero venues for the whole TTL —
	// the Belgrade failure through a different door. A genuinely food-free
	// area is fine to mark (its summaries carry URLs, they're just not
	// Restaurant_Review); a URL-less result set means the signal itself is
	// broken, so bail before any per-venue work and leave the cell unmarked.
	if len(summaries) > 0 && withURL == 0 {
		slog.Warn("tripadvisor sync aborted: no summary carried a web URL; gate signal unavailable", "summaries", len(summaries), "categories", categories)
		return
	}

	// Resolved once for the whole sweep, not once per venue or per
	// candidate — see resolveTripadvisorCity's doc for why per-venue
	// derivation from Terra's own address field is exactly the bug this
	// exists to fix. Skipped entirely when there is nothing to upsert.
	var cellLoc cellLocation
	if len(candidates) > 0 {
		cellLoc = a.resolveTripadvisorCity(syncCtx, anchor)
	}

	work := make(chan candidate)
	var wg sync.WaitGroup
	for range min(syncVenueConcurrency, len(candidates)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for c := range work {
				details, reviews, err := a.resolveTripadvisorLocation(syncCtx, c.summary.LocationID)
				if err != nil {
					slog.Warn("tripadvisor location resolve failed", "location_id", c.summary.LocationID, "error", err)
					continue
				}

				// One provisional photo at ingest time, the rest resolved later on
				// first view via GetPhotos — same pattern as cmd/scrapecity's Google
				// seed (minPhotos = 1). LocationDetails carries no photo of its own
				// in the real API, so this is the only source for it. A failure or
				// empty result here must never block the sync.
				photos, err := a.tripadvisor.LocationPhotos(syncCtx, details.LocationID, 1)
				if err != nil {
					slog.Warn("tripadvisor location photos failed", "location_id", details.LocationID, "error", err)
					photos = nil
				}

				subtype := a.resolveTripadvisorSubtype(syncCtx, c.category, details.Name, details.Lat, details.Lng, c.summary.LocationID)

				if _, err := a.repo.Upsert(ctx, tripadvisorIngestActivity(c.category, subtype, details, reviews, photos, cellLoc)); err != nil {
					slog.Warn("upserting tripadvisor activity failed", "location_id", c.summary.LocationID, "category", c.category, "error", err)
				}
			}
		}()
	}
	for _, c := range candidates {
		work <- c
	}
	close(work)
	wg.Wait()

	if syncCtx.Err() != nil {
		slog.Warn("tripadvisor sync truncated by deadline; leaving area unmarked to resume next query", "categories", categories, "candidates", len(candidates))
		return
	}

	for _, category := range categories {
		if err := a.repo.MarkSynced(ctx, ProviderTripadvisor, syncCellKey(anchor.Lat, anchor.Lng), string(category), ""); err != nil {
			slog.Warn("marking tripadvisor sync region failed", "category", category, "error", err)
		}
	}
}

// resolveTripadvisorCity resolves anchor's city/country once for a whole
// Tripadvisor sweep, on the same principle syncGoogleIfNeeded already
// applies per Google sync cell (see cellLocation): city is derived from
// coordinates, never from provider-supplied text. Terra's own address field
// yields neighbourhood/sub-municipality names (Stari Grad, Novi Beograd,
// Dorcol, Vozdovac, ...) instead of the city, exactly the way Places'
// addressComponents used to before ReverseGeocodeCity replaced it — see
// this migration's 0027 comment for the live counts that motivated this.
//
// Degrades to a zero-value cellLocation — never an error — when no Places
// client is configured (a.places == nil, see WithPlaces) or the geocode
// call itself fails; tripadvisorIngestActivity then falls back to Terra's
// own City/Country, exactly as it did before this existed.
func (a *Activities) resolveTripadvisorCity(ctx context.Context, anchor activitiessvc.Point) cellLocation {
	if a.places == nil {
		return cellLocation{}
	}
	city, country, err := a.places.ReverseGeocodeCity(ctx, anchor.Lat, anchor.Lng)
	if err != nil {
		slog.Warn("tripadvisor reverse geocode failed; falling back to terra city", "error", err)
		return cellLocation{}
	}
	return cellLocation{City: city, Country: country}
}

// resolveTripadvisorSubtype derives a subtype for one Tripadvisor venue,
// once per venue per sync (called from syncTripadvisorAnchor's per-venue
// goroutine and RefreshTripadvisorLocation's single-location refresh, never
// on a detail-page render). Tripadvisor's own categories[] field never
// carries a subtype-capable tag on our entitlement (see tripadvisormap's
// package doc), so this resolves the venue by name via a Places Text Search
// tightly bounded to its own coordinates (tripadvisorSubtypeRadiusKM) and
// classifies the single match's Google primaryType/types through
// placesmap.Subtype — the same table Google-sourced categories classify
// through, so Tripadvisor venues land in the identical subtype vocabulary.
//
// Text Search ranks by relevance within the radius, it does not guarantee
// an exact-name lookup — in a dense box the venue itself can be missing
// from Google's results while a neighbour is the sole (best-ranked) hit, so
// a single-result count alone is not identity. venueNameMatches guards
// against exactly that: the candidate's own returned name must plausibly be
// the same venue, or it's rejected same as no match at all.
//
// Returns "" — never a guess — when: no Places client is configured
// (a.places == nil); name is empty or lat/lng is the zero value (nothing
// to search on, and a call would waste a Places request); the search
// errors (logged, the sync itself must not fail); the search finds no
// candidate; it finds more than one, which means the tight radius still
// couldn't disambiguate a same/similar-named venue and picking either
// would be a guess; or the sole candidate's own name doesn't plausibly
// match, meaning it's a different venue that merely happened to be the
// only result in the box.
func (a *Activities) resolveTripadvisorSubtype(ctx context.Context, category activitiessvc.Category, name string, lat, lng float64, locationID string) string {
	if a.places == nil {
		return ""
	}
	if name == "" || (lat == 0 && lng == 0) {
		return ""
	}
	found, err := a.places.SearchTextInArea(ctx, name, lat, lng, tripadvisorSubtypeRadiusKM, places.NearbyFieldMask)
	if err != nil {
		slog.Warn("tripadvisor subtype resolve failed", "location_id", locationID, "name", name, "error", err)
		return ""
	}
	if len(found) != 1 {
		return ""
	}
	if !venueNameMatches(name, found[0].DisplayName.Text) {
		return ""
	}
	return placesmap.Subtype(category, found[0].PrimaryType, found[0].Types)
}

// venueNameMatches reports whether candidateName (a Places Text Search
// hit's own displayName) plausibly names the same venue as tripadvisorName
// — the identity check resolveTripadvisorSubtype needs because Text Search
// is relevance ranking, not exact lookup (see its doc). Case- and
// punctuation-insensitive, and accepts either name containing the other so
// a business-type suffix one provider adds and the other doesn't (e.g.
// Tripadvisor "Ambar" vs Google "Ambar Beograd") doesn't reject a real
// match. Containment only counts once both folded names are at least 3
// characters — otherwise a short name (e.g. a folded "A") would trivially
// "contain-match" almost anything, a false positive containment exists to
// prevent, not create. Anything less overlapping than that is treated as a
// different venue, never a guess.
func venueNameMatches(tripadvisorName, candidateName string) bool {
	a, b := foldVenueName(tripadvisorName), foldVenueName(candidateName)
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	if len(a) < 3 || len(b) < 3 {
		return false
	}
	return strings.Contains(a, b) || strings.Contains(b, a)
}

// foldVenueName lowercases name and strips everything but letters/digits,
// so casing and punctuation/spacing differences between Tripadvisor's and
// Google's spelling of the same venue don't defeat venueNameMatches.
func foldVenueName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// terraNearbySearchCategory is the Terra nearby-search category value used
// for the shared per-anchor sync (RESTAURANT/ATTRACTION/HOTEL — no BAR value
// exists). Bars are a kind of food/drink venue, so RESTAURANT is the closest
// available Terra category. Because it's the same value regardless of which
// Roamly category is being synced, one NearbySearch call per anchor covers
// every due category at that anchor (see syncTripadvisorAnchor) instead of
// one call per category — the Roamly Category each result is upserted under
// is decided by the caller's own due-category list, unaffected by this
// value.
const terraNearbySearchCategory = "RESTAURANT"

// restaurantReviewPathPrefix is the path segment Tripadvisor's own web_url
// carries for every restaurant/eatery review page, e.g.
// ".../Restaurant_Review-g295424-d1911226-Reviews-Little_Bay-Belgrade.html"
// — Attraction_Review and Hotel_Review are the same shape for those venue
// types. See hasFoodDrinkSignal.
const restaurantReviewPathPrefix = "Restaurant_Review-"

// hasFoodDrinkSignal reports whether the venue behind webURL (a
// Tripadvisor review-page URL — the nearby summary's WebURL) is
// Tripadvisor's own idea of a restaurant/eatery.
// terraNearbySearchCategory's category=RESTAURANT parameter doesn't
// actually filter Terra's nearby-search results (verified live) — car
// rentals, transport, photo studios, monuments, hotels and attractions all
// come back alongside real restaurants and would otherwise get upserted as
// one. Terra's categories[]/rankings[]/awards[] fields are documented but
// never returned on our API entitlement (also verified live), so they
// can't be used here; PriceLevel/subratings used to stand in for them, but
// Tripadvisor only populates those for a venue with existing reviews, so a
// brand-new restaurant with neither would have been wrongly rejected.
// web_url doesn't have that gap: Tripadvisor stamps every review page with
// its own venue-type path segment
// (restaurantReviewPathPrefix/Attraction_Review-/Hotel_Review-) regardless
// of review history, so this is Tripadvisor's own classification rather
// than an inferred one. Matched as a full URL path segment, not a raw
// substring of the URL, so a venue name that happens to contain the text
// can't spoof a match; an empty or unparseable URL is rejected, not
// assumed food-related by default.
func hasFoodDrinkSignal(webURL string) bool {
	u, err := url.Parse(webURL)
	if err != nil {
		return false
	}
	for _, seg := range strings.Split(u.Path, "/") {
		if strings.HasPrefix(seg, restaurantReviewPathPrefix) {
			return true
		}
	}
	return false
}

// maxFeaturedReviews caps the quoted reviews surfaced on a Tripadvisor
// detail page (frame 5b's swipeable review row).
const maxFeaturedReviews = 3

// tripadvisorReviews returns up to maxFeaturedReviews quoted reviews
// eligible under compliance rule 04 (5-bubble, place rated >= 4.0), or nil
// when none qualify — never a live reviews call for a place below the
// rating bar.
func (a *Activities) tripadvisorReviews(ctx context.Context, details tripadvisor.LocationDetails) []activitiessvc.TripadvisorReview {
	if details.Rating < 4.0 {
		return nil
	}
	fetched, err := a.tripadvisor.LocationReviews(ctx, details.LocationID)
	if err != nil {
		slog.Warn("tripadvisor location reviews failed", "location_id", details.LocationID, "error", err)
		return nil
	}
	var out []activitiessvc.TripadvisorReview
	for _, r := range fetched {
		if r.Rating != 5 {
			continue
		}
		out = append(out, activitiessvc.TripadvisorReview{Rating: r.Rating, Date: r.Date, Text: r.Text, RatingImageURL: r.RatingImageURL})
		if len(out) == maxFeaturedReviews {
			break
		}
	}
	return out
}

// resolveTripadvisorLocation fetches locationID's current details and
// eligible featured reviews — the fetch-only step shared by
// syncTripadvisorAnchor's discovery sweep and RefreshTripadvisorLocation's
// direct-by-ID backfill path (see cmd/backfilltripadvisor). Deliberately
// stops short of also fetching a photo or upserting: a sweep's brand-new
// discovery needs a provisional photo on first insert, but
// RefreshTripadvisorLocation's only caller (the backfill tool) exclusively
// refreshes rows that already exist — Upsert's own
// ON CONFLICT (source_url, category) DO UPDATE never touches the photos
// column, so whenever the row's stored source_url still matches (the
// common case), a live LocationPhotos call here would resolve a photo
// only to have it silently discarded on the UPDATE path. (On the rarer
// path where Tripadvisor's web_url has drifted since ingest, Upsert
// inserts a new row instead and a photo would actually land — but that
// row is already photoless today regardless, since GetPhotos resolves it
// on first detail view; not a regression this method needs to solve.)
// Leaving photo-fetching and the final
// Upsert call in each caller's own code lets each decide the photo
// question independently, and keeps the sweep's outer-ctx-for-Upsert
// choice a visible, one-line decision at its own call site rather than
// buried in a shared helper's signature.
func (a *Activities) resolveTripadvisorLocation(ctx context.Context, locationID string) (tripadvisor.LocationDetails, []activitiessvc.TripadvisorReview, error) {
	details, err := a.tripadvisor.LocationDetails(ctx, locationID)
	if err != nil {
		return tripadvisor.LocationDetails{}, nil, fmt.Errorf("tripadvisor location details: %w", err)
	}
	return details, a.tripadvisorReviews(ctx, details), nil
}

// RefreshTripadvisorLocation re-fetches locationID's current Tripadvisor
// details/reviews and re-upserts it under category — the direct,
// discovery-free counterpart to syncTripadvisorAnchor's NearbySearch-bounded
// sweep. syncTripadvisorAnchor only ever re-touches whichever locations a
// fresh NearbySearch snapshot happens to resurface (capped at
// nearbySearchMaxPages pages); a full backfill of every already-known
// location (see cmd/backfilltripadvisor) needs to hit each one directly by
// ID instead, bypassing that discovery step and its cap entirely.
//
// No photo fetch — see resolveTripadvisorLocation's doc for why a live
// LocationPhotos call here would be pure waste. This method's one ctx
// param (rather than syncTripadvisorAnchor's fetch-ctx/write-ctx split) is
// the right shape for its one caller: a backfill script has no analogous
// sweep-deadline-vs-write distinction to preserve.
func (a *Activities) RefreshTripadvisorLocation(ctx context.Context, category activitiessvc.Category, locationID string) error {
	if a.tripadvisor == nil {
		return fmt.Errorf("tripadvisor client not configured")
	}
	details, reviews, err := a.resolveTripadvisorLocation(ctx, locationID)
	if err != nil {
		return err
	}
	// Re-resolved on every refresh, same as a fresh sync — Upsert's ON
	// CONFLICT unconditionally overwrites subcategory (see its own doc), so
	// skipping this here would silently wipe out a subtype a prior sync
	// already resolved every time cmd/backfilltripadvisor's refresh runs.
	subtype := a.resolveTripadvisorSubtype(ctx, category, details.Name, details.Lat, details.Lng, locationID)
	// No anchor here — a direct-by-ID backfill has no sweep to resolve a
	// city once for (see resolveTripadvisorCity) — so this always falls
	// back to Terra's own City/Country, same as every call before this
	// param existed. Fine for its one caller (cmd/backfilltripadvisor):
	// every row it touches already has a stored city that COALESCE(NULLIF(
	// ..., ''), ...) in Upsert preserves if Terra's own value is empty.
	if _, err := a.repo.Upsert(ctx, tripadvisorIngestActivity(category, subtype, details, reviews, nil, cellLocation{})); err != nil {
		return fmt.Errorf("upserting tripadvisor activity %s: %w", locationID, err)
	}
	return nil
}

// tripadvisorIngestActivity maps a resolved Tripadvisor location into the
// shape repo.Upsert expects: auto-published (no admin moderation step —
// the whole point of an on-demand sync is that the requesting user sees
// results now). RankingText, Award, PriceLevel, and Cuisine are all sourced
// from the real rankings[]/awards[]/price_level/categories[] fields Terra
// returns (see LocationDetails' doc) — each stays empty/nil only when
// Tripadvisor itself returned nothing for it, never a fabricated value.
//
// City/Country prefer cell — resolved once per sweep via
// resolveTripadvisorCity, consistent across every venue the sweep ingests —
// and fall back per field to Terra's own d.City/d.Country when the cell
// resolution is empty (no Places client configured, or a geocode failure).
// Upsert's own ON CONFLICT also refuses to let an empty incoming city/
// country clobber a stored one, so an empty cell resolution here degrades
// safely either way.
func tripadvisorIngestActivity(category activitiessvc.Category, subtype string, d tripadvisor.LocationDetails, reviews []activitiessvc.TripadvisorReview, photos []activitiessvc.Photo, cell cellLocation) activitiessvc.IngestActivity {
	attribution := &activitiessvc.TripadvisorAttribution{
		RatingImageURL: d.RatingImageURL,
		ReviewCount:    d.ReviewCount,
		RankingText:    rankingText(d.Rankings),
		WebURL:         d.WebURL,
		Phone:          d.Phone,
		PriceLevel:     d.PriceLevel,
		// ponytail: carried onto the wire, nothing renders these two yet —
		// 0/83 sampled Restaurants/Bars/Cafés/attractions/hotels returned
		// Attributes at all, and RecommendedVisitLength was 0 for every
		// food venue sampled. Build the rendering once any real venue
		// actually returns a non-empty value for either.
		Attributes:             d.Attributes,
		RecommendedVisitLength: d.RecommendedVisitLength,
	}
	if d.Subratings != (tripadvisor.Subratings{}) {
		attribution.Subratings = &activitiessvc.TripadvisorSubratings{
			Food:       toAspectRating(d.Subratings.Food),
			Service:    toAspectRating(d.Subratings.Service),
			Value:      toAspectRating(d.Subratings.Value),
			Atmosphere: toAspectRating(d.Subratings.Atmosphere),
		}
	}
	if d.Award != nil {
		attribution.Award = &activitiessvc.TripadvisorAward{Name: d.Award.Name, Year: d.Award.Year}
	}
	if len(d.Categories) > 0 {
		attribution.Cuisine = d.Categories[0].DisplayName
	}
	detailsJSON, _ := json.Marshal(tripadvisorDetailsPayload(category, attribution, reviews))

	city, country := cell.City, cell.Country
	if city == "" {
		city = d.City
	}
	if country == "" {
		country = d.Country
	}

	return activitiessvc.IngestActivity{
		Title:       d.Name,
		Description: d.Description,
		Category:    category,
		Lat:         d.Lat,
		Lng:         d.Lng,
		Address:     d.Address,
		City:        city,
		Country:     country,
		Rating:      d.Rating,
		Status:      activitiessvc.StatusPublished,
		Details:     detailsJSON,
		Photos:      photos,
		Source:      "tripadvisor",
		SourceURL:   d.WebURL,
		ExternalID:  d.LocationID,
		// subtype is resolved by the caller via resolveTripadvisorSubtype
		// (Tripadvisor's own categories[] never carries one — see that
		// function's doc) — "" when it didn't resolve, never a guess.
		Subcategory: subtype,
	}
}

// toAspectRating converts one optional tripadvisor.Aspect into its wire
// counterpart, nil staying nil — an aspect Tripadvisor didn't rate must
// never become a fabricated zero-value bubble downstream.
func toAspectRating(a *tripadvisor.Aspect) *activitiessvc.TripadvisorAspectRating {
	if a == nil {
		return nil
	}
	return &activitiessvc.TripadvisorAspectRating{Rating: a.Rating, IconURL: a.IconURL}
}

// rankingDateRe matches a full month name followed by a 4-digit year (e.g.
// "July 2026") — the exact stamp rankingText itself would append, so it
// doubles as the "does display_text already carry a date" check.
var rankingDateRe = regexp.MustCompile(`(?i)\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b`)

// rankingText composes attribution rule 05's dated ranking sentence: Terra's
// own display_text for rankings[0] (never invented — see LocationDetails'
// doc, Terra doesn't enumerate which of possibly several rankings is
// "primary", so the first entry is used as-is), plus a
// ", as rated by Tripadvisor travelers as of <Month YYYY>" suffix (sync
// time) unless display_text already carries a date. Empty when Tripadvisor
// returned no ranking at all.
func rankingText(rankings []tripadvisor.Ranking) string {
	if len(rankings) == 0 || rankings[0].DisplayText == "" {
		return ""
	}
	text := rankings[0].DisplayText
	if rankingDateRe.MatchString(text) {
		return text
	}
	return text + ", as rated by Tripadvisor travelers as of " + time.Now().Format("January 2006")
}

func tripadvisorDetailsPayload(category activitiessvc.Category, attribution *activitiessvc.TripadvisorAttribution, reviews []activitiessvc.TripadvisorReview) any {
	switch category {
	case activitiessvc.CategoryBars:
		return activitiessvc.BarDetails{Tripadvisor: attribution, Reviews: reviews}
	case activitiessvc.CategoryCafes:
		return activitiessvc.CafeDetails{Tripadvisor: attribution, Reviews: reviews}
	default:
		return activitiessvc.RestaurantDetails{Tripadvisor: attribution, Reviews: reviews}
	}
}
