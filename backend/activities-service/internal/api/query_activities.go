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
	SuggestCities(ctx context.Context, query string) ([]activitiessvc.CitySuggestion, error)
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
	cities := make([]activitiessvc.Point, 0, len(req.GetCities()))
	for _, c := range req.GetCities() {
		cities = append(cities, activitiessvc.Point{Lat: c.GetLat(), Lng: c.GetLng()})
	}
	return service.Request{
		Scope:           toDomainScope(req.GetScope()),
		CurrentLocation: toDomainPoint(req.GetCurrentLocation()),
		Cities:          cities,
		Categories:      categories,
		MinRating:       req.GetMinRating(),
		MaxDistanceKM:   req.GetMaxDistanceKm(),
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
	case activitiesv1.Scope_SCOPE_NEARBY:
		return activitiessvc.ScopeNearby
	case activitiesv1.Scope_SCOPE_ANYWHERE:
		return activitiessvc.ScopeAnywhere
	default:
		return "" // service layer rejects this as an unknown scope
	}
}

func toDomainCategory(c activitiesv1.Category) activitiessvc.Category {
	switch c {
	case activitiesv1.Category_CATEGORY_RESTAURANTS:
		return activitiessvc.CategoryRestaurants
	case activitiesv1.Category_CATEGORY_CAFES:
		return activitiessvc.CategoryCafes
	case activitiesv1.Category_CATEGORY_BARS:
		return activitiessvc.CategoryBars
	case activitiesv1.Category_CATEGORY_NIGHTLIFE:
		return activitiessvc.CategoryNightlife
	case activitiesv1.Category_CATEGORY_NATURE:
		return activitiessvc.CategoryNature
	case activitiesv1.Category_CATEGORY_SPORT:
		return activitiessvc.CategorySport
	case activitiesv1.Category_CATEGORY_KIDS:
		return activitiessvc.CategoryKids
	case activitiesv1.Category_CATEGORY_CULTURE:
		return activitiessvc.CategoryCulture
	case activitiesv1.Category_CATEGORY_ART:
		return activitiessvc.CategoryArt
	case activitiesv1.Category_CATEGORY_WELLNESS:
		return activitiessvc.CategoryWellness
	case activitiesv1.Category_CATEGORY_SHOPPING:
		return activitiessvc.CategoryShopping
	case activitiesv1.Category_CATEGORY_ENTERTAINMENT:
		return activitiessvc.CategoryEntertainment
	default:
		return "" // service layer rejects this as an unknown category
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
		Rating:      a.Rating,
		Photos:      toProtoPhotos(a.Photos),
		Tags:        a.Tags,
		DistanceKm:  a.DistanceKM,
		Details:     detailsJSON(a.Details),
		City:        a.City,
		Address:     a.Address,
		Status:      toProtoStatus(a.Status),
	}
}

// toProtoStatus maps the domain lifecycle value onto the wire enum (T1); an
// unrecognized domain value (shouldn't happen — the DB CHECK constraint
// guards it) falls back to ACTIVITY_STATUS_UNSPECIFIED rather than panicking.
func toProtoStatus(s activitiessvc.Status) activitiesv1.ActivityStatus {
	switch s {
	case activitiessvc.StatusPublished:
		return activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED
	case activitiessvc.StatusDraft:
		return activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT
	case activitiessvc.StatusPending:
		return activitiesv1.ActivityStatus_ACTIVITY_STATUS_PENDING
	default:
		return activitiesv1.ActivityStatus_ACTIVITY_STATUS_UNSPECIFIED
	}
}

// detailsJSON stringifies the details column for the wire; the DB column is
// NOT NULL DEFAULT '{}' so this is a defensive fallback, not the normal path.
func detailsJSON(details []byte) string {
	if len(details) == 0 {
		return "{}"
	}
	return string(details)
}

func toProtoPhotos(photos []activitiessvc.Photo) []*activitiesv1.Photo {
	out := make([]*activitiesv1.Photo, len(photos))
	for i, p := range photos {
		out[i] = &activitiesv1.Photo{Url: p.URL, Author: p.Author, AuthorLink: p.AuthorLink}
	}
	return out
}

func toProtoCategory(c activitiessvc.Category) activitiesv1.Category {
	switch c {
	case activitiessvc.CategoryRestaurants:
		return activitiesv1.Category_CATEGORY_RESTAURANTS
	case activitiessvc.CategoryCafes:
		return activitiesv1.Category_CATEGORY_CAFES
	case activitiessvc.CategoryBars:
		return activitiesv1.Category_CATEGORY_BARS
	case activitiessvc.CategoryNightlife:
		return activitiesv1.Category_CATEGORY_NIGHTLIFE
	case activitiessvc.CategoryNature:
		return activitiesv1.Category_CATEGORY_NATURE
	case activitiessvc.CategorySport:
		return activitiesv1.Category_CATEGORY_SPORT
	case activitiessvc.CategoryKids:
		return activitiesv1.Category_CATEGORY_KIDS
	case activitiessvc.CategoryCulture:
		return activitiesv1.Category_CATEGORY_CULTURE
	case activitiessvc.CategoryArt:
		return activitiesv1.Category_CATEGORY_ART
	case activitiessvc.CategoryWellness:
		return activitiesv1.Category_CATEGORY_WELLNESS
	case activitiessvc.CategoryShopping:
		return activitiesv1.Category_CATEGORY_SHOPPING
	case activitiessvc.CategoryEntertainment:
		return activitiesv1.Category_CATEGORY_ENTERTAINMENT
	default:
		return activitiesv1.Category_CATEGORY_UNSPECIFIED
	}
}
