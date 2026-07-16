package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	activitiesv1 "backend/shared/proto/activities/v1"
)

func doAdminListRequest(t *testing.T, h *AdminListActivitiesHandler, rawQuery string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/admin/activities?"+rawQuery, nil)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)
	return rec
}

func TestAdminListActivities_HappyPath(t *testing.T) {
	fake := &fakeAdminActivitiesClient{listOut: &activitiesv1.ListActivitiesResponse{
		Activities: []*activitiesv1.Activity{{
			Id: "1", Title: "Kayaking", Category: activitiesv1.Category_CATEGORY_SPORT,
			City: "Belgrade", Status: activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT, Rating: 4.5,
			Photos: []*activitiesv1.Photo{{Url: "https://example.com/x.jpg"}},
		}},
		Total: 1, Page: 1, PageSize: 20,
		Stats: &activitiesv1.ListActivitiesStats{Total: 5, Published: 2, Draft: 2, Pending: 1},
	}}
	h := NewAdminListActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminListRequest(t, h, "q=kayak&category=sport&city=Belgrade&status=draft&page=1&page_size=20")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}

	if fake.gotList.GetQ() != "kayak" || fake.gotList.GetCategory() != activitiesv1.Category_CATEGORY_SPORT ||
		fake.gotList.GetCity() != "Belgrade" || fake.gotList.GetStatus() != activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT ||
		fake.gotList.GetPage() != 1 || fake.gotList.GetPageSize() != 20 {
		t.Errorf("gRPC request = %+v, a query param was dropped in translation", fake.gotList)
	}

	var got listActivitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Activities) != 1 || got.Activities[0].ID != "1" || got.Activities[0].Category != "sport" || got.Activities[0].Status != "draft" {
		t.Errorf("unexpected list item: %+v", got.Activities)
	}
	if len(got.Activities[0].Photos) != 1 || got.Activities[0].Photos[0].URL != "https://example.com/x.jpg" {
		t.Errorf("unexpected photos shape: %+v", got.Activities[0].Photos)
	}
	if got.Total != 1 || got.Page != 1 || got.PageSize != 20 {
		t.Errorf("unexpected pagination: %+v", got)
	}
	if got.Stats.Total != 5 || got.Stats.Published != 2 || got.Stats.Draft != 2 || got.Stats.Pending != 1 {
		t.Errorf("unexpected stats: %+v", got.Stats)
	}
}

func TestAdminListActivities_NoFilters(t *testing.T) {
	fake := &fakeAdminActivitiesClient{listOut: &activitiesv1.ListActivitiesResponse{Stats: &activitiesv1.ListActivitiesStats{}}}
	h := NewAdminListActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminListRequest(t, h, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotList.GetCategory() != activitiesv1.Category_CATEGORY_UNSPECIFIED || fake.gotList.GetStatus() != activitiesv1.ActivityStatus_ACTIVITY_STATUS_UNSPECIFIED {
		t.Errorf("gRPC request = %+v, want UNSPECIFIED filters when none given", fake.gotList)
	}
}

// TestAdminListActivities_PaginationClampIsSurfacedFromTheService proves
// pagination happens server-side: the handler forwards whatever page_size
// the client sent, and echoes back whatever the service (which owns the
// clamp) actually used — never re-implementing or trusting the clamp
// itself at this layer.
func TestAdminListActivities_PaginationClampIsSurfacedFromTheService(t *testing.T) {
	fake := &fakeAdminActivitiesClient{listOut: &activitiesv1.ListActivitiesResponse{
		Page: 1, PageSize: 100, // the service clamped a huge request down to 100
		Stats: &activitiesv1.ListActivitiesStats{},
	}}
	h := NewAdminListActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminListRequest(t, h, "page_size=100000")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotList.GetPageSize() != 100000 {
		t.Errorf("gRPC request page_size = %d, want the raw requested value forwarded (clamp is the service's job)", fake.gotList.GetPageSize())
	}
	var got listActivitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.PageSize != 100 {
		t.Errorf("response page_size = %d, want the clamped value the service actually used (100)", got.PageSize)
	}
}

func TestAdminListActivities_UnknownCategoryIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminListActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminListRequest(t, h, "category=not-a-category")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotList != nil {
		t.Error("gRPC call must not happen once the category is rejected at the boundary")
	}
}

func TestAdminListActivities_UnknownStatusIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminListActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doAdminListRequest(t, h, "status=archived")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotList != nil {
		t.Error("gRPC call must not happen once the status is rejected at the boundary")
	}
}
