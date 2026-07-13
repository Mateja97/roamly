// Package service holds activities-service's business logic: input
// validation and scope/filter resolution. It passes sentinel errors through
// untouched (wrapped with context), never swallowing or replacing them —
// see GO_STANDARDS.md "Errors".
package service

import (
	"context"
	"fmt"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
)

type repository interface {
	Query(ctx context.Context, filter activitiessvc.QueryFilter) ([]activitiessvc.Activity, error)
}

// Request is the pre-validation shape of a query: MaxDistanceKM is the
// caller's raw filter value (0 = not set), not yet resolved against the
// service's default scope radius.
type Request struct {
	Scope           activitiessvc.Scope
	CurrentLocation *activitiessvc.Point
	HomeLocation    *activitiessvc.Point
	HomeCountry     string
	Categories      []activitiessvc.Category
	PriceTier       activitiessvc.PriceTier
	MinRating       float64
	MaxDistanceKM   float64
	Sort            activitiessvc.Sort
}

type Activities struct {
	repo            repository
	defaultRadiusKM float64
}

func New(repo repository, defaultRadiusKM float64) *Activities {
	return &Activities{repo: repo, defaultRadiusKM: defaultRadiusKM}
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

func (a *Activities) resolve(req Request) (activitiessvc.QueryFilter, error) {
	switch req.Scope {
	case activitiessvc.ScopeHome, activitiessvc.ScopeNearby, activitiessvc.ScopeOutsideCountry:
	default:
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: unknown scope %q", sharederrors.ErrInvalidInput, req.Scope)
	}

	filter := activitiessvc.QueryFilter{
		Scope:       req.Scope,
		HomeCountry: req.HomeCountry,
		Categories:  req.Categories,
		PriceTier:   req.PriceTier,
		MinRating:   req.MinRating,
		Sort:        req.Sort,
	}

	switch req.Scope {
	case activitiessvc.ScopeHome:
		if err := validatePoint(req.HomeLocation); err != nil {
			return activitiessvc.QueryFilter{}, fmt.Errorf("%w: home_location %s", sharederrors.ErrInvalidInput, err)
		}
		filter.HomeLocation = req.HomeLocation
		filter.MaxDistanceKM = effectiveRadius(a.defaultRadiusKM, req.MaxDistanceKM)

	case activitiessvc.ScopeNearby:
		if err := validatePoint(req.CurrentLocation); err != nil {
			return activitiessvc.QueryFilter{}, fmt.Errorf("%w: current_location %s", sharederrors.ErrInvalidInput, err)
		}
		filter.CurrentLocation = req.CurrentLocation
		filter.MaxDistanceKM = effectiveRadius(a.defaultRadiusKM, req.MaxDistanceKM)

	case activitiessvc.ScopeOutsideCountry:
		if req.HomeCountry == "" {
			return activitiessvc.QueryFilter{}, fmt.Errorf("%w: home_country is required for scope outside_country", sharederrors.ErrInvalidInput)
		}
		if req.MaxDistanceKM != 0 {
			return activitiessvc.QueryFilter{}, fmt.Errorf("%w: max_distance_km is not supported for scope outside_country", sharederrors.ErrInvalidInput)
		}
	}

	for _, c := range req.Categories {
		if !validCategory(c) {
			return activitiessvc.QueryFilter{}, fmt.Errorf("%w: unknown category %q", sharederrors.ErrInvalidInput, c)
		}
	}
	if req.PriceTier != activitiessvc.PriceTierUnspecified && !validPriceTier(req.PriceTier) {
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: unknown price tier %q", sharederrors.ErrInvalidInput, req.PriceTier)
	}
	if req.MinRating < 0 || req.MinRating > 5 {
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: min_rating must be between 0 and 5", sharederrors.ErrInvalidInput)
	}
	if req.MaxDistanceKM < 0 {
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: max_distance_km must not be negative", sharederrors.ErrInvalidInput)
	}
	if req.Sort != activitiessvc.SortUnspecified && !validSort(req.Sort) {
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: unknown sort %q", sharederrors.ErrInvalidInput, req.Sort)
	}
	if req.Sort == activitiessvc.SortTopRated && req.Scope != activitiessvc.ScopeOutsideCountry {
		return activitiessvc.QueryFilter{}, fmt.Errorf("%w: sort=top_rated is only supported for scope outside_country", sharederrors.ErrInvalidInput)
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

// effectiveRadius narrows the service's default scope radius by an optional
// caller-supplied max_distance_km filter; both bounds apply against the same
// reference location, so ANDing them collapses to the smaller one.
func effectiveRadius(defaultRadiusKM, requestedMaxKM float64) float64 {
	if requestedMaxKM > 0 && requestedMaxKM < defaultRadiusKM {
		return requestedMaxKM
	}
	return defaultRadiusKM
}

func validCategory(c activitiessvc.Category) bool {
	switch c {
	case activitiessvc.CategoryFoodAndDrink,
		activitiessvc.CategoryHistoryAndCulture,
		activitiessvc.CategoryNatureAndOutdoors,
		activitiessvc.CategoryArtAndDesign,
		activitiessvc.CategorySports,
		activitiessvc.CategoryEntertainmentAndWellness:
		return true
	}
	return false
}

func validPriceTier(p activitiessvc.PriceTier) bool {
	switch p {
	case activitiessvc.PriceTierBudget, activitiessvc.PriceTierModerate,
		activitiessvc.PriceTierPremium, activitiessvc.PriceTierLuxury:
		return true
	}
	return false
}

func validSort(s activitiessvc.Sort) bool {
	return s == activitiessvc.SortTopRated
}
