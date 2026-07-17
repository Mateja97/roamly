package api

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// fakeAdminActivitiesClient is shared by every admin (T2) handler test in
// this package.
type fakeAdminActivitiesClient struct {
	listOut *activitiesv1.ListActivitiesResponse
	listErr error
	gotList *activitiesv1.ListActivitiesRequest

	getOut *activitiesv1.Activity
	getErr error
	gotGet *activitiesv1.GetActivityRequest

	createOut *activitiesv1.Activity
	createErr error
	gotCreate *activitiesv1.CreateActivityRequest

	updateOut *activitiesv1.Activity
	updateErr error
	gotUpdate *activitiesv1.UpdateActivityRequest

	uploadOut *activitiesv1.UploadPhotoResponse
	uploadErr error
	gotUpload *activitiesv1.UploadPhotoRequest

	citiesOut *activitiesv1.ListAdminCitiesResponse
	citiesErr error
}

func (f *fakeAdminActivitiesClient) ListActivities(_ context.Context, req *activitiesv1.ListActivitiesRequest) (*activitiesv1.ListActivitiesResponse, error) {
	f.gotList = req
	return f.listOut, f.listErr
}

func (f *fakeAdminActivitiesClient) GetActivity(_ context.Context, req *activitiesv1.GetActivityRequest) (*activitiesv1.Activity, error) {
	f.gotGet = req
	return f.getOut, f.getErr
}

func (f *fakeAdminActivitiesClient) CreateActivity(_ context.Context, req *activitiesv1.CreateActivityRequest) (*activitiesv1.Activity, error) {
	f.gotCreate = req
	return f.createOut, f.createErr
}

func (f *fakeAdminActivitiesClient) UpdateActivity(_ context.Context, req *activitiesv1.UpdateActivityRequest) (*activitiesv1.Activity, error) {
	f.gotUpdate = req
	return f.updateOut, f.updateErr
}

func (f *fakeAdminActivitiesClient) UploadPhoto(_ context.Context, req *activitiesv1.UploadPhotoRequest) (*activitiesv1.UploadPhotoResponse, error) {
	f.gotUpload = req
	return f.uploadOut, f.uploadErr
}

func (f *fakeAdminActivitiesClient) ListAdminCities(_ context.Context, _ *activitiesv1.ListAdminCitiesRequest) (*activitiesv1.ListAdminCitiesResponse, error) {
	return f.citiesOut, f.citiesErr
}

// TestRegisterAdminRoutes_TokenUnsetLeavesRoutesEntirelyAbsent proves the
// fail-closed acceptance criterion directly: an empty ADMIN_API_TOKEN must
// not register the /admin/* routes at all. A 403 would mean the route
// exists but auth rejected the request; the mux's own 404 (no pattern
// registered) is the only response that proves absence.
func TestRegisterAdminRoutes_TokenUnsetLeavesRoutesEntirelyAbsent(t *testing.T) {
	mux := http.NewServeMux()
	registered := RegisterAdminRoutes(mux, &fakeAdminActivitiesClient{}, "", slog.New(slog.DiscardHandler))
	if registered {
		t.Fatal("RegisterAdminRoutes() = true with an empty token, want false")
	}

	req := httptest.NewRequest(http.MethodGet, "/admin/activities", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /admin/activities with no token configured = %d, want 404 (route not registered)", rec.Code)
	}
}

func TestRegisterAdminRoutes_TokenSetRegistersEveryRoute(t *testing.T) {
	mux := http.NewServeMux()
	client := &fakeAdminActivitiesClient{
		listOut:   &activitiesv1.ListActivitiesResponse{Stats: &activitiesv1.ListActivitiesStats{}},
		getOut:    &activitiesv1.Activity{},
		createOut: &activitiesv1.Activity{},
		updateOut: &activitiesv1.Activity{},
		citiesOut: &activitiesv1.ListAdminCitiesResponse{},
	}
	if !RegisterAdminRoutes(mux, client, "secret", slog.New(slog.DiscardHandler)) {
		t.Fatal("RegisterAdminRoutes() = false with a non-empty token, want true")
	}

	tests := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/admin/activities"},
		{http.MethodGet, "/admin/activities/1"},
		{http.MethodPatch, "/admin/activities/1"},
		{http.MethodPost, "/admin/activities"},
		{http.MethodPost, "/admin/activities/1/photos"},
		{http.MethodGet, "/admin/cities"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			req.Header.Set("X-Admin-Token", "secret")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code == http.StatusNotFound {
				t.Errorf("%s %s = 404, want the route registered", tt.method, tt.path)
			}
		})
	}
}

func TestRegisterAdminRoutes_WrongTokenIsRejectedOnEveryRoute(t *testing.T) {
	mux := http.NewServeMux()
	RegisterAdminRoutes(mux, &fakeAdminActivitiesClient{}, "secret", slog.New(slog.DiscardHandler))

	tests := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/admin/activities"},
		{http.MethodGet, "/admin/activities/1"},
		{http.MethodPatch, "/admin/activities/1"},
		{http.MethodPost, "/admin/activities"},
		{http.MethodPost, "/admin/activities/1/photos"},
		{http.MethodGet, "/admin/cities"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Errorf("%s %s with no token = %d, want 403", tt.method, tt.path, rec.Code)
			}
		})
	}
}
