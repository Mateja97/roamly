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

func TestGetActivityWithLiveDetails_HappyPath(t *testing.T) {
	fake := &fakeQueryService{liveOut: activitiessvc.Activity{
		ID:            "1",
		Title:         "Kayaking",
		Status:        activitiessvc.StatusPublished,
		Rating:        4.7,
		ReviewCount:   214,
		GoogleMapsURI: "https://maps.google.com/?cid=123",
		GoogleReviews: []activitiessvc.GoogleReview{
			{
				AuthorAttribution: activitiessvc.GoogleAuthorAttribution{DisplayName: "Jane Doe", PhotoURI: "https://example.com/jane.jpg", URI: "https://example.com/jane"},
				Rating:            5,
				Text:              "Great spot",
				PublishTime:       "2026-07-01T00:00:00Z",
			},
		},
	}}
	client := dialServer(t, fake)

	resp, err := client.GetActivityWithLiveDetails(context.Background(), &activitiesv1.GetActivityRequest{Id: "1"})
	if err != nil {
		t.Fatalf("GetActivityWithLiveDetails() error: %v", err)
	}
	if fake.gotLiveID != "1" {
		t.Errorf("service received id = %q, want 1", fake.gotLiveID)
	}
	if fake.gotGetID != "" {
		t.Errorf("plain GetByID must never be called by the live-details RPC, got id = %q", fake.gotGetID)
	}
	if resp.GetId() != "1" || resp.GetTitle() != "Kayaking" {
		t.Errorf("unexpected activity: %+v", resp)
	}
	if resp.GetReviewCount() != 214 {
		t.Errorf("ReviewCount = %d, want 214", resp.GetReviewCount())
	}
	if resp.GetGoogleMapsUri() != "https://maps.google.com/?cid=123" {
		t.Errorf("GoogleMapsUri = %q, want the live URI", resp.GetGoogleMapsUri())
	}
	if len(resp.GetGoogleReviews()) != 1 {
		t.Fatalf("GoogleReviews len = %d, want 1", len(resp.GetGoogleReviews()))
	}
	gr := resp.GetGoogleReviews()[0]
	if gr.GetAuthorAttribution().GetDisplayName() != "Jane Doe" || gr.GetText() != "Great spot" || gr.GetPublishTime() != "2026-07-01T00:00:00Z" {
		t.Errorf("unexpected review: %+v", gr)
	}
}

func TestGetActivityWithLiveDetails_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeQueryService{liveErr: sharederrors.ErrNotFound}
	client := dialServer(t, fake)

	_, err := client.GetActivityWithLiveDetails(context.Background(), &activitiesv1.GetActivityRequest{Id: "missing"})
	if status.Code(err) != codes.NotFound {
		t.Errorf("status code = %v, want NotFound", status.Code(err))
	}
}

func TestGetActivityWithLiveDetails_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{liveErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.GetActivityWithLiveDetails(context.Background(), &activitiesv1.GetActivityRequest{Id: "1"})
	if status.Code(err) != codes.Internal {
		t.Errorf("status code = %v, want Internal", status.Code(err))
	}
}
