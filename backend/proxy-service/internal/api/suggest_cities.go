package api

import (
	"context"
	"log/slog"
	"net/http"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// citiesClient is the subset of shared/clients/activitiessvc.Client the
// city-typeahead handler needs.
type citiesClient interface {
	SuggestCities(ctx context.Context, req *activitiesv1.SuggestCitiesRequest) (*activitiesv1.SuggestCitiesResponse, error)
}

type SuggestCitiesHandler struct {
	client citiesClient
	logger *slog.Logger
}

func NewSuggestCitiesHandler(client citiesClient, logger *slog.Logger) *SuggestCitiesHandler {
	return &SuggestCitiesHandler{client: client, logger: logger}
}

type citySuggestionDTO struct {
	City     string      `json:"city"`
	Country  string      `json:"country"`
	Centroid locationDTO `json:"centroid"`
}

type suggestCitiesResponseDTO struct {
	Suggestions []citySuggestionDTO `json:"suggestions"`
}

// Handle answers GET /cities/suggest?q=<partial city name>. A missing or
// non-matching q is an empty list, not an error - the app's typeahead is
// expected to call this on every keystroke.
func (h *SuggestCitiesHandler) Handle(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")

	resp, err := h.client.SuggestCities(r.Context(), &activitiesv1.SuggestCitiesRequest{Query: query})
	if err != nil {
		h.logger.Error("suggest cities failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error", h.logger)
		return
	}

	suggestions := make([]citySuggestionDTO, len(resp.GetSuggestions()))
	for i, s := range resp.GetSuggestions() {
		suggestions[i] = citySuggestionDTO{
			City:    s.GetCity(),
			Country: s.GetCountry(),
			Centroid: locationDTO{
				Lat: s.GetCentroid().GetLat(),
				Lng: s.GetCentroid().GetLng(),
			},
		}
	}
	writeJSON(w, http.StatusOK, suggestCitiesResponseDTO{Suggestions: suggestions}, h.logger)
}
