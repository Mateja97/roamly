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

func TestCreateActivity_HappyPath(t *testing.T) {
	fake := &fakeQueryService{createOut: activitiessvc.Activity{ID: "new-1", Title: "New Activity", Status: activitiessvc.StatusDraft}}
	client := dialServer(t, fake)

	resp, err := client.CreateActivity(context.Background(), &activitiesv1.CreateActivityRequest{
		Title: "New Activity", Category: activitiesv1.Category_CATEGORY_SPORT, City: "Belgrade",
		Details: `{"difficulty":3}`,
		Photos:  []*activitiesv1.Photo{{Url: "https://example.com/x.jpg"}},
	})
	if err != nil {
		t.Fatalf("CreateActivity() error: %v", err)
	}
	if resp.GetId() != "new-1" {
		t.Errorf("unexpected activity: %+v", resp)
	}
	if fake.gotCreate.Title != "New Activity" || fake.gotCreate.Category != activitiessvc.CategorySport || fake.gotCreate.City != "Belgrade" {
		t.Errorf("service received = %+v, translation dropped a field", fake.gotCreate)
	}
	if string(fake.gotCreate.Details) != `{"difficulty":3}` {
		t.Errorf("service received details = %s, want passthrough", fake.gotCreate.Details)
	}
	if len(fake.gotCreate.Photos) != 1 || fake.gotCreate.Photos[0].URL != "https://example.com/x.jpg" {
		t.Errorf("service received photos = %+v", fake.gotCreate.Photos)
	}
}

func TestCreateActivity_InvalidInputMapsTo400(t *testing.T) {
	fake := &fakeQueryService{createErr: fmt.Errorf("creating: %w", sharederrors.ErrInvalidInput)}
	client := dialServer(t, fake)

	_, err := client.CreateActivity(context.Background(), &activitiesv1.CreateActivityRequest{})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("status code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestCreateActivity_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{createErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.CreateActivity(context.Background(), &activitiesv1.CreateActivityRequest{})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}
