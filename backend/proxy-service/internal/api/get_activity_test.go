package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	activitiesv1 "backend/shared/proto/activities/v1"
)

type fakeActivitiesLiveDetailsClient struct {
	resp *activitiesv1.Activity
	err  error
	got  *activitiesv1.GetActivityRequest
}

func (f *fakeActivitiesLiveDetailsClient) GetActivityWithLiveDetails(_ context.Context, req *activitiesv1.GetActivityRequest) (*activitiesv1.Activity, error) {
	f.got = req
	return f.resp, f.err
}

func doGetActivityRequest(t *testing.T, h *GetActivityHandler, id string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/activities/"+id, nil)
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)
	return rec
}

func TestGetActivityHandler_HappyPath(t *testing.T) {
	fake := &fakeActivitiesLiveDetailsClient{resp: &activitiesv1.Activity{
		Id:            "activity-1",
		Title:         "Kayaking",
		Category:      activitiesv1.Category_CATEGORY_SPORT,
		Status:        activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED,
		Details:       "{}",
		Rating:        4.7,
		ReviewCount:   214,
		GoogleMapsUri: "https://maps.google.com/?cid=123",
		GoogleReviews: []*activitiesv1.GoogleReview{
			{
				AuthorAttribution: &activitiesv1.GoogleAuthorAttribution{DisplayName: "Jane Doe", PhotoUri: "https://example.com/jane.jpg", Uri: "https://example.com/jane"},
				Rating:            5,
				Text:              "Great spot",
				PublishTime:       "2026-07-01T00:00:00Z",
			},
		},
	}}
	h := NewGetActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doGetActivityRequest(t, h, "activity-1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if fake.got.GetId() != "activity-1" {
		t.Errorf("gRPC request id = %q, want activity-1", fake.got.GetId())
	}
	var got activityDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.ID != "activity-1" || got.Title != "Kayaking" {
		t.Errorf("unexpected activity: %+v", got)
	}
	if got.ReviewCount != 214 {
		t.Errorf("ReviewCount = %d, want 214", got.ReviewCount)
	}
	if got.GoogleMapsURI != "https://maps.google.com/?cid=123" {
		t.Errorf("GoogleMapsURI = %q, want the live URI", got.GoogleMapsURI)
	}
	if len(got.GoogleReviews) != 1 || got.GoogleReviews[0].AuthorAttribution.DisplayName != "Jane Doe" || got.GoogleReviews[0].Text != "Great spot" {
		t.Errorf("unexpected google reviews: %+v", got.GoogleReviews)
	}
}

func TestGetActivityHandler_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeActivitiesLiveDetailsClient{err: status.Error(codes.NotFound, "activity not found")}
	h := NewGetActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doGetActivityRequest(t, h, "missing")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestGetActivityHandler_InternalErrorMapsTo500(t *testing.T) {
	fake := &fakeActivitiesLiveDetailsClient{err: status.Error(codes.Internal, "internal error")}
	h := NewGetActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doGetActivityRequest(t, h, "activity-1")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}
