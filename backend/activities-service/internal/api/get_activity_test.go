package api

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

func TestGetActivity_HappyPath(t *testing.T) {
	fake := &fakeQueryService{getOut: activitiessvc.Activity{ID: "1", Title: "Kayaking", Status: activitiessvc.StatusDraft}}
	client := dialServer(t, fake)

	resp, err := client.GetActivity(context.Background(), &activitiesv1.GetActivityRequest{Id: "1"})
	if err != nil {
		t.Fatalf("GetActivity() error: %v", err)
	}
	if resp.GetId() != "1" || resp.GetTitle() != "Kayaking" {
		t.Errorf("unexpected activity: %+v", resp)
	}
	if fake.gotGetID != "1" {
		t.Errorf("service received id = %q, want 1", fake.gotGetID)
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

func TestGetActivity_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{getErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.GetActivity(context.Background(), &activitiesv1.GetActivityRequest{Id: "1"})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}
