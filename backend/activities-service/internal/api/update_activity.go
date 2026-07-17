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
//
// Delete-on-remove (T2): when Photos is present, the pre-write snapshot
// below plus the post-commit diff in unlinkRemovedPhotos are what actually
// prune files off disk — see that function's doc for the guards.
func (s *Server) UpdateActivity(ctx context.Context, req *activitiesv1.UpdateActivityRequest) (*activitiesv1.Activity, error) {
	// Snapshot the current photos[] before the write — the "old" side of
	// the after-commit diff below. Only fetched when this patch actually
	// touches Photos: a patch that doesn't can never remove a photo. A
	// snapshot failure (e.g. the activity is about to 404 anyway) just
	// means nothing gets pruned this round; it never blocks the update.
	var oldPhotos []activitiessvc.Photo
	if req.Photos != nil {
		if current, err := s.svc.GetByID(ctx, req.GetId()); err == nil {
			oldPhotos = current.Photos
		}
	}

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

	// After the commit, never before: Update above already succeeded, so
	// this photos[] is durably persisted — a failed Update returned above
	// and never reaches here, so a failed save can never delete a live
	// photo.
	if req.Photos != nil {
		s.unlinkRemovedPhotos(oldPhotos, *patch.Photos)
	}

	return toProtoActivity(updated), nil
}

// unlinkRemovedPhotos deletes the url and thumb_url files (explicit fields,
// never a reconstructed "_t.jpg" filename) of every oldPhotos entry whose
// url no longer appears in newPhotos (T2). Compared by url, so a photo
// removed then re-added within the same save survives untouched. Guards
// live in photoStore.Unlink (Google-sourced URLs skipped, traversal
// rejected); any failure it returns, guard or real removal error alike, is
// logged at warn here and never fails the request — an orphaned file is a
// lesser harm than a failed save.
func (s *Server) unlinkRemovedPhotos(oldPhotos, newPhotos []activitiessvc.Photo) {
	keep := make(map[string]bool, len(newPhotos))
	for _, p := range newPhotos {
		keep[p.URL] = true
	}
	for _, p := range oldPhotos {
		if keep[p.URL] {
			continue
		}
		if err := s.photos.Unlink(p.URL); err != nil {
			s.logger.Warn("unlink photo failed", "error", err, "url", p.URL)
		}
		if p.ThumbURL != "" {
			if err := s.photos.Unlink(p.ThumbURL); err != nil {
				s.logger.Warn("unlink photo thumb failed", "error", err, "url", p.ThumbURL)
			}
		}
	}
}
