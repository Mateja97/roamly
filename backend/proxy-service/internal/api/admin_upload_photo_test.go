package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// multipartBody builds a single-file multipart/form-data body under field
// "file", returning the body and its Content-Type header value.
func multipartBody(t *testing.T, filename string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("writing part: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("closing writer: %v", err)
	}
	return &buf, w.FormDataContentType()
}

func doAdminUploadRequest(t *testing.T, h *AdminUploadPhotoHandler, id string, body *bytes.Buffer, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/admin/activities/"+id+"/photos", body)
	req.Header.Set("Content-Type", contentType)
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	h.Handle(rec, req)
	return rec
}

func TestAdminUploadPhoto_HappyPath(t *testing.T) {
	fake := &fakeAdminActivitiesClient{uploadOut: &activitiesv1.UploadPhotoResponse{
		Url: "/photos/1/abc.jpg", ThumbUrl: "/photos/1/abc_t.jpg",
	}}
	h := NewAdminUploadPhotoHandler(fake, slog.New(slog.DiscardHandler))

	body, ct := multipartBody(t, "photo.jpg", []byte("fake-image-bytes"))
	rec := doAdminUploadRequest(t, h, "1", body, ct)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpload.GetActivityId() != "1" || string(fake.gotUpload.GetData()) != "fake-image-bytes" {
		t.Errorf("gRPC request = %+v, upload data/id dropped in translation", fake.gotUpload)
	}
	var got uploadPhotoResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.URL != "/photos/1/abc.jpg" || got.ThumbURL != "/photos/1/abc_t.jpg" {
		t.Errorf("unexpected response: %+v", got)
	}
}

// TestAdminUploadPhoto_OversizeRejectedAtTheProxyEdge proves the T1
// acceptance criterion directly: an over-8MB body must 413 before any bytes
// reach gRPC — fake.gotUpload stays nil.
func TestAdminUploadPhoto_OversizeRejectedAtTheProxyEdge(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminUploadPhotoHandler(fake, slog.New(slog.DiscardHandler))

	oversize := make([]byte, maxUploadBytes+1)
	body, ct := multipartBody(t, "photo.jpg", oversize)
	rec := doAdminUploadRequest(t, h, "1", body, ct)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpload != nil {
		t.Error("gRPC call must not happen once the body is rejected as oversize")
	}
}

func TestAdminUploadPhoto_NonImageMapsTo400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{uploadErr: status.Error(codes.InvalidArgument, "not a decodable JPEG/PNG image")}
	h := NewAdminUploadPhotoHandler(fake, slog.New(slog.DiscardHandler))

	body, ct := multipartBody(t, "photo.txt", []byte("not an image"))
	rec := doAdminUploadRequest(t, h, "1", body, ct)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestAdminUploadPhoto_MissingFileFieldIs400(t *testing.T) {
	fake := &fakeAdminActivitiesClient{}
	h := NewAdminUploadPhotoHandler(fake, slog.New(slog.DiscardHandler))

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if err := w.Close(); err != nil {
		t.Fatalf("closing writer: %v", err)
	}
	rec := doAdminUploadRequest(t, h, "1", &buf, w.FormDataContentType())

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if fake.gotUpload != nil {
		t.Error("gRPC call must not happen with no file field")
	}
}
