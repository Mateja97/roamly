package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	activitiesv1 "backend/shared/proto/activities/v1"
)

func TestAdminGetActivity_HappyPath(t *testing.T) {
	fake := &fakeAdminActivitiesClient{getOut: &activitiesv1.Activity{
		Id: "1", Title: "Kayaking", Description: "fun", Category: activitiesv1.Category_CATEGORY_SPORT,
		City: "Belgrade", Address: "Ada Ciganlija bb", Status: activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT,
		Rating: 4.5, Details: `{"difficulty":3}`,
		Photos: []*activitiesv1.Photo{{Url: "https://example.com/x.jpg"}},
	}}
	h := NewAdminGetActivityHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/admin/activities/1", nil)
	req.SetPathValue("id", "1")
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotGet.GetId() != "1" {
		t.Errorf("gRPC request id = %q, want 1", fake.gotGet.GetId())
	}
	var got adminActivityDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.ID != "1" || got.Description != "fun" || got.Address != "Ada Ciganlija bb" || got.Status != "draft" {
		t.Errorf("unexpected activity: %+v", got)
	}
	if string(got.Details) != `{"difficulty":3}` {
		t.Errorf("details = %s, want passthrough", got.Details)
	}
}

func TestAdminGetActivity_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeAdminActivitiesClient{getErr: status.Error(codes.NotFound, "activity not found")}
	h := NewAdminGetActivityHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/admin/activities/missing", nil)
	req.SetPathValue("id", "missing")
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminGetActivity_InternalErrorMapsTo500(t *testing.T) {
	fake := &fakeAdminActivitiesClient{getErr: status.Error(codes.Internal, "internal error")}
	h := NewAdminGetActivityHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/admin/activities/1", nil)
	req.SetPathValue("id", "1")
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body = %s", rec.Code, rec.Body.String())
	}
}
