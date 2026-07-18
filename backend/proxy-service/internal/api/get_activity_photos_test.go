package api

import (
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

type fakeActivitiesPhotosClient struct {
	resp *activitiesv1.GetActivityPhotosResponse
	err  error
	got  *activitiesv1.GetActivityPhotosRequest
}

func (f *fakeActivitiesPhotosClient) GetActivityPhotos(_ context.Context, req *activitiesv1.GetActivityPhotosRequest) (*activitiesv1.GetActivityPhotosResponse, error) {
	f.got = req
	return f.resp, f.err
}

func doPhotosRequest(t *testing.T, h *GetActivityPhotosHandler, id string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/activities/"+id+"/photos", nil)
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)
	return rec
}

func TestGetActivityPhotosHandler_HappyPath(t *testing.T) {
	fake := &fakeActivitiesPhotosClient{resp: &activitiesv1.GetActivityPhotosResponse{
		Photos: []*activitiesv1.Photo{
			{Url: "img1", Author: "Jane Doe", AuthorLink: "https://example.com/jane", ThumbUrl: "img1_t", Caption: "Sunset view"},
			{Url: "img2"}, // unresolved: no author, attribution must be omitted
		},
	}}
	h := NewGetActivityPhotosHandler(fake, slog.New(slog.DiscardHandler))

	rec := doPhotosRequest(t, h, "activity-1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if fake.got.GetId() != "activity-1" {
		t.Errorf("gRPC request id = %q, want activity-1", fake.got.GetId())
	}
	var got getActivityPhotosResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.ImageRefs) != 2 || got.ImageRefs[0].URI != "img1" || got.ImageRefs[0].Attribution == nil || got.ImageRefs[0].Attribution.Author != "Jane Doe" {
		t.Errorf("unexpected resolved photo: %+v", got.ImageRefs)
	}
	if got.ImageRefs[0].ThumbURL != "img1_t" || got.ImageRefs[0].Caption != "Sunset view" {
		t.Errorf("thumb_url/caption must round-trip: %+v", got.ImageRefs[0])
	}
	if got.ImageRefs[1].URI != "img2" || got.ImageRefs[1].Attribution != nil {
		t.Errorf("unresolved photo must omit attribution: %+v", got.ImageRefs[1])
	}
}

// TestGetActivityPhotosHandler_NotFoundMapsTo404 also covers the fallback
// contract: T2's RPC never errors on a Places timeout/failure, it falls
// back to whatever is already stored (at minimum the provisional photo) and
// returns 200 — the same code path as HappyPath above, just fewer photos.
// The only gRPC error this handler ever sees is NotFound for an unknown id.
func TestGetActivityPhotosHandler_NotFoundMapsTo404(t *testing.T) {
	fake := &fakeActivitiesPhotosClient{err: status.Error(codes.NotFound, "activity not found")}
	h := NewGetActivityPhotosHandler(fake, slog.New(slog.DiscardHandler))

	rec := doPhotosRequest(t, h, "missing")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestGetActivityPhotosHandler_InternalErrorMapsTo500(t *testing.T) {
	fake := &fakeActivitiesPhotosClient{err: status.Error(codes.Internal, "internal error")}
	h := NewGetActivityPhotosHandler(fake, slog.New(slog.DiscardHandler))

	rec := doPhotosRequest(t, h, "activity-1")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}
