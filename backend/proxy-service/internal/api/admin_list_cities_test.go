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
