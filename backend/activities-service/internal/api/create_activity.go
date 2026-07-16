package api

import (
	"context"
	"encoding/json"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

// CreateActivity inserts a new activity (T2). Title and category are the
// only genuinely required fields; status defaults to draft in the service
// layer when unspecified.
func (s *Server) CreateActivity(ctx context.Context, req *activitiesv1.CreateActivityRequest) (*activitiesv1.Activity, error) {
	created, err := s.svc.Create(ctx, activitiessvc.NewActivity{
		Title:       req.GetTitle(),
		Description: req.GetDescription(),
		Category:    toDomainCategory(req.GetCategory()),
		City:        req.GetCity(),
		Address:     req.GetAddress(),
		Status:      toDomainStatus(req.GetStatus()),
		Details:     json.RawMessage(req.GetDetails()),
		Photos:      toDomainPhotos(req.GetPhotos()),
	})
	if err != nil {
		if errors.Is(err, sharederrors.ErrInvalidInput) {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		s.logger.Error("create activity failed", "error", err)
		return nil, status.Error(codes.Internal, "internal error")
	}
	return toProtoActivity(created), nil
}
