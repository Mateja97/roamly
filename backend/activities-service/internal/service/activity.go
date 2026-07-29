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
	"strings"
	"time"

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
	// Upsert inserts or updates an ingested activity, keyed on source_url
	// (T4's Restaurants/Bars lazy sync reuses the same upsert the batch
	// Google pipeline already relies on).
	Upsert(ctx context.Context, in activitiessvc.IngestActivity) (activitiessvc.Activity, error)
	// SyncedAt reports the last successful Tripadvisor sync time for
	// (cellKey, category), and whether one has happened at all.
	SyncedAt(ctx context.Context, cellKey, category string) (time.Time, bool, error)
	// MarkSynced records a fresh Tripadvisor sync for (cellKey, category).
	MarkSynced(ctx context.Context, cellKey, category string) error
}

// placesClient is the subset of internal/places.Client GetPhotos needs
// (T2). Optional (see WithPlaces) — a server with none configured, or with
// GOOGLE_MAPS_API_KEY unset, still serves stored photos, it just never
// resolves a venue's rest-of-set live.
type placesClient interface {
	ResolvePhotos(ctx context.Context, placeID string, limit int) ([]activitiessvc.Photo, error)
}

// tripadvisorClient is the subset of internal/tripadvisor.Client the
// service layer needs: GetPhotos uses LocationPhotos; the lazy
// Restaurants/Bars sync (below) uses the other three. Optional (see
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
}

