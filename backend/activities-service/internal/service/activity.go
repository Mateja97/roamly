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
	"net/url"
	"strings"
	"time"

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
}

// placesClient is the subset of internal/places.Client GetPhotos needs
// (T2). Optional (see WithPlaces) — a server with none configured, or with
// GOOGLE_MAPS_API_KEY unset, still serves stored photos, it just never
// resolves a venue's rest-of-set live.
type placesClient interface {
	ResolvePhotos(ctx context.Context, placeID string, limit int) ([]activitiessvc.Photo, error)
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
	repo   repository
	places placesClient
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

func (a *Activities) Query(ctx context.Context, req Request) ([]activitiessvc.Activity, error) {
	filter, err := a.resolve(req)
	if err != nil {
		return nil, fmt.Errorf("resolving query: %w", err)
	}

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
	if a.places == nil || activity.ExternalID == "" || len(activity.Photos) > 1 {
		return activity.Photos, nil
	}

	resolveCtx, cancel := context.WithTimeout(ctx, photoResolveTimeout)
	defer cancel()
	resolved, err := a.places.ResolvePhotos(resolveCtx, activity.ExternalID, maxResolvedPhotos)
	if err != nil || len(resolved) == 0 {
		// Places failure/timeout/empty result: fall back to what's already
		// stored (at minimum the provisional photo) rather than error or
		// block the request.
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
