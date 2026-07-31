package api

import (
	"context"
	"log/slog"
	"net/http"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// activitiesLiveDetailsClient is the subset of shared/clients/activitiessvc.Client
// this handler needs, so tests can fake it without a real gRPC dial.
type activitiesLiveDetailsClient interface {
	GetActivityWithLiveDetails(ctx context.Context, req *activitiesv1.GetActivityRequest) (*activitiesv1.Activity, error)
}

type GetActivityHandler struct {
	client activitiesLiveDetailsClient
	logger *slog.Logger
}

func NewGetActivityHandler(client activitiesLiveDetailsClient, logger *slog.Logger) *GetActivityHandler {
	return &GetActivityHandler{client: client, logger: logger}
}

// Handle answers GET /activities/{id}: the public activity detail-page
// route (T3, places-live-details), backed by activities-service's
// GetActivityWithLiveDetails RPC — fresh Google Place Details merged onto a
// Places-sourced row's response, never persisted. No auth, same public
// surface as POST /activities/query.
func (h *GetActivityHandler) Handle(w http.ResponseWriter, r *http.Request) {
	activity, err := h.client.GetActivityWithLiveDetails(r.Context(), &activitiesv1.GetActivityRequest{Id: r.PathValue("id")})
	if err != nil {
		writeGRPCError(w, err, h.logger)
		return
	}
	writeJSON(w, http.StatusOK, toActivityDTO(activity, h.logger), h.logger)
}
