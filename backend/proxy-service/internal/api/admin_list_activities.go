package api

import (
	"log/slog"
	"net/http"
	"strconv"

	activitiesv1 "backend/shared/proto/activities/v1"
)

type AdminListActivitiesHandler struct {
	client adminActivitiesClient
	logger *slog.Logger
}

func NewAdminListActivitiesHandler(client adminActivitiesClient, logger *slog.Logger) *AdminListActivitiesHandler {
	return &AdminListActivitiesHandler{client: client, logger: logger}
}

// Handle answers GET /admin/activities. Every filter is optional; page/page_size
// are clamped and validated server-side (never trusted from the client) by
// activities-service's service layer, but an unknown category/status string
// is rejected here, at the boundary, before it ever reaches gRPC.
func (h *AdminListActivitiesHandler) Handle(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	var category activitiesv1.Category
	if c := q.Get("category"); c != "" {
		cat, ok := toProtoCategory(c)
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown category: "+c, h.logger)
			return
		}
		category = cat
	}

	var statusFilter activitiesv1.ActivityStatus
	if s := q.Get("status"); s != "" {
		st, ok := toProtoStatus(s)
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown status: "+s, h.logger)
			return
		}
		statusFilter = st
	}

	// A malformed (non-integer) page/page_size falls back to 0, which the
	// service layer's own clamping already treats as "use the default" —
	// no separate 400 needed for this input.
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))

	resp, err := h.client.ListActivities(r.Context(), &activitiesv1.ListActivitiesRequest{
		Q: q.Get("q"), Category: category, City: q.Get("city"), Status: statusFilter,
		Page: int32(page), PageSize: int32(pageSize),
	})
	if err != nil {
		writeGRPCError(w, err, h.logger)
		return
	}

	items := make([]adminActivityListItemDTO, len(resp.GetActivities()))
	for i, a := range resp.GetActivities() {
		items[i] = toAdminActivityListItemDTO(a, h.logger)
	}
	writeJSON(w, http.StatusOK, listActivitiesResponseDTO{
		Activities: items,
		Total:      int(resp.GetTotal()),
		Page:       int(resp.GetPage()),
		PageSize:   int(resp.GetPageSize()),
		Stats: adminStatsDTO{
			Total:     int(resp.GetStats().GetTotal()),
			Published: int(resp.GetStats().GetPublished()),
			Draft:     int(resp.GetStats().GetDraft()),
			Pending:   int(resp.GetStats().GetPending()),
		},
	}, h.logger)
}
