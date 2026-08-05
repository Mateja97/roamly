package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
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
		Photos:    []*activitiesv1.Photo{{Url: "https://example.com/x.jpg", ThumbUrl: "https://example.com/x_t.jpg", Caption: "Sunset"}},
		Location:  &activitiesv1.Location{Lat: 44.7866, Lng: 20.4489},
		CreatedAt: "2026-08-05T12:30:00Z",
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
	if len(got.Photos) != 1 || got.Photos[0].ThumbURL != "https://example.com/x_t.jpg" || got.Photos[0].Caption != "Sunset" {
		t.Errorf("unexpected photo translation: %+v", got.Photos)
	}
	if string(got.Details) != `{"difficulty":3}` {
		t.Errorf("details = %s, want passthrough", got.Details)
	}
	if got.Location == nil || got.Location.Lat != 44.7866 || got.Location.Lng != 20.4489 {
		t.Errorf("location = %+v, want {44.7866, 20.4489}", got.Location)
	}
	if got.CreatedAt != "2026-08-05T12:30:00Z" {
		t.Errorf("created_at = %q, want passthrough", got.CreatedAt)
	}
}

func TestAdminGetActivity_NoCoordinatesOmitsLocation(t *testing.T) {
	// Null Island: repository.Create's (0,0) sentinel for an admin-created
	// row with no geocoding yet — must never render as a real coordinate.
	fake := &fakeAdminActivitiesClient{getOut: &activitiesv1.Activity{
		Id: "1", Title: "Admin Created", Location: &activitiesv1.Location{Lat: 0, Lng: 0},
	}}
	h := NewAdminGetActivityHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/admin/activities/1", nil)
	req.SetPathValue("id", "1")
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	var got adminActivityDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.Location != nil {
		t.Errorf("location = %+v, want nil for (0,0)", got.Location)
	}
	if !strings.Contains(rec.Body.String(), `"details"`) {
		t.Fatalf("sanity: unexpected body shape: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"location"`) {
		t.Errorf("body = %s, want no location key at all (omitempty)", rec.Body.String())
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