func New(repo repository) *Activities {
	return &Activities{repo: repo}
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

// GetByID returns a single activity by id, sentinel errors passed through
// untouched (wrapped for context) — see GO_STANDARDS.md "Errors".
func (a *Activities) GetByID(ctx context.Context, id string) (activitiessvc.Activity, error) {
	activity, err := a.repo.GetByID(ctx, id)
	if err != nil {
		return activitiessvc.Activity{}, fmt.Errorf("getting activity %s: %w", id, err)
	}
	return activity, nil
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
// than swept over arbitrary radii (design doc "Sync trigger").
const tripadvisorSyncRadiusKM = 15

// tripadvisorSyncTTL is how long a synced area's data is considered fresh
// before the next query for that area re-syncs.
const tripadvisorSyncTTL = 14 * 24 * time.Hour

// tripadvisorSyncTimeout bounds one anchor/category sync sweep — bounded
// and request-scoped, same fallback philosophy as photoResolveTimeout: a
// search query can't block indefinitely on a third-party call.
const tripadvisorSyncTimeout = 6 * time.Second

// maxSyncAnchorsPerQuery caps how many anchor points one Query call can
// trigger a live sync for — an Anywhere query with many selected cities
// must not fan out into a dozen live Tripadvisor calls at once.
const maxSyncAnchorsPerQuery = 3

// syncCategories returns which of requested (or, if empty, both) of
// Restaurants/Bars a lazy sync should cover for this query.
func syncCategories(requested []activitiessvc.Category) []activitiessvc.Category {
	if len(requested) == 0 {
		return []activitiessvc.Category{activitiessvc.CategoryRestaurants, activitiessvc.CategoryBars}
	}
	var out []activitiessvc.Category
	for _, c := range requested {
		if c == activitiessvc.CategoryRestaurants || c == activitiessvc.CategoryBars {
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

// syncTripadvisorIfNeeded triggers a live Tripadvisor sync for req's
// Restaurants/Bars anchors when the resolved category filter could include
// them and their cached data is missing or stale. Never fails Query — a
// sync problem at any step is logged and simply leaves the DB as-is; the
// SQL query that follows just sees whatever's already cached (possibly
// nothing, for a never-synced area, until the next successful attempt).
func (a *Activities) syncTripadvisorIfNeeded(ctx context.Context, req Request) {
	if a.tripadvisor == nil {
		return
	}
	categories := syncCategories(req.Categories)
	if len(categories) == 0 {
		return
	}

	anchors := syncAnchors(req)
	if len(anchors) > maxSyncAnchorsPerQuery {
		anchors = anchors[:maxSyncAnchorsPerQuery]
	}
	for _, anchor := range anchors {
		cell := syncCellKey(anchor.Lat, anchor.Lng)
		for _, cat := range categories {
			syncedAt, ok, err := a.repo.SyncedAt(ctx, cell, string(cat))
			if err == nil && ok && time.Since(syncedAt) < tripadvisorSyncTTL {
				continue
			}
			a.syncTripadvisorArea(ctx, anchor, cat)
		}
	}
}

// syncTripadvisorArea syncs one anchor/category pair: live NearbySearch,
// then LocationDetails (and, when eligible, LocationReviews) per result,
// upserted into the catalog. A NearbySearch failure aborts this area's
// sync (nothing to iterate); a single candidate's LocationDetails/Upsert
// failure only skips that candidate — one bad venue doesn't sink the rest,
// same rule internal/places.ResolvePhotos already follows.
func (a *Activities) syncTripadvisorArea(ctx context.Context, anchor activitiessvc.Point, category activitiessvc.Category) {
	syncCtx, cancel := context.WithTimeout(ctx, tripadvisorSyncTimeout)
	defer cancel()

	summaries, err := a.tripadvisor.NearbySearch(syncCtx, anchor.Lat, anchor.Lng, tripadvisorSyncRadiusKM, string(category))
	if err != nil {
		slog.Warn("tripadvisor nearby search failed", "category", category, "error", err)
		return
	}

	for _, s := range summaries {
		details, err := a.tripadvisor.LocationDetails(syncCtx, s.LocationID)
		if err != nil {
			slog.Warn("tripadvisor location details failed", "location_id", s.LocationID, "error", err)
			continue
		}
		review := a.featuredReview(syncCtx, details)
		if _, err := a.repo.Upsert(ctx, tripadvisorIngestActivity(category, details, review)); err != nil {
			slog.Warn("upserting tripadvisor activity failed", "location_id", s.LocationID, "error", err)
		}
	}

	if err := a.repo.MarkSynced(ctx, syncCellKey(anchor.Lat, anchor.Lng), string(category)); err != nil {
		slog.Warn("marking tripadvisor sync region failed", "category", category, "error", err)
	}
}

// featuredReview returns the one quoted review eligible under compliance
// rule 04 (5-bubble, place rated >= 4.0), or nil when none qualifies —
// never a live reviews call for a place below the rating bar.
func (a *Activities) featuredReview(ctx context.Context, details tripadvisor.LocationDetails) *activitiessvc.TripadvisorReview {
	if details.Rating < 4.0 {
		return nil
	}
	reviews, err := a.tripadvisor.LocationReviews(ctx, details.LocationID)
	if err != nil {
		return nil
	}
	for _, r := range reviews {
		if r.Rating == 5 {
			return &activitiessvc.TripadvisorReview{Rating: r.Rating, Date: r.Date, Text: r.Text}
		}
	}
	return nil
}

// tripadvisorIngestActivity maps a resolved Tripadvisor location into the
// shape repo.Upsert expects: auto-published (no admin moderation step —
// the whole point of an on-demand sync is that the requesting user sees
// results now), RankingText pre-formatted with the current month/year
// (compliance rule 05).
func tripadvisorIngestActivity(category activitiessvc.Category, d tripadvisor.LocationDetails, review *activitiessvc.TripadvisorReview) activitiessvc.IngestActivity {
	var photos []activitiessvc.Photo
	if d.PhotoURL != "" {
		photos = []activitiessvc.Photo{{URL: d.PhotoURL, Provider: activitiessvc.ProviderTripadvisor}}
	}

	rankingText := ""
	if d.RankingString != "" {
		rankingText = fmt.Sprintf("%s, as rated by Tripadvisor travelers as of %s", d.RankingString, time.Now().Format("January 2006"))
	}
	attribution := &activitiessvc.TripadvisorAttribution{
		RatingImageURL: d.RatingImageURL,
		ReviewCount:    d.ReviewCount,
		RankingText:    rankingText,
		WebURL:         d.WebURL,
	}
	detailsJSON, _ := json.Marshal(tripadvisorDetailsPayload(category, attribution, review))

	return activitiessvc.IngestActivity{
		Title:       d.Name,
		Category:    category,
		Lat:         d.Lat,
		Lng:         d.Lng,
		Address:     d.Address,
		Rating:      d.Rating,
		Status:      activitiessvc.StatusPublished,
		Details:     detailsJSON,
		Photos:      photos,
		Source:      "tripadvisor",
		SourceURL:   d.WebURL,
		ExternalID:  d.LocationID,
		Subcategory: tripadvisormap.Subtype(category, d.Subcategories),
	}
}

func tripadvisorDetailsPayload(category activitiessvc.Category, attribution *activitiessvc.TripadvisorAttribution, review *activitiessvc.TripadvisorReview) any {
	if category == activitiessvc.CategoryBars {
		return activitiessvc.BarDetails{Tripadvisor: attribution, FeaturedReview: review}
	}
	return activitiessvc.RestaurantDetails{Tripadvisor: attribution, FeaturedReview: review}
}
