package api

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// SuggestCities powers the Anywhere city typeahead (T4): a prefix match
// over the catalog's own cities, never a live geocoding call. An
// unmatched/empty query is a valid empty result, not an error.
func (s *Server) SuggestCities(ctx context.Context, req *activitiesv1.SuggestCitiesRequest) (*activitiesv1.SuggestCitiesResponse, error) {
	suggestions, err := s.svc.SuggestCities(ctx, req.GetQuery())
	if err != nil {
		s.logger.Error("suggest cities failed", "error", err)
		return nil, status.Error(codes.Internal, "internal error")
	}

	resp := &activitiesv1.SuggestCitiesResponse{
		Suggestions: make([]*activitiesv1.CitySuggestion, len(suggestions)),
	}
	for i, sug := range suggestions {
		resp.Suggestions[i] = &activitiesv1.CitySuggestion{
			City:     sug.City,
			Country:  sug.Country,
			Centroid: &activitiesv1.Location{Lat: sug.Centroid.Lat, Lng: sug.Centroid.Lng},
		}
	}
	return resp, nil
}
