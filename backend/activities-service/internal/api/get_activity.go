package api

import (
	"context"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	activitiesv1 "backend/shared/proto/activities/v1"
)

// GetActivity returns a single activity by id, including every lifecycle
// state (T2's admin surface).
func (s *Server) GetActivity(ctx context.Context, req *activitiesv1.GetActivityRequest) (*activitiesv1.Activity, error) {
	activity, err := s.svc.GetByID(ctx, req.GetId())
	if err != nil {
		if errors.Is(err, sharederrors.ErrNotFound) {
			return nil, status.Error(codes.NotFound, "activity not found")
		}
		if errors.Is(err, sharederrors.ErrInvalidInput) {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		s.logger.Error("get activity failed", "error", err, "id", req.GetId())
		return nil, status.Error(codes.Internal, "internal error")
	}
	return toProtoActivity(activity), nil
}
