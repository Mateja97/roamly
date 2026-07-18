package api

import (
	"context"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	activitiesv1 "backend/shared/proto/activities/v1"
)

// GetActivityPhotos returns one activity's full photo set (T2): resolves
// the rest of a venue's Google photos live on first view and persists them
// — see service.Activities.GetPhotos's doc for the resolve-once-cache-forever
// and timeout/fallback rules. Only errors when the activity itself doesn't
// exist; a Places failure/timeout is handled entirely inside GetPhotos.
func (s *Server) GetActivityPhotos(ctx context.Context, req *activitiesv1.GetActivityPhotosRequest) (*activitiesv1.GetActivityPhotosResponse, error) {
	photos, err := s.svc.GetPhotos(ctx, req.GetId())
	if err != nil {
		if errors.Is(err, sharederrors.ErrNotFound) {
			return nil, status.Error(codes.NotFound, "activity not found")
		}
		s.logger.Error("get activity photos failed", "error", err, "id", req.GetId())
		return nil, status.Error(codes.Internal, "internal error")
	}
	return &activitiesv1.GetActivityPhotosResponse{Photos: toProtoPhotos(photos)}, nil
}
