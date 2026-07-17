package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	activitiesv1 "backend/shared/proto/activities/v1"
)

func TestUploadPhoto_HappyPath(t *testing.T) {
	fake := &fakeQueryService{saveURL: "/photos/1/abc.jpg", saveThumbURL: "/photos/1/abc_t.jpg"}
	client := dialServer(t, fake)

	resp, err := client.UploadPhoto(context.Background(), &activitiesv1.UploadPhotoRequest{
		ActivityId: "1", Data: []byte("fake-bytes"),
	})
	if err != nil {
		t.Fatalf("UploadPhoto() error: %v", err)
	}
	if resp.GetUrl() != "/photos/1/abc.jpg" || resp.GetThumbUrl() != "/photos/1/abc_t.jpg" {
		t.Errorf("unexpected response: %+v", resp)
	}
	if fake.gotSaveActivityID != "1" || !bytes.Equal(fake.gotSaveData, []byte("fake-bytes")) {
		t.Errorf("store received activityID=%q data=%q, translation dropped a field", fake.gotSaveActivityID, fake.gotSaveData)
	}
}

func TestUploadPhoto_InvalidInputMapsTo400(t *testing.T) {
	fake := &fakeQueryService{saveErr: fmt.Errorf("%w: not a decodable image", sharederrors.ErrInvalidInput)}
	client := dialServer(t, fake)

	_, err := client.UploadPhoto(context.Background(), &activitiesv1.UploadPhotoRequest{ActivityId: "1", Data: []byte("x")})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("status code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestUploadPhoto_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{saveErr: errors.New("disk full")}
	client := dialServer(t, fake)

	_, err := client.UploadPhoto(context.Background(), &activitiesv1.UploadPhotoRequest{ActivityId: "1", Data: []byte("x")})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}
