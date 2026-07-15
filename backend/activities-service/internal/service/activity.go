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
	Cities        []activitiessvc.Point
	Categories    []activitiessvc.Category
	MinRating     float64
	MaxDistanceKM float64
}

// NearbyRadiusKM is the fixed, non-adjustable radius for ScopeNearby
// (T2): any client-supplied MaxDistanceKM is ignored for this scope.
const NearbyRadiusKM = 10

type Activities struct {
	repo repository
}

func New(repo repository) *Activities {
	return &Activities{repo: repo}
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
		Scope:      req.Scope,
		Categories: req.Categories,
		MinRating:  req.MinRating,
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
//
// ponytail: not called from any RPC yet — ActivitiesService is read-only
// today (Query/SuggestCities only, no create/update). Wire this in when a
// write path lands; exported and tested now per T2's acceptance criteria.
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
// http(s) URL, and Art's year must be a plausible 4-digit year.
func validateExtraFields(target any) error {
	switch t := target.(type) {
	case *activitiessvc.RestaurantDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.BarDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.NightlifeDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.SportDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.CultureDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.ArtDetails:
		if err := validateActionURL(t.ActionURL); err != nil {
			return err
		}
		return validateYear(t.Year)
	case *activitiessvc.WellnessDetails:
		return validateActionURL(t.ActionURL)
	case *activitiessvc.EntertainmentDetails:
		return validateActionURL(t.ActionURL)
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
		activitiessvc.CategoryEntertainment:
		return true
	}
	return false
}
