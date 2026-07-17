package api

import (
	"context"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	activitiesv1 "backend/shared/proto/activities/v1"
)

// UploadPhoto decodes, downscales, and stores an admin-uploaded photo (T1):
// activities-service is the sole writer of /data/photos, so image
// processing lives here rather than at proxy-service's HTTP edge.
func (s *Server) UploadPhoto(_ context.Context, req *activitiesv1.UploadPhotoRequest) (*activitiesv1.UploadPhotoResponse, error) {
	url, thumbURL, err := s.photos.Save(req.GetActivityId(), req.GetData())
	if err != nil {
		if errors.Is(err, sharederrors.ErrInvalidInput) {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		s.logger.Error("upload photo failed", "error", err, "activity_id", req.GetActivityId())
		return nil, status.Error(codes.Internal, "internal error")
	}
	return &activitiesv1.UploadPhotoResponse{Url: url, ThumbUrl: thumbURL}, nil
}
