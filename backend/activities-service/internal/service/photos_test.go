package service

import (
	"context"
	"errors"
	"testing"

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
