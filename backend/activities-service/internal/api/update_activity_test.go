package api

import (
	"context"
	"errors"
	"fmt"
	"testing"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestUpdateActivity_OnlySetFieldsReachTheService(t *testing.T) {
	fake := &fakeQueryService{updateOut: activitiessvc.Activity{ID: "1", Title: "Updated"}}
	client := dialServer(t, fake)

	newTitle := "New Title"
	newStatus := activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED
	resp, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Title: &newTitle, Status: &newStatus,
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if resp.GetId() != "1" {
		t.Errorf("unexpected activity: %+v", resp)
	}
	if fake.gotUpdateID != "1" {
		t.Errorf("service received id = %q, want 1", fake.gotUpdateID)
	}
	patch := fake.gotUpdatePtch
	if patch.Title == nil || *patch.Title != "New Title" {
		t.Errorf("patch.Title = %v, want New Title", patch.Title)
	}
	if patch.Status == nil || *patch.Status != activitiessvc.StatusPublished {
		t.Errorf("patch.Status = %v, want published", patch.Status)
	}
	if patch.Description != nil || patch.Category != nil || patch.City != nil || patch.Address != nil || patch.Details != nil || patch.Photos != nil {
		t.Errorf("patch = %+v, want every omitted field nil (untouched)", patch)
	}
}

func TestUpdateActivity_PhotosPresenceUnwrapsThePhotoListWrapper(t *testing.T) {
	fake := &fakeQueryService{}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id:     "1",
		Photos: &activitiesv1.PhotoList{Photos: []*activitiesv1.Photo{{Url: "https://example.com/x.jpg"}}},
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if fake.gotUpdatePtch.Photos == nil || len(*fake.gotUpdatePtch.Photos) != 1 || (*fake.gotUpdatePtch.Photos)[0].URL != "https://example.com/x.jpg" {
		t.Errorf("patch.Photos = %v, want the one submitted photo", fake.gotUpdatePtch.Photos)
	}
}

func TestUpdateActivity_EmptyPhotoListIsPresentButEmpty(t *testing.T) {
	fake := &fakeQueryService{}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{
		Id: "1", Photos: &activitiesv1.PhotoList{},
	})
	if err != nil {
		t.Fatalf("UpdateActivity() error: %v", err)
	}
	if fake.gotUpdatePtch.Photos == nil {
		t.Fatal("patch.Photos = nil, want non-nil (present, even though empty) since PhotoList was set on the wire")
	}
	if len(*fake.gotUpdatePtch.Photos) != 0 {
		t.Errorf("patch.Photos = %v, want empty", *fake.gotUpdatePtch.Photos)
	}
}

func TestUpdateActivity_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeQueryService{updateErr: sharederrors.ErrNotFound}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{Id: "missing"})
	if status.Code(err) != codes.NotFound {
		t.Errorf("status code = %v, want NotFound", status.Code(err))
	}
}

func TestUpdateActivity_InvalidInputMapsTo400(t *testing.T) {
	fake := &fakeQueryService{updateErr: fmt.Errorf("updating: %w", sharederrors.ErrInvalidInput)}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{Id: "1"})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("status code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestUpdateActivity_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{updateErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.UpdateActivity(context.Background(), &activitiesv1.UpdateActivityRequest{Id: "1"})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}
