package api

import (
	"context"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	activitiesv1 "backend/shared/proto/activities/v1"

	"activities-service/internal/service"
)

// ListActivities answers the admin activity list (T2): unlike
// QueryActivities, there is no published-only restriction — the admin needs
// every lifecycle state, filtered only by whatever the request explicitly
// asks for.
func (s *Server) ListActivities(ctx context.Context, req *activitiesv1.ListActivitiesRequest) (*activitiesv1.ListActivitiesResponse, error) {
	result, page, pageSize, err := s.svc.List(ctx, service.ListRequest{
		Q:        req.GetQ(),
		Category: toDomainCategory(req.GetCategory()),
		City:     req.GetCity(),
		Status:   toDomainStatus(req.GetStatus()),
		Page:     int(req.GetPage()),
		PageSize: int(req.GetPageSize()),
	})
	if err != nil {
		if errors.Is(err, sharederrors.ErrInvalidInput) {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		s.logger.Error("list activities failed", "error", err)
		return nil, status.Error(codes.Internal, "internal error")
	}

	activities := make([]*activitiesv1.Activity, len(result.Activities))
	for i, a := range result.Activities {
		activities[i] = toProtoActivity(a)
	}
	return &activitiesv1.ListActivitiesResponse{
		Activities: activities,
		Total:      int32(result.Total),
		Page:       int32(page),
		PageSize:   int32(pageSize),
		Stats: &activitiesv1.ListActivitiesStats{
			Total:     int32(result.Stats.Total),
			Published: int32(result.Stats.Published),
			Draft:     int32(result.Stats.Draft),
			Pending:   int32(result.Stats.Pending),
		},
	}, nil
}
