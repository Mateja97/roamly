package api

import (
	"context"
	"errors"
	"testing"

	activitiesv1 "backend/shared/proto/activities/v1"
)

func TestListAdminCities_HappyPath(t *testing.T) {
	fake := &fakeQueryService{adminCitiesOut: []string{"Barcelona", "Belgrade"}}
	client := dialServer(t, fake)

	resp, err := client.ListAdminCities(context.Background(), &activitiesv1.ListAdminCitiesRequest{})
	if err != nil {
		t.Fatalf("ListAdminCities() error: %v", err)
	}
	if got := resp.GetCities(); len(got) != 2 || got[0] != "Barcelona" || got[1] != "Belgrade" {
		t.Errorf("got %v, want [Barcelona Belgrade]", got)
	}
}

func TestListAdminCities_ServiceErrorIsInternal(t *testing.T) {
	fake := &fakeQueryService{adminCitiesErr: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.ListAdminCities(context.Background(), &activitiesv1.ListAdminCitiesRequest{})
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
}
