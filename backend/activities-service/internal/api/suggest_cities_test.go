package api

import (
	"context"
	"testing"

	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

func TestSuggestCities_HappyPath(t *testing.T) {
	fake := &fakeQueryService{citySuggestOut: []activitiessvc.CitySuggestion{
		{City: "Barcelona", Country: "Spain", Centroid: activitiessvc.Point{Lat: 41.4036, Lng: 2.1744}},
	}}
	client := dialServer(t, fake)

	resp, err := client.SuggestCities(context.Background(), &activitiesv1.SuggestCitiesRequest{Query: "Bar"})
	if err != nil {
		t.Fatalf("SuggestCities() error: %v", err)
	}
	if fake.gotCitySuggestQ != "Bar" {
		t.Errorf("query passed to service = %q, want %q", fake.gotCitySuggestQ, "Bar")
	}
	if len(resp.GetSuggestions()) != 1 {
		t.Fatalf("got %d suggestions, want 1", len(resp.GetSuggestions()))
	}
	got := resp.GetSuggestions()[0]
	if got.GetCity() != "Barcelona" || got.GetCountry() != "Spain" {
		t.Errorf("got %+v, want Barcelona/Spain", got)
	}
	if got.GetCentroid().GetLat() != 41.4036 || got.GetCentroid().GetLng() != 2.1744 {
		t.Errorf("got centroid %+v, want the fake's coordinates", got.GetCentroid())
	}
}

func TestSuggestCities_NoMatchReturnsEmptyNotError(t *testing.T) {
	fake := &fakeQueryService{citySuggestOut: nil}
	client := dialServer(t, fake)

	resp, err := client.SuggestCities(context.Background(), &activitiesv1.SuggestCitiesRequest{Query: "Zzznope"})
	if err != nil {
		t.Fatalf("SuggestCities() error: %v", err)
	}
	if len(resp.GetSuggestions()) != 0 {
		t.Errorf("got %d suggestions, want 0", len(resp.GetSuggestions()))
	}
}
