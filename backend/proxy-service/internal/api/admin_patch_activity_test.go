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

func doAdminPatchRequest(t *testing.T, h *AdminPatchActivityHandler, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/admin/activities/"+id, bytes.NewBufferString(body))
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)
	return rec
}

// TestAdminPatchActivity_OmittedFieldsStayNilOnTheWire is the acceptance
// criterion's subtle case: a PATCH body naming only "title" must leave
// every other field nil in the gRPC request (proto3 optional's has-bit),
// not zeroed/blanked — a plain non-pointer struct couldn't make this
// distinction at all.
func TestAdminPatchActivity_OmittedFieldsStayNilOnTheWire(t *testing.T) {
	fake := &fakeAdminActivitiesClient{updateOut: &activitiesv1.Activity{Id: "1", Title: "New Title"}}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"title":"New Title"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}

	req := fake.gotUpdate
	if req.Title == nil || *req.Title != "New Title" {
		t.Errorf("Title = %v, want New Title", req.Title)
	}
	if req.Description != nil || req.City != nil || req.Address != nil || req.Category != nil ||
		req.Status != nil || req.Details != nil || req.Photos != nil || req.Subcategory != nil {
		t.Errorf("request = %+v, want every omitted field nil (untouched)", req)
	}
}

// TestAdminPatchActivity_EmptyStringIsSetNotOmitted is the other half of
// the same acceptance criterion: a field explicitly set to "" must be
// distinguishable from an omitted field — both are legal, different
// intents.
func TestAdminPatchActivity_EmptyStringIsSetNotOmitted(t *testing.T) {
	fake := &fakeAdminActivitiesClient{updateOut: &activitiesv1.Activity{Id: "1"}}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"address":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpdate.Address == nil {
		t.Fatal("Address = nil, want a non-nil pointer to an empty string (present, cleared) — not treated the same as omitted")
	}
	if *fake.gotUpdate.Address != "" {
		t.Errorf("Address = %q, want empty string", *fake.gotUpdate.Address)
	}
	if fake.gotUpdate.Title != nil {
		t.Error("Title must stay nil: it wasn't in the PATCH body")
	}
}

func TestAdminPatchActivity_CategoryAndStatusChangeTranslate(t *testing.T) {
	fake := &fakeAdminActivitiesClient{updateOut: &activitiesv1.Activity{Id: "1"}}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"category":"art","status":"published"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpdate.Category == nil || *fake.gotUpdate.Category != activitiesv1.Category_CATEGORY_ART {
		t.Errorf("Category = %v, want ART", fake.gotUpdate.Category)
	}
	if fake.gotUpdate.Status == nil || *fake.gotUpdate.Status != activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED {
		t.Errorf("Status = %v, want PUBLISHED", fake.gotUpdate.Status)
	}
}

func TestAdminPatchActivity_PhotosReplacement(t *testing.T) {
	fake := &fakeAdminActivitiesClient{updateOut: &activitiesv1.Activity{Id: "1"}}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"photos":[{"url":"https://example.com/a.jpg","thumb_url":"https://example.com/a_t.jpg","caption":"Sunset"}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpdate.Photos == nil || len(fake.gotUpdate.Photos.GetPhotos()) != 1 || fake.gotUpdate.Photos.GetPhotos()[0].GetUrl() != "https://example.com/a.jpg" {
		t.Errorf("Photos = %v, want the one submitted photo", fake.gotUpdate.Photos)
	}
	if got := fake.gotUpdate.Photos.GetPhotos()[0]; got.GetThumbUrl() != "https://example.com/a_t.jpg" || got.GetCaption() != "Sunset" {
		t.Errorf("Photos[0] = %+v, want thumb_url/caption translated", got)
	}
}

func TestAdminPatchActivity_SubcategoryPassesThrough(t *testing.T) {
	fake := &fakeAdminActivitiesClient{updateOut: &activitiesv1.Activity{Id: "1"}}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"subcategory":"fine_dining"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpdate.Subcategory == nil || *fake.gotUpdate.Subcategory != "fine_dining" {
		t.Errorf("Subcategory = %v, want fine_dining", fake.gotUpdate.Subcategory)
	}
}

func TestAdminPatchActivity_WrongCategorySubcategoryIs400WhenBothSet(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"category":"restaurants","subcategory":"cocktail_bar"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpdate != nil {
		t.Error("gRPC call must not happen once subcategory is rejected at the boundary")
	}
}

func TestAdminPatchActivity_UnknownCategoryIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"category":"not-a-category"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpdate != nil {
		t.Error("gRPC call must not happen once the category is rejected at the boundary")
	}
}

func TestAdminPatchActivity_UnknownStatusIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"status":"archived"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminPatchActivity_MalformedJSONIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{not-json`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminPatchActivity_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeAdminActivitiesClient{updateErr: status.Error(codes.NotFound, "activity not found")}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "missing", `{"title":"X"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminPatchActivity_ResponseIsTheFullActivityDTO(t *testing.T) {
	fake := &fakeAdminActivitiesClient{updateOut: &activitiesv1.Activity{
		Id: "1", Title: "Updated", Description: "d", Category: activitiesv1.Category_CATEGORY_ART,
		City: "Paris", Address: "rue de X", Status: activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED,
		Rating: 4.2, Details: "{}",
	}}
	h := NewAdminPatchActivityHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminPatchRequest(t, h, "1", `{"title":"Updated"}`)
	var got adminActivityDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.Title != "Updated" || got.City != "Paris" || got.Status != "published" {
		t.Errorf("unexpected response: %+v", got)
	}
}
