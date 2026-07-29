package service

import (
	"context"
	"errors"
	"testing"

	"activities-service/internal/tripadvisor"

	"backend/shared/models/activitiessvc"
)

// fakePlaces is a fake placesClient: each call is counted, so tests can
// assert "makes zero Place Photos calls" (T2's cache-only acceptance
// criterion) as directly as the RPC itself would be verified.
type fakePlaces struct {
	calls int
	out   []activitiessvc.Photo
	err   error
}

func (f *fakePlaces) ResolvePhotos(_ context.Context, _ string, _ int) ([]activitiessvc.Photo, error) {
	f.calls++
	return f.out, f.err
}

func TestActivities_GetPhotos(t *testing.T) {
	provisional := []activitiessvc.Photo{{URL: "https://example.com/provisional.jpg"}}
	resolvedSet := []activitiessvc.Photo{
		{URL: "https://example.com/1.jpg", Provider: activitiessvc.ProviderGoogle},
		{URL: "https://example.com/2.jpg", Provider: activitiessvc.ProviderGoogle},
		{URL: "https://example.com/3.jpg", Provider: activitiessvc.ProviderGoogle},
	}

	tests := []struct {
		name          string
		activity      activitiessvc.Activity
		places        *fakePlaces
		noPlaces      bool
		wantPhotos    []activitiessvc.Photo
		wantPlaceCall bool
		wantPersisted bool
	}{
		{
			name:          "first view resolves and persists",
			activity:      activitiessvc.Activity{ID: "1", ExternalID: "place-1", Photos: provisional},
			places:        &fakePlaces{out: resolvedSet},
			wantPhotos:    resolvedSet,
			wantPlaceCall: true,
			wantPersisted: true,
		},
		{
			name:          "already resolved is cache-only, no Google call",
			activity:      activitiessvc.Activity{ID: "1", ExternalID: "place-1", Photos: resolvedSet},
			places:        &fakePlaces{out: resolvedSet},
			wantPhotos:    resolvedSet,
			wantPlaceCall: false,
			wantPersisted: false,
		},
		{
			name:          "places error falls back to stored photos",
			activity:      activitiessvc.Activity{ID: "1", ExternalID: "place-1", Photos: provisional},
			places:        &fakePlaces{err: errors.New("places is down")},
			wantPhotos:    provisional,
			wantPlaceCall: true,
			wantPersisted: false,
		},
		{
			name:          "places empty result falls back to stored photos",
			activity:      activitiessvc.Activity{ID: "1", ExternalID: "place-1", Photos: provisional},
			places:        &fakePlaces{out: nil},
			wantPhotos:    provisional,
			wantPlaceCall: true,
			wantPersisted: false,
		},
		{
			name:          "no external_id makes no Google call",
			activity:      activitiessvc.Activity{ID: "1", ExternalID: "", Photos: provisional},
			places:        &fakePlaces{out: resolvedSet},
			wantPhotos:    provisional,
			wantPlaceCall: false,
			wantPersisted: false,
		},
		{
			name:       "no places client configured makes no Google call",
			activity:   activitiessvc.Activity{ID: "1", ExternalID: "place-1", Photos: provisional},
			noPlaces:   true,
			wantPhotos: provisional,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{getOut: tt.activity, updateOut: activitiessvc.Activity{ID: tt.activity.ID, Photos: resolvedSet}}
			svc := New(repo)
			if !tt.noPlaces {
				svc = svc.WithPlaces(tt.places)
			}

			got, err := svc.GetPhotos(context.Background(), tt.activity.ID)
			if err != nil {
				t.Fatalf("GetPhotos() error: %v", err)
			}
			if len(got) != len(tt.wantPhotos) {
				t.Fatalf("got %d photos, want %d", len(got), len(tt.wantPhotos))
			}
			for i := range got {
				if got[i].URL != tt.wantPhotos[i].URL {
					t.Errorf("photo[%d].URL = %q, want %q", i, got[i].URL, tt.wantPhotos[i].URL)
				}
			}

			if !tt.noPlaces && tt.places.calls != boolToInt(tt.wantPlaceCall) {
				t.Errorf("places.ResolvePhotos calls = %d, want call=%v", tt.places.calls, tt.wantPlaceCall)
			}
			if tt.wantPersisted && repo.gotUpdateID != tt.activity.ID {
				t.Errorf("repo.Update not called, want persisted photos for id %q", tt.activity.ID)
			}
			if !tt.wantPersisted && repo.gotUpdateID != "" {
				t.Errorf("repo.Update called with id %q, want no persist", repo.gotUpdateID)
			}
		})
	}
}

