package api

import (
	"log/slog"
	"net/http"

	activitiesv1 "backend/shared/proto/activities/v1"
)

type AdminGetActivityHandler struct {
	client adminActivitiesClient
	logger *slog.Logger
}

func NewAdminGetActivityHandler(client adminActivitiesClient, logger *slog.Logger) *AdminGetActivityHandler {
	return &AdminGetActivityHandler{client: client, logger: logger}
}

// Handle answers GET /admin/activities/{id}: the full activity, any
// lifecycle state, 404 if absent.
func (h *AdminGetActivityHandler) Handle(w http.ResponseWriter, r *http.Request) {
	activity, err := h.client.GetActivity(r.Context(), &activitiesv1.GetActivityRequest{Id: r.PathValue("id")})
	if err != nil {
		writeGRPCError(w, err, h.logger)
		return
	}
	writeJSON(w, http.StatusOK, toAdminActivityDTO(activity, h.logger), h.logger)
}
