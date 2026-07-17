package api

import (
	"log/slog"
	"net/http"

	activitiesv1 "backend/shared/proto/activities/v1"
)

type AdminListCitiesHandler struct {
	client adminActivitiesClient
	logger *slog.Logger
}

func NewAdminListCitiesHandler(client adminActivitiesClient, logger *slog.Logger) *AdminListCitiesHandler {
	return &AdminListCitiesHandler{client: client, logger: logger}
}

type listAdminCitiesResponseDTO struct {
	Cities []string `json:"cities"`
}

// Handle answers GET /admin/cities — every distinct city in the catalog,
// any status, backing the admin panel's city filter dropdown (unlike the
// public /cities/suggest typeahead, which is published-only and requires a
// non-empty prefix).
func (h *AdminListCitiesHandler) Handle(w http.ResponseWriter, r *http.Request) {
	resp, err := h.client.ListAdminCities(r.Context(), &activitiesv1.ListAdminCitiesRequest{})
	if err != nil {
		writeGRPCError(w, err, h.logger)
		return
	}
	writeJSON(w, http.StatusOK, listAdminCitiesResponseDTO{Cities: resp.GetCities()}, h.logger)
}