func TestActivities_GetPhotos_RepoErrorPropagates(t *testing.T) {
	repo := &fakeRepo{getErr: errors.New("db exploded")}
	svc := New(repo)

	if _, err := svc.GetPhotos(context.Background(), "missing"); err == nil {
		t.Fatal("GetPhotos() error = nil, want a wrapped error")
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// fakeTripadvisor is a fake tripadvisorClient. Task 5 (the lazy sync) adds
// NearbySearch/LocationDetails/LocationReviews fields and methods to this
// same struct as the tripadvisorClient interface it implements grows.
type fakeTripadvisor struct {
	photosOut   []activitiessvc.Photo
	photosErr   error
	photosCalls int

	nearbyOut   []tripadvisor.LocationSummary
	nearbyErr   error
	nearbyCalls int

	detailsOut  map[string]tripadvisor.LocationDetails
	detailsErrs map[string]error // per-locationID error, so one bad candidate can be simulated without failing every candidate

	reviewsOut map[string][]tripadvisor.Review
}

func (f *fakeTripadvisor) LocationPhotos(_ context.Context, _ string, _ int) ([]activitiessvc.Photo, error) {
	f.photosCalls++
	return f.photosOut, f.photosErr
}

func (f *fakeTripadvisor) NearbySearch(_ context.Context, _, _, _ float64, _ string) ([]tripadvisor.LocationSummary, error) {
	f.nearbyCalls++
	return f.nearbyOut, f.nearbyErr
}

func (f *fakeTripadvisor) LocationDetails(_ context.Context, locationID string) (tripadvisor.LocationDetails, error) {
	if err, ok := f.detailsErrs[locationID]; ok {
		return tripadvisor.LocationDetails{}, err
	}
	return f.detailsOut[locationID], nil
}

func (f *fakeTripadvisor) LocationReviews(_ context.Context, locationID string) ([]tripadvisor.Review, error) {
	return f.reviewsOut[locationID], nil
}

func TestActivities_GetPhotos_TripadvisorSourceRoutesToTripadvisor(t *testing.T) {
	provisional := []activitiessvc.Photo{{URL: "https://example.com/provisional.jpg"}}
	resolvedSet := []activitiessvc.Photo{
		{URL: "https://example.com/1.jpg", Provider: activitiessvc.ProviderTripadvisor},
		{URL: "https://example.com/2.jpg", Provider: activitiessvc.ProviderTripadvisor},
	}
	activity := activitiessvc.Activity{ID: "1", ExternalID: "111", Source: "tripadvisor", Photos: provisional}

	repo := &fakeRepo{getOut: activity, updateOut: activitiessvc.Activity{ID: "1", Photos: resolvedSet}}
	ta := &fakeTripadvisor{photosOut: resolvedSet}
	places := &fakePlaces{out: []activitiessvc.Photo{{URL: "https://wrong-provider.example.com/x.jpg"}}}
	svc := New(repo).WithPlaces(places).WithTripadvisor(ta)

	got, err := svc.GetPhotos(context.Background(), "1")
	if err != nil {
		t.Fatalf("GetPhotos() error: %v", err)
	}
	if len(got) != 2 || got[0].URL != resolvedSet[0].URL {
		t.Fatalf("got %+v, want the tripadvisor-resolved set", got)
	}
	if ta.photosCalls != 1 {
		t.Errorf("tripadvisor.LocationPhotos calls = %d, want 1", ta.photosCalls)
	}
	if places.calls != 0 {
		t.Errorf("places.ResolvePhotos calls = %d, want 0 — a tripadvisor-sourced row must never call Google", places.calls)
	}
}

func TestActivities_GetPhotos_NonTripadvisorSourceStillUsesPlaces(t *testing.T) {
	provisional := []activitiessvc.Photo{{URL: "https://example.com/provisional.jpg"}}
	resolvedSet := []activitiessvc.Photo{{URL: "https://example.com/1.jpg", Provider: activitiessvc.ProviderGoogle}}
	// Source unset, same as every pre-Task-4 fixture (google_places rows
	// read "" until this ships against a real DB backfill, and admin rows
	// are always "") — must keep routing to places, not break existing
	// Google-sourced venues.
	activity := activitiessvc.Activity{ID: "1", ExternalID: "place-1", Source: "", Photos: provisional}

	repo := &fakeRepo{getOut: activity, updateOut: activitiessvc.Activity{ID: "1", Photos: resolvedSet}}
	places := &fakePlaces{out: resolvedSet}
	ta := &fakeTripadvisor{photosOut: []activitiessvc.Photo{{URL: "https://wrong-provider.example.com/x.jpg"}}}
	svc := New(repo).WithPlaces(places).WithTripadvisor(ta)

	got, err := svc.GetPhotos(context.Background(), "1")
	if err != nil {
		t.Fatalf("GetPhotos() error: %v", err)
	}
	if len(got) != 1 || got[0].URL != resolvedSet[0].URL {
		t.Fatalf("got %+v, want the places-resolved set", got)
	}
	if places.calls != 1 {
		t.Errorf("places.ResolvePhotos calls = %d, want 1", places.calls)
	}
	if ta.photosCalls != 0 {
		t.Errorf("tripadvisor.LocationPhotos calls = %d, want 0", ta.photosCalls)
	}
}
