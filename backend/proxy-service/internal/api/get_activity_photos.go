package api

import (
	"context"
	"log/slog"
	"net/http"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// activitiesPhotosClient is the subset of shared/clients/activitiessvc.Client
// this handler needs, so tests can fake it without a real gRPC dial.
type activitiesPhotosClient interface {
	GetActivityPhotos(ctx context.Context, req *activitiesv1.GetActivityPhotosRequest) (*activitiesv1.GetActivityPhotosResponse, error)
}

type GetActivityPhotosHandler struct {
	client activitiesPhotosClient
	logger *slog.Logger
}

func NewGetActivityPhotosHandler(client activitiesPhotosClient, logger *slog.Logger) *GetActivityPhotosHandler {
	return &GetActivityPhotosHandler{client: client, logger: logger}
}

type getActivityPhotosResponseDTO struct {
	ImageRefs []photoDTO `json:"image_refs"`
}

// Handle answers GET /activities/{id}/photos: an activity's full photo set
// (T3), resolving+persisting the remaining Google photos server-side on
// first view (see activities-service's GetActivityPhotos, T2). No auth
// beyond query_activities' own (none) — this is the same public surface.
// T2's RPC never fails on a Places timeout/error (falls back to whatever is
// already stored), so the only gRPC error this handler ever sees is
// NotFound for an unknown activity id.
func (h *GetActivityPhotosHandler) Handle(w http.ResponseWriter, r *http.Request) {
	resp, err := h.client.GetActivityPhotos(r.Context(), &activitiesv1.GetActivityPhotosRequest{Id: r.PathValue("id")})
	if err != nil {
		writeGRPCError(w, err, h.logger)
		return
	}
	writeJSON(w, http.StatusOK, getActivityPhotosResponseDTO{ImageRefs: toPhotoDTOs(resp.GetPhotos())}, h.logger)
}
