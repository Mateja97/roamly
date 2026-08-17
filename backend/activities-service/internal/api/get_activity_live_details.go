package api

import (
	"context"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	activitiesv1 "backend/shared/proto/activities/v1"
)

// GetActivityWithLiveDetails returns a single activity by id with live
// Google Place Details merged in for a Places-sourced row (T3,
// places-live-details) — the public detail-page surface. Unlike GetActivity
// (the admin RPC, backed by plain GetByID), this is never persisted back to
// storage — see service.Activities.GetByIDWithLiveDetails's doc.
func (s *Server) GetActivityWithLiveDetails(ctx context.Context, req *activitiesv1.GetActivityRequest) (*activitiesv1.Activity, error) {
	activity, err := s.svc.GetByIDWithLiveDetails(ctx, req.GetId())
	if err != nil {
		if errors.Is(err, sharederrors.ErrNotFound) {
			return nil, status.Error(codes.NotFound, "activity not found")
		}
		if errors.Is(err, sharederrors.ErrInvalidInput) {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		s.logger.Error("get activity with live details failed", "error", err, "id", req.GetId())
		return nil, status.Error(codes.Internal, "internal error")
	}
	return toProtoActivity(activity), nil
}
