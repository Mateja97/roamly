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

func TestListActivities_HappyPath(t *testing.T) {
	fake := &fakeQueryService{
		listOut: activitiessvc.ListResult{
			Activities: []activitiessvc.Activity{{ID: "1", Title: "Kayaking", Category: activitiessvc.CategorySport, Status: activitiessvc.StatusDraft}},
			Total:      1,
			Stats:      activitiessvc.Stats{Total: 5, Published: 2, Draft: 2, Pending: 1},
		},
		listPage: 1, listPageSize: 20,
	}
	client := dialServer(t, fake)

	resp, err := client.ListActivities(context.Background(), &activitiesv1.ListActivitiesRequest{
		Q: "kayak", Category: activitiesv1.Category_CATEGORY_SPORT, City: "Belgrade",
		Status: activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT, Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListActivities() error: %v", err)
	}

	if fake.gotListReq.Q != "kayak" || fake.gotListReq.Category != activitiessvc.CategorySport ||
		fake.gotListReq.City != "Belgrade" || fake.gotListReq.Status != activitiessvc.StatusDraft ||
		fake.gotListReq.Page != 1 || fake.gotListReq.PageSize != 20 {
		t.Errorf("service received request = %+v, translation dropped a filter", fake.gotListReq)
	}

	if len(resp.GetActivities()) != 1 || resp.GetActivities()[0].GetId() != "1" {
		t.Errorf("unexpected activities: %+v", resp.GetActivities())
	}
	if resp.GetTotal() != 1 || resp.GetPage() != 1 || resp.GetPageSize() != 20 {
		t.Errorf("unexpected pagination: total=%d page=%d page_size=%d", resp.GetTotal(), resp.GetPage(), resp.GetPageSize())
	}
	stats := resp.GetStats()
	if stats.GetTotal() != 5 || stats.GetPublished() != 2 || stats.GetDraft() != 2 || stats.GetPending() != 1 {
		t.Errorf("unexpected stats: %+v", stats)
	}
}

func TestListActivities_NoFiltersMapsToUnspecified(t *testing.T) {
	fake := &fakeQueryService{}
	client := dialServer(t, fake)

	if _, err := client.ListActivities(context.Background(), &activitiesv1.ListActivitiesRequest{}); err != nil {
		t.Fatalf("ListActivities() error: %v", err)
	}
	if fake.gotListReq.Category != "" || fake.gotListReq.City != "" || fake.gotListReq.Status != "" || fake.gotListReq.Q != "" {
		t.Errorf("service received request = %+v, want every filter empty", fake.gotListReq)
	}
}

func TestListActivities_InvalidInputMapsTo400(t *testing.T) {
	fake := &fakeQueryService{listErr: fmt.Errorf("listing: %w", sharederrors.ErrInvalidInput)}
	client := dialServer(t, fake)

	_, err := client.ListActivities(context.Background(), &activitiesv1.ListActivitiesRequest{})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("status code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestListActivities_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{listErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.ListActivities(context.Background(), &activitiesv1.ListActivitiesRequest{})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}
