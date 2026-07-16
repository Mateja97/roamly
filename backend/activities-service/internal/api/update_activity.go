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

// UpdateActivity applies a partial update (T2): req's proto3 `optional`
// fields are already nil/non-nil exactly the way activitiessvc.UpdatePatch
// wants them for string/enum fields, so most of them assign straight
// across; Category/Status/Details need a type change along the way, and
// Photos unwraps its PhotoList presence wrapper.
func (s *Server) UpdateActivity(ctx context.Context, req *activitiesv1.UpdateActivityRequest) (*activitiesv1.Activity, error) {
	patch := activitiessvc.UpdatePatch{
		Title:       req.Title,
		Description: req.Description,
		City:        req.City,
		Address:     req.Address,
	}
	if req.Category != nil {
		cat := toDomainCategory(*req.Category)
		patch.Category = &cat
	}
	if req.Status != nil {
		st := toDomainStatus(*req.Status)
		patch.Status = &st
	}
	if req.Details != nil {
		details := json.RawMessage(*req.Details)
		patch.Details = &details
	}
	if req.Photos != nil {
		photos := toDomainPhotos(req.Photos.GetPhotos())
		patch.Photos = &photos
	}

	updated, err := s.svc.Update(ctx, req.GetId(), patch)
	if err != nil {
		switch {
		case errors.Is(err, sharederrors.ErrNotFound):
			return nil, status.Error(codes.NotFound, "activity not found")
		case errors.Is(err, sharederrors.ErrInvalidInput):
			return nil, status.Error(codes.InvalidArgument, err.Error())
		default:
			s.logger.Error("update activity failed", "error", err, "id", req.GetId())
			return nil, status.Error(codes.Internal, "internal error")
		}
	}
	return toProtoActivity(updated), nil
}
