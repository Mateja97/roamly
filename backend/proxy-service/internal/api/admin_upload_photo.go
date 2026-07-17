package api

import (
	"errors"
	"io"
	"log/slog"
	"net/http"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// maxUploadBytes caps a photo upload's multipart body at 8MB, per
// product-tasks.md's T1 acceptance criteria — enforced here, before any
// byte reaches gRPC (which itself carries headroom up to 12MB).
const maxUploadBytes = 8 << 20

type AdminUploadPhotoHandler struct {
	client adminActivitiesClient
	logger *slog.Logger
}

func NewAdminUploadPhotoHandler(client adminActivitiesClient, logger *slog.Logger) *AdminUploadPhotoHandler {
	return &AdminUploadPhotoHandler{client: client, logger: logger}
}

type uploadPhotoResponseDTO struct {
	URL      string `json:"url"`
	ThumbURL string `json:"thumb_url"`
}

// Handle answers POST /admin/activities/{id}/photos: a multipart upload
// ("file" field), body capped at 8MB by http.MaxBytesReader before any of
// it is read — an over-size body is rejected here as 413, never forwarded
// to gRPC. The actual image validation (decode success/failure) happens at
// activities-service; a resulting InvalidArgument maps to 400 via
// writeGRPCError, the same as every other admin write path.
func (h *AdminUploadPhotoHandler) Handle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	file, _, err := r.FormFile("file")
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "file exceeds 8MB", h.logger)
			return
		}
		writeError(w, http.StatusBadRequest, "missing \"file\" form field", h.logger)
		return
	}
	defer func() { _ = file.Close() }()

	data, err := io.ReadAll(file)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "file exceeds 8MB", h.logger)
			return
		}
		writeError(w, http.StatusBadRequest, "reading uploaded file", h.logger)
		return
	}

	resp, err := h.client.UploadPhoto(r.Context(), &activitiesv1.UploadPhotoRequest{ActivityId: id, Data: data})
	if err != nil {
		writeGRPCError(w, err, h.logger)
		return
	}
	writeJSON(w, http.StatusOK, uploadPhotoResponseDTO{URL: resp.GetUrl(), ThumbURL: resp.GetThumbUrl()}, h.logger)
}
