package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

type AdminCreateActivityHandler struct {
	client adminActivitiesClient
	logger *slog.Logger
}

func NewAdminCreateActivityHandler(client adminActivitiesClient, logger *slog.Logger) *AdminCreateActivityHandler {
	return &AdminCreateActivityHandler{client: client, logger: logger}
}

type createActivityRequestDTO struct {
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	City        string          `json:"city"`
	Address     string          `json:"address"`
	Status      string          `json:"status"`
	Details     json.RawMessage `json:"details"`
	Photos      []adminPhotoDTO `json:"photos"`
	// Subcategory (T1) is optional, validated against Category by
	// activities-service; a mismatch surfaces as a 400.
	Subcategory string `json:"subcategory"`
}

// Handle answers POST /admin/activities. Requires title + category; status
// defaults to draft (activities-service's service layer) when omitted.
// Responds 200, not 201, per proxy-service's fixed status contract.
func (h *AdminCreateActivityHandler) Handle(w http.ResponseWriter, r *http.Request) {
	var reqDTO createActivityRequestDTO
	if err := json.NewDecoder(r.Body).Decode(&reqDTO); err != nil {
		writeError(w, http.StatusBadRequest, "malformed JSON body", h.logger)
		return
	}

	if reqDTO.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required", h.logger)
		return
	}
	category, ok := toProtoCategory(reqDTO.Category)
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown category: "+reqDTO.Category, h.logger)
		return
	}
	if !activitiessvc.ValidSubcategory(activitiessvc.Category(reqDTO.Category), reqDTO.Subcategory) {
		writeError(w, http.StatusBadRequest, "subcategory "+reqDTO.Subcategory+" does not belong to category "+reqDTO.Category, h.logger)
		return
	}
	var statusValue activitiesv1.ActivityStatus
	if reqDTO.Status != "" {
		st, ok := toProtoStatus(reqDTO.Status)
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown status: "+reqDTO.Status, h.logger)
			return
		}
		statusValue = st
	}

	created, err := h.client.CreateActivity(r.Context(), &activitiesv1.CreateActivityRequest{
		Title: reqDTO.Title, Description: reqDTO.Description, Category: category,
		City: reqDTO.City, Address: reqDTO.Address, Status: statusValue,
		Details: string(reqDTO.Details), Photos: toProtoPhotoList(reqDTO.Photos),
		Subcategory: reqDTO.Subcategory,
	})
	if err != nil {
		writeGRPCError(w, err, h.logger)
		return
	}
	writeJSON(w, http.StatusOK, toAdminActivityDTO(created, h.logger), h.logger)
}
