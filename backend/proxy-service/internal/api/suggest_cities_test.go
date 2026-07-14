package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	activitiesv1 "backend/shared/proto/activities/v1"
)

type fakeCitiesClient struct {
	resp *activitiesv1.SuggestCitiesResponse
	err  error
	got  *activitiesv1.SuggestCitiesRequest
}

func (f *fakeCitiesClient) SuggestCities(_ context.Context, req *activitiesv1.SuggestCitiesRequest) (*activitiesv1.SuggestCitiesResponse, error) {
	f.got = req
	return f.resp, f.err
}

func TestSuggestCitiesHandler_PrefixMatch(t *testing.T) {
	fake := &fakeCitiesClient{resp: &activitiesv1.SuggestCitiesResponse{
		Suggestions: []*activitiesv1.CitySuggestion{
			{City: "Barcelona", Country: "Spain", Centroid: &activitiesv1.Location{Lat: 41.4036, Lng: 2.1744}},
		},
	}}
	h := NewSuggestCitiesHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/cities/suggest?q=Bar", nil)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if fake.got.GetQuery() != "Bar" {
		t.Errorf("query forwarded = %q, want %q", fake.got.GetQuery(), "Bar")
	}
	var got suggestCitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Suggestions) != 1 || got.Suggestions[0].City != "Barcelona" || got.Suggestions[0].Country != "Spain" {
		t.Fatalf("got %+v, want exactly one Barcelona/Spain suggestion", got.Suggestions)
	}
	if got.Suggestions[0].Centroid.Lat != 41.4036 || got.Suggestions[0].Centroid.Lng != 2.1744 {
		t.Errorf("got centroid %+v, want the fake's coordinates", got.Suggestions[0].Centroid)
	}
}

func TestSuggestCitiesHandler_NoMatchReturnsEmptyListNotError(t *testing.T) {
	fake := &fakeCitiesClient{resp: &activitiesv1.SuggestCitiesResponse{}}
	h := NewSuggestCitiesHandler(fake, slog.New(slog.DiscardHandler))

	req := httptest.NewRequest(http.MethodGet, "/cities/suggest?q=Zzznope", nil)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var got suggestCitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Suggestions) != 0 {
		t.Errorf("got %d suggestions, want 0", len(got.Suggestions))
	}
}
