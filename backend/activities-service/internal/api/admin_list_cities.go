package api

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// ListAdminCities powers the admin panel's city filter dropdown (T2): every
// distinct city in the catalog, any status, never just published.
func (s *Server) ListAdminCities(ctx context.Context, _ *activitiesv1.ListAdminCitiesRequest) (*activitiesv1.ListAdminCitiesResponse, error) {
	cities, err := s.svc.AdminListCities(ctx)
	if err != nil {
		s.logger.Error("list admin cities failed", "error", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	return &activitiesv1.ListAdminCitiesResponse{Cities: cities}, nil
}
