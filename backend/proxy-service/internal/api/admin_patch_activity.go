package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

type AdminPatchActivityHandler struct {
	client adminActivitiesClient
	logger *slog.Logger
}

func NewAdminPatchActivityHandler(client adminActivitiesClient, logger *slog.Logger) *AdminPatchActivityHandler {
	return &AdminPatchActivityHandler{client: client, logger: logger}
}

// patchActivityRequestDTO uses pointer fields so encoding/json can tell
// "key absent" (nil, left untouched) apart from "key present, even set to
// an empty string" (non-nil): a plain (non-pointer) struct can't make that
// distinction, and PATCH semantics require it — omitted fields must stay
// untouched, not get silently blanked to their zero value.
type patchActivityRequestDTO struct {
	Title       *string          `json:"title"`
	Description *string          `json:"description"`
	Category    *string          `json:"category"`
	City        *string          `json:"city"`
	Address     *string          `json:"address"`
	Status      *string          `json:"status"`
	Details     *json.RawMessage `json:"details"`
	Photos      *[]adminPhotoDTO `json:"photos"`
	// Subcategory (T1): same presence semantics as the other pointer fields.
	Subcategory *string `json:"subcategory"`
}

// Handle answers PATCH /admin/activities/{id}: a partial update accepting
// any subset of the DTO's fields. 404 if absent, 400 on an invalid
// category/status/JSON.
func (h *AdminPatchActivityHandler) Handle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var reqDTO patchActivityRequestDTO
	if err := json.NewDecoder(r.Body).Decode(&reqDTO); err != nil {
		writeError(w, http.StatusBadRequest, "malformed JSON body", h.logger)
		return
	}

	req := &activitiesv1.UpdateActivityRequest{
		Id: id, Title: reqDTO.Title, Description: reqDTO.Description,
		City: reqDTO.City, Address: reqDTO.Address, Subcategory: reqDTO.Subcategory,
	}
	if reqDTO.Category != nil {
		cat, ok := toProtoCategory(*reqDTO.Category)
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown category: "+*reqDTO.Category, h.logger)
			return
		}
		req.Category = &cat
	}
	// Both set in the same patch is the only case this handler has enough
	// information to validate without an extra GetActivity round-trip
	// (patch.Category absent means "keep the current category", which only
	// activities-service's service layer can resolve) — that case still
	// gets validated (and 400s) via UpdateActivity's own InvalidArgument.
	if reqDTO.Category != nil && reqDTO.Subcategory != nil &&
		!activitiessvc.ValidSubcategory(activitiessvc.Category(*reqDTO.Category), *reqDTO.Subcategory) {
		writeError(w, http.StatusBadRequest, "subcategory "+*reqDTO.Subcategory+" does not belong to category "+*reqDTO.Category, h.logger)
		return
	}
	if reqDTO.Status != nil {
		st, ok := toProtoStatus(*reqDTO.Status)
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown status: "+*reqDTO.Status, h.logger)
			return
		}
		req.Status = &st
	}
	if reqDTO.Details != nil {
		details := string(*reqDTO.Details)
		req.Details = &details
	}
	if reqDTO.Photos != nil {
		req.Photos = &activitiesv1.PhotoList{Photos: toProtoPhotoList(*reqDTO.Photos)}
	}

	updated, err := h.client.UpdateActivity(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err, h.logger)
		return
	}
	writeJSON(w, http.StatusOK, toAdminActivityDTO(updated, h.logger), h.logger)
}
