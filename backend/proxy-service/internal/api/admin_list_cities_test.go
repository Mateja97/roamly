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

func TestAdminListCities_HappyPath(t *testing.T) {
	fake := &fakeAdminActivitiesClient{citiesOut: &activitiesv1.ListAdminCitiesResponse{
		Cities: []string{"Barcelona", "Belgrade"},
	}}
	h := NewAdminListCitiesHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/admin/cities", nil)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	var got listAdminCitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Cities) != 2 || got.Cities[0] != "Barcelona" || got.Cities[1] != "Belgrade" {
		t.Errorf("got %+v, want [Barcelona Belgrade]", got.Cities)
	}
}

// TestAdminListCities_EmptyCatalogIsAnEmptyArrayNotNull proves the
// nil-guard: an empty catalog's gRPC response decodes Cities as a nil
// slice (protobuf repeated fields have no wire presence for zero
// elements), and that must never leak into the JSON body as {"cities":null}
// — the frontend's cityOptions.map(...) has no null-guard and would crash.
func TestAdminListCities_EmptyCatalogIsAnEmptyArrayNotNull(t *testing.T) {
	fake := &fakeAdminActivitiesClient{citiesOut: &activitiesv1.ListAdminCitiesResponse{Cities: nil}}
	h := NewAdminListCitiesHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/admin/cities", nil)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); !strings.Contains(got, `"cities":[]`) {
		t.Errorf("body = %s, want \"cities\":[] (not null)", got)
	}
}

func TestAdminListCities_GRPCErrorPropagates(t *testing.T) {
	fake := &fakeAdminActivitiesClient{citiesErr: status.Error(codes.Internal, "internal error")}
	h := NewAdminListCitiesHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/admin/cities", nil)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body = %s", rec.Code, rec.Body.String())
	}
}
