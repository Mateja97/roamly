// Package api is the gRPC transport layer: one file per RPC method,
// translating proto <-> domain types and mapping sentinel errors to gRPC
// status codes. See GO_STANDARDS.md "Errors" for the mapping table.
package api

import (
	"context"
	"errors"
	"log/slog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"

	"activities-service/internal/service"
)

type queryService interface {
	Query(ctx context.Context, req service.Request) ([]activitiessvc.Activity, error)
}

type Server struct {
	activitiesv1.UnimplementedActivitiesServiceServer
	svc    queryService
	logger *slog.Logger
}

func NewServer(svc queryService, logger *slog.Logger) *Server {
	return &Server{svc: svc, logger: logger}
}

func (s *Server) QueryActivities(ctx context.Context, req *activitiesv1.QueryActivitiesRequest) (*activitiesv1.QueryActivitiesResponse, error) {
	activities, err := s.svc.Query(ctx, toServiceRequest(req))
	if err != nil {
		if errors.Is(err, sharederrors.ErrInvalidInput) {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		s.logger.Error("query activities failed", "error", err)
		return nil, status.Error(codes.Internal, "internal error")
	}

	resp := &activitiesv1.QueryActivitiesResponse{
		Activities: make([]*activitiesv1.Activity, len(activities)),
	}
	for i, a := range activities {
		resp.Activities[i] = toProtoActivity(a)
	}
	return resp, nil
}

func toServiceRequest(req *activitiesv1.QueryActivitiesRequest) service.Request {
	categories := make([]activitiessvc.Category, 0, len(req.GetCategories()))
	for _, c := range req.GetCategories() {
		categories = append(categories, toDomainCategory(c))
	}
	return service.Request{
		Scope:           toDomainScope(req.GetScope()),
		CurrentLocation: toDomainPoint(req.GetCurrentLocation()),
		HomeLocation:    toDomainPoint(req.GetHomeLocation()),
		HomeCountry:     req.GetHomeCountry(),
		Categories:      categories,
		PriceTier:       toDomainPriceTier(req.GetPriceTier()),
		MinRating:       req.GetMinRating(),
		MaxDistanceKM:   req.GetMaxDistanceKm(),
		Sort:            toDomainSort(req.GetSort()),
	}
}

func toDomainPoint(l *activitiesv1.Location) *activitiessvc.Point {
	if l == nil {
		return nil
	}
	return &activitiessvc.Point{Lat: l.GetLat(), Lng: l.GetLng()}
}

func toDomainScope(s activitiesv1.Scope) activitiessvc.Scope {
	switch s {
	case activitiesv1.Scope_SCOPE_HOME:
		return activitiessvc.ScopeHome
	case activitiesv1.Scope_SCOPE_NEARBY:
		return activitiessvc.ScopeNearby
	case activitiesv1.Scope_SCOPE_OUTSIDE_COUNTRY:
		return activitiessvc.ScopeOutsideCountry
	default:
		return "" // service layer rejects this as an unknown scope
	}
}

func toDomainCategory(c activitiesv1.Category) activitiessvc.Category {
	switch c {
	case activitiesv1.Category_CATEGORY_FOOD_AND_DRINK:
		return activitiessvc.CategoryFoodAndDrink
	case activitiesv1.Category_CATEGORY_HISTORY_AND_CULTURE:
		return activitiessvc.CategoryHistoryAndCulture
	case activitiesv1.Category_CATEGORY_NATURE_AND_OUTDOORS:
		return activitiessvc.CategoryNatureAndOutdoors
	case activitiesv1.Category_CATEGORY_ART_AND_DESIGN:
		return activitiessvc.CategoryArtAndDesign
	case activitiesv1.Category_CATEGORY_SPORTS:
		return activitiessvc.CategorySports
	case activitiesv1.Category_CATEGORY_ENTERTAINMENT_AND_WELLNESS:
		return activitiessvc.CategoryEntertainmentAndWellness
	default:
		return "" // service layer rejects this as an unknown category
	}
}

func toDomainPriceTier(p activitiesv1.PriceTier) activitiessvc.PriceTier {
	switch p {
	case activitiesv1.PriceTier_PRICE_TIER_UNSPECIFIED:
		return activitiessvc.PriceTierUnspecified
	case activitiesv1.PriceTier_PRICE_TIER_BUDGET:
		return activitiessvc.PriceTierBudget
	case activitiesv1.PriceTier_PRICE_TIER_MODERATE:
		return activitiessvc.PriceTierModerate
	case activitiesv1.PriceTier_PRICE_TIER_PREMIUM:
		return activitiessvc.PriceTierPremium
	case activitiesv1.PriceTier_PRICE_TIER_LUXURY:
		return activitiessvc.PriceTierLuxury
	default:
		// ponytail: an out-of-range wire value must not collapse into the
		// legitimate "unspecified/no filter" zero value, or service.validPriceTier
		// would silently treat garbage input as no-op instead of rejecting it.
		// Any non-empty string outside the known tiers fails validPriceTier.
		return activitiessvc.PriceTier("invalid")
	}
}

func toDomainSort(s activitiesv1.Sort) activitiessvc.Sort {
	switch s {
	case activitiesv1.Sort_SORT_UNSPECIFIED:
		return activitiessvc.SortUnspecified
	case activitiesv1.Sort_SORT_TOP_RATED:
		return activitiessvc.SortTopRated
	default:
		// ponytail: same out-of-range-wire-value trap as toDomainPriceTier —
		// don't collapse an unrecognized Sort into the legitimate
		// "unspecified" zero value, or service.validSort would silently
		// no-op instead of rejecting it.
		return activitiessvc.Sort("invalid")
	}
}

func toProtoActivity(a activitiessvc.Activity) *activitiesv1.Activity {
	return &activitiesv1.Activity{
		Id:          a.ID,
		Title:       a.Title,
		Description: a.Description,
		Category:    toProtoCategory(a.Category),
		Location:    &activitiesv1.Location{Lat: a.Location.Lat, Lng: a.Location.Lng},
		Country:     a.Country,
		PriceTier:   toProtoPriceTier(a.PriceTier),
		Rating:      a.Rating,
		ImageRefs:   a.ImageRefs,
		Tags:        a.Tags,
		DistanceKm:  a.DistanceKM,
	}
}

func toProtoCategory(c activitiessvc.Category) activitiesv1.Category {
	switch c {
	case activitiessvc.CategoryFoodAndDrink:
		return activitiesv1.Category_CATEGORY_FOOD_AND_DRINK
	case activitiessvc.CategoryHistoryAndCulture:
		return activitiesv1.Category_CATEGORY_HISTORY_AND_CULTURE
	case activitiessvc.CategoryNatureAndOutdoors:
		return activitiesv1.Category_CATEGORY_NATURE_AND_OUTDOORS
	case activitiessvc.CategoryArtAndDesign:
		return activitiesv1.Category_CATEGORY_ART_AND_DESIGN
	case activitiessvc.CategorySports:
		return activitiesv1.Category_CATEGORY_SPORTS
	case activitiessvc.CategoryEntertainmentAndWellness:
		return activitiesv1.Category_CATEGORY_ENTERTAINMENT_AND_WELLNESS
	default:
		return activitiesv1.Category_CATEGORY_UNSPECIFIED
	}
}

func toProtoPriceTier(p activitiessvc.PriceTier) activitiesv1.PriceTier {
	switch p {
	case activitiessvc.PriceTierBudget:
		return activitiesv1.PriceTier_PRICE_TIER_BUDGET
	case activitiessvc.PriceTierModerate:
		return activitiesv1.PriceTier_PRICE_TIER_MODERATE
	case activitiessvc.PriceTierPremium:
		return activitiesv1.PriceTier_PRICE_TIER_PREMIUM
	case activitiessvc.PriceTierLuxury:
		return activitiesv1.PriceTier_PRICE_TIER_LUXURY
	default:
		return activitiesv1.PriceTier_PRICE_TIER_UNSPECIFIED
	}
}
