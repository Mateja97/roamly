package api

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

func TestGetActivity_HappyPath(t *testing.T) {
	createdAt := time.Date(2026, 8, 5, 12, 30, 0, 0, time.UTC)
	fake := &fakeQueryService{getOut: activitiessvc.Activity{
		ID: "1", Title: "Kayaking", Status: activitiessvc.StatusDraft, CreatedAt: createdAt,
	}}
	client := dialServer(t, fake)

	resp, err := client.GetActivity(context.Background(), &activitiesv1.GetActivityRequest{Id: "1"})
	if err != nil {
		t.Fatalf("GetActivity() error: %v", err)
	}
	if resp.GetId() != "1" || resp.GetTitle() != "Kayaking" {
		t.Errorf("unexpected activity: %+v", resp)
	}
	if resp.GetCreatedAt() != "2026-08-05T12:30:00Z" {
		t.Errorf("created_at = %q, want RFC3339 2026-08-05T12:30:00Z", resp.GetCreatedAt())
	}
	if fake.gotGetID != "1" {
		t.Errorf("service received id = %q, want 1", fake.gotGetID)
	}
	if fake.gotLiveID != "" {
		t.Errorf("admin GetActivity must never call GetByIDWithLiveDetails, got id = %q", fake.gotLiveID)
	}
}

// TestGetActivity_NoResolvedPhotoRendersEmptyPhotoList is T5's
// (places-api-cost-reduction) placeholder-path acceptance criterion: a
// venue with no resolved photo (Photos left nil — the state a newly
// discovered, never-viewed venue is now stored in) must still serialize a
// valid response with an empty photo list, not error or panic — the
// client's missing-image placeholder handles the rest.
func TestGetActivity_NoResolvedPhotoRendersEmptyPhotoList(t *testing.T) {
	fake := &fakeQueryService{getOut: activitiessvc.Activity{
		ID: "1", Title: "New Venue", Status: activitiessvc.StatusPublished, Photos: nil,
	}}
	client := dialServer(t, fake)

	resp, err := client.GetActivity(context.Background(), &activitiesv1.GetActivityRequest{Id: "1"})
	if err != nil {
		t.Fatalf("GetActivity() error: %v", err)
	}
	if len(resp.GetPhotos()) != 0 {
		t.Errorf("resp.GetPhotos() = %+v, want empty", resp.GetPhotos())
	}
}

func TestGetActivity_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeQueryService{getErr: sharederrors.ErrNotFound}
	client := dialServer(t, fake)

	_, err := client.GetActivity(context.Background(), &activitiesv1.GetActivityRequest{Id: "missing"})
	if status.Code(err) != codes.NotFound {
		t.Errorf("status code = %v, want NotFound", status.Code(err))
	}
}

func TestGetActivity_MalformedIDMapsTo400(t *testing.T) {
	fake := &fakeQueryService{getErr: fmt.Errorf("%w: invalid activity id %q", sharederrors.ErrInvalidInput, "not-a-uuid")}
	client := dialServer(t, fake)

	_, err := client.GetActivity(context.Background(), &activitiesv1.GetActivityRequest{Id: "not-a-uuid"})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("status code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestGetActivity_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{getErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.GetActivity(context.Background(), &activitiesv1.GetActivityRequest{Id: "1"})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}
