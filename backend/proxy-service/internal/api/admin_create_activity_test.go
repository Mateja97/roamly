package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	activitiesv1 "backend/shared/proto/activities/v1"
)

func doAdminCreateRequest(t *testing.T, h *AdminCreateActivityHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/admin/activities", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.Handle(rec, req)
	return rec
}

func TestAdminCreateActivity_HappyPath(t *testing.T) {
	fake := &fakeAdminActivitiesClient{createOut: &activitiesv1.Activity{
		Id: "new-1", Title: "New Activity", Category: activitiesv1.Category_CATEGORY_SPORT,
		Status: activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT,
	}}
	h := NewAdminCreateActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminCreateRequest(t, h, `{"title":"New Activity","category":"sport","city":"Belgrade","status":"draft","photos":[{"url":"https://example.com/x.jpg","thumb_url":"https://example.com/x_t.jpg","caption":"Sunset"}]}`)

	// Status 200 on create, not 201, per the repo's fixed status contract.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotCreate.GetTitle() != "New Activity" || fake.gotCreate.GetCategory() != activitiesv1.Category_CATEGORY_SPORT ||
		fake.gotCreate.GetCity() != "Belgrade" || fake.gotCreate.GetStatus() != activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT {
		t.Errorf("gRPC request = %+v, a field was dropped in translation", fake.gotCreate)
	}
	if photos := fake.gotCreate.GetPhotos(); len(photos) != 1 || photos[0].GetThumbUrl() != "https://example.com/x_t.jpg" || photos[0].GetCaption() != "Sunset" {
		t.Errorf("gRPC request photos = %+v, want thumb_url/caption translated", photos)
	}
	var got adminActivityDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.ID != "new-1" {
		t.Errorf("unexpected activity: %+v", got)
	}
}

func TestAdminCreateActivity_StatusOmittedDefaultsAtTheService(t *testing.T) {
	fake := &fakeAdminActivitiesClient{createOut: &activitiesv1.Activity{Id: "new-1"}}
	h := NewAdminCreateActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminCreateRequest(t, h, `{"title":"New Activity","category":"sport"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotCreate.GetStatus() != activitiesv1.ActivityStatus_ACTIVITY_STATUS_UNSPECIFIED {
		t.Errorf("gRPC request status = %v, want UNSPECIFIED (default is the service's job)", fake.gotCreate.GetStatus())
	}
}

func TestAdminCreateActivity_MissingTitleIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminCreateActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminCreateRequest(t, h, `{"category":"sport"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotCreate != nil {
		t.Error("gRPC call must not happen once title is rejected at the boundary")
	}
}

func TestAdminCreateActivity_UnknownCategoryIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminCreateActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminCreateRequest(t, h, `{"title":"X","category":"not-a-category"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminCreateActivity_UnknownStatusIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminCreateActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminCreateRequest(t, h, `{"title":"X","category":"sport","status":"archived"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminCreateActivity_MalformedJSONIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminCreateActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminCreateRequest(t, h, `{not-json`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminCreateActivity_ServiceInvalidInputMapsTo400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{createErr: status.Error(codes.InvalidArgument, "title is required")}
	h := NewAdminCreateActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminCreateRequest(t, h, `{"title":"X","category":"sport"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}
