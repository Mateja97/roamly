package api

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

func TestGetActivityPhotos_HappyPath(t *testing.T) {
	fake := &fakeQueryService{photosOut: []activitiessvc.Photo{
		{URL: "https://example.com/1.jpg", Provider: activitiessvc.ProviderGoogle},
		{URL: "https://example.com/2.jpg", Provider: activitiessvc.ProviderGoogle},
	}}
	client := dialServer(t, fake)

	resp, err := client.GetActivityPhotos(context.Background(), &activitiesv1.GetActivityPhotosRequest{Id: "1"})
	if err != nil {
		t.Fatalf("GetActivityPhotos() error: %v", err)
	}
	if len(resp.GetPhotos()) != 2 {
		t.Fatalf("got %d photos, want 2", len(resp.GetPhotos()))
	}
	if fake.gotPhotosID != "1" {
		t.Errorf("service received id = %q, want 1", fake.gotPhotosID)
	}
}

func TestGetActivityPhotos_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeQueryService{photosErr: sharederrors.ErrNotFound}
	client := dialServer(t, fake)

	_, err := client.GetActivityPhotos(context.Background(), &activitiesv1.GetActivityPhotosRequest{Id: "missing"})
	if status.Code(err) != codes.NotFound {
		t.Errorf("status code = %v, want NotFound", status.Code(err))
	}
}

func TestGetActivityPhotos_MalformedIDMapsTo400(t *testing.T) {
	fake := &fakeQueryService{photosErr: fmt.Errorf("%w: invalid activity id %q", sharederrors.ErrInvalidInput, "not-a-uuid")}
	client := dialServer(t, fake)

	_, err := client.GetActivityPhotos(context.Background(), &activitiesv1.GetActivityPhotosRequest{Id: "not-a-uuid"})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("status code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestGetActivityPhotos_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{photosErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.GetActivityPhotos(context.Background(), &activitiesv1.GetActivityPhotosRequest{Id: "1"})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}
