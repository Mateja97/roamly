package api

import (
	"bytes"
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

type fakeActivitiesClient struct {
	resp *activitiesv1.QueryActivitiesResponse
	err  error
	got  *activitiesv1.QueryActivitiesRequest
}

func (f *fakeActivitiesClient) QueryActivities(_ context.Context, req *activitiesv1.QueryActivitiesRequest) (*activitiesv1.QueryActivitiesResponse, error) {
	f.got = req
	return f.resp, f.err
}

func doRequest(t *testing.T, h *QueryActivitiesHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/activities/query", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.Handle(rec, req)
	return rec
}

func TestQueryActivitiesHandler_HappyPath(t *testing.T) {
	fake := &fakeActivitiesClient{resp: &activitiesv1.QueryActivitiesResponse{
		Activities: []*activitiesv1.Activity{{
			Id: "1", Title: "Kayaking", Category: activitiesv1.Category_CATEGORY_SPORTS,
			Location: &activitiesv1.Location{Lat: 44.8, Lng: 20.4}, Country: "Serbia",
			PriceTier: activitiesv1.PriceTier_PRICE_TIER_PREMIUM, Rating: 4.8,
			ImageRefs: []string{"img1"}, Tags: []string{"sports"}, DistanceKm: 3.2,
		}},
	}}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"home","home_location":{"lat":44.8,"lng":20.4}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var got queryActivitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Activities) != 1 || got.Activities[0].Category != "sports" || got.Activities[0].PriceTier != "premium" {
		t.Errorf("unexpected response: %+v", got)
	}
	if fake.got.GetScope() != activitiesv1.Scope_SCOPE_HOME {
		t.Errorf("gRPC request scope = %v, want SCOPE_HOME", fake.got.GetScope())
	}
}

func TestQueryActivitiesHandler_EmptyResultIsNotAnError(t *testing.T) {
	fake := &fakeActivitiesClient{resp: &activitiesv1.QueryActivitiesResponse{}}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"nearby","current_location":{"lat":44.8,"lng":20.4}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var got queryActivitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.Activities == nil || len(got.Activities) != 0 {
		t.Errorf("activities = %v, want empty (non-nil) slice", got.Activities)
	}
}

func TestQueryActivitiesHandler_ValidationFailures(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"unknown scope", `{"scope":"galaxy"}`},
		{"unknown category", `{"scope":"home","home_location":{"lat":1,"lng":1},"categories":["not_a_category"]}`},
		{"unknown price_tier", `{"scope":"home","home_location":{"lat":1,"lng":1},"price_tier":"not_a_tier"}`},
		{"malformed JSON body", `{not-json`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeActivitiesClient{}
			h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

			rec := doRequest(t, h, tt.body)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

func TestQueryActivitiesHandler_GRPCInvalidArgumentMapsTo400(t *testing.T) {
	fake := &fakeActivitiesClient{err: status.Error(codes.InvalidArgument, "missing home_location for scope home")}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"home"}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestQueryActivitiesHandler_GRPCInternalMapsTo500(t *testing.T) {
	fake := &fakeActivitiesClient{err: status.Error(codes.Internal, "internal error")}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"outside_country","home_country":"Serbia"}`)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}
