// Package api is proxy-service's HTTP transport layer: one file per
// endpoint, translating JSON <-> gRPC and mapping gRPC status codes to HTTP
// status codes. See GO_STANDARDS.md — proxy calls backend/shared/clients
// directly, no service layer yet.
package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

// activitiesClient is the subset of shared/clients/activitiessvc.Client this
// handler needs, so tests can fake it without a real gRPC dial.
type activitiesClient interface {
	QueryActivities(ctx context.Context, req *activitiesv1.QueryActivitiesRequest) (*activitiesv1.QueryActivitiesResponse, error)
}

type QueryActivitiesHandler struct {
	client activitiesClient
	logger *slog.Logger
}

func NewQueryActivitiesHandler(client activitiesClient, logger *slog.Logger) *QueryActivitiesHandler {
	return &QueryActivitiesHandler{client: client, logger: logger}
}

type locationDTO struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// queryActivitiesRequestDTO is the HTTP request body. scope/categories/
// price_tier reuse the exact lowercase snake_case strings
// backend/shared/models/activitiessvc defines, so this JSON contract and
// activities-service's own domain vocabulary never drift apart.
type queryActivitiesRequestDTO struct {
	Scope           string       `json:"scope"`
	CurrentLocation *locationDTO `json:"current_location,omitempty"`
	HomeLocation    *locationDTO `json:"home_location,omitempty"`
	HomeCountry     string       `json:"home_country,omitempty"`
	Categories      []string     `json:"categories,omitempty"`
	PriceTier       string       `json:"price_tier,omitempty"`
	MinRating       float64      `json:"min_rating,omitempty"`
	MaxDistanceKM   float64      `json:"max_distance_km,omitempty"`
	// Sort requests a specific result ordering, e.g. "top_rated" for the
	// country (outside_country) scope's rating-descending MVP ranking.
	// Empty = no explicit ordering requested.
	Sort string `json:"sort,omitempty"`
}

// activityDTO carries every field the app's activity card needs to render.
type activityDTO struct {
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Category    string      `json:"category"`
	Location    locationDTO `json:"location"`
	Country     string      `json:"country"`
	PriceTier   string      `json:"price_tier"`
	Rating      float64     `json:"rating"`
	ImageRefs   []string    `json:"image_refs"`
	Tags        []string    `json:"tags"`
	DistanceKM  float64     `json:"distance_km"`
}

type queryActivitiesResponseDTO struct {
	Activities []activityDTO `json:"activities"`
}

func (h *QueryActivitiesHandler) Handle(w http.ResponseWriter, r *http.Request) {
	var reqDTO queryActivitiesRequestDTO
	if err := json.NewDecoder(r.Body).Decode(&reqDTO); err != nil {
		writeError(w, http.StatusBadRequest, "malformed JSON body", h.logger)
		return
	}

	scope, ok := toProtoScope(reqDTO.Scope)
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown scope: "+reqDTO.Scope, h.logger)
		return
	}

	categories := make([]activitiesv1.Category, 0, len(reqDTO.Categories))
	for _, c := range reqDTO.Categories {
		cat, ok := toProtoCategory(c)
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown category: "+c, h.logger)
			return
		}
		categories = append(categories, cat)
	}

	priceTier, ok := toProtoPriceTier(reqDTO.PriceTier)
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown price_tier: "+reqDTO.PriceTier, h.logger)
		return
	}

	sort, ok := toProtoSort(reqDTO.Sort)
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown sort: "+reqDTO.Sort, h.logger)
		return
	}

	grpcReq := &activitiesv1.QueryActivitiesRequest{
		Scope:           scope,
		CurrentLocation: toProtoLocation(reqDTO.CurrentLocation),
		HomeLocation:    toProtoLocation(reqDTO.HomeLocation),
		HomeCountry:     reqDTO.HomeCountry,
		Categories:      categories,
		PriceTier:       priceTier,
		MinRating:       reqDTO.MinRating,
		MaxDistanceKm:   reqDTO.MaxDistanceKM,
		Sort:            sort,
	}

	resp, err := h.client.QueryActivities(r.Context(), grpcReq)
	if err != nil {
		if status.Code(err) == codes.InvalidArgument {
			writeError(w, http.StatusBadRequest, status.Convert(err).Message(), h.logger)
			return
		}
		h.logger.Error("query activities failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error", h.logger)
		return
	}

	// Empty in-scope results are not an error — codes.OK + an empty slice
	// (never nil, so the JSON body is always "activities": []) is the "no
	// matches" case; only a non-2xx status means "something is wrong".
	activities := make([]activityDTO, len(resp.GetActivities()))
	for i, a := range resp.GetActivities() {
		activities[i] = toActivityDTO(a, h.logger)
	}
	writeJSON(w, http.StatusOK, queryActivitiesResponseDTO{Activities: activities}, h.logger)
}

func toProtoLocation(l *locationDTO) *activitiesv1.Location {
	if l == nil {
		return nil
	}
	return &activitiesv1.Location{Lat: l.Lat, Lng: l.Lng}
}

func toProtoScope(s string) (activitiesv1.Scope, bool) {
	switch activitiessvc.Scope(s) {
	case activitiessvc.ScopeHome:
		return activitiesv1.Scope_SCOPE_HOME, true
	case activitiessvc.ScopeNearby:
		return activitiesv1.Scope_SCOPE_NEARBY, true
	case activitiessvc.ScopeOutsideCountry:
		return activitiesv1.Scope_SCOPE_OUTSIDE_COUNTRY, true
	default:
		return activitiesv1.Scope_SCOPE_UNSPECIFIED, false
	}
}

func toProtoCategory(c string) (activitiesv1.Category, bool) {
	switch activitiessvc.Category(c) {
	case activitiessvc.CategoryFoodAndDrink:
		return activitiesv1.Category_CATEGORY_FOOD_AND_DRINK, true
	case activitiessvc.CategoryHistoryAndCulture:
		return activitiesv1.Category_CATEGORY_HISTORY_AND_CULTURE, true
	case activitiessvc.CategoryNatureAndOutdoors:
		return activitiesv1.Category_CATEGORY_NATURE_AND_OUTDOORS, true
	case activitiessvc.CategoryArtAndDesign:
		return activitiesv1.Category_CATEGORY_ART_AND_DESIGN, true
	case activitiessvc.CategorySports:
		return activitiesv1.Category_CATEGORY_SPORTS, true
	case activitiessvc.CategoryEntertainmentAndWellness:
		return activitiesv1.Category_CATEGORY_ENTERTAINMENT_AND_WELLNESS, true
	default:
		return activitiesv1.Category_CATEGORY_UNSPECIFIED, false
	}
}

func toProtoPriceTier(p string) (activitiesv1.PriceTier, bool) {
	switch activitiessvc.PriceTier(p) {
	case activitiessvc.PriceTierUnspecified:
		return activitiesv1.PriceTier_PRICE_TIER_UNSPECIFIED, true
	case activitiessvc.PriceTierBudget:
		return activitiesv1.PriceTier_PRICE_TIER_BUDGET, true
	case activitiessvc.PriceTierModerate:
		return activitiesv1.PriceTier_PRICE_TIER_MODERATE, true
	case activitiessvc.PriceTierPremium:
		return activitiesv1.PriceTier_PRICE_TIER_PREMIUM, true
	case activitiessvc.PriceTierLuxury:
		return activitiesv1.PriceTier_PRICE_TIER_LUXURY, true
	default:
		return activitiesv1.PriceTier_PRICE_TIER_UNSPECIFIED, false
	}
}

func toProtoSort(s string) (activitiesv1.Sort, bool) {
	switch activitiessvc.Sort(s) {
	case activitiessvc.SortUnspecified:
		return activitiesv1.Sort_SORT_UNSPECIFIED, true
	case activitiessvc.SortTopRated:
		return activitiesv1.Sort_SORT_TOP_RATED, true
	default:
		return activitiesv1.Sort_SORT_UNSPECIFIED, false
	}
}

func toActivityDTO(a *activitiesv1.Activity, logger *slog.Logger) activityDTO {
	return activityDTO{
		ID:          a.GetId(),
		Title:       a.GetTitle(),
		Description: a.GetDescription(),
		Category:    string(toDomainCategory(a.GetCategory(), logger)),
		Location:    locationDTO{Lat: a.GetLocation().GetLat(), Lng: a.GetLocation().GetLng()},
		Country:     a.GetCountry(),
		PriceTier:   string(toDomainPriceTier(a.GetPriceTier(), logger)),
		Rating:      a.GetRating(),
		ImageRefs:   a.GetImageRefs(),
		Tags:        a.GetTags(),
		DistanceKM:  a.GetDistanceKm(),
	}
}

func toDomainCategory(c activitiesv1.Category, logger *slog.Logger) activitiessvc.Category {
	switch c {
	case activitiesv1.Category_CATEGORY_FOOD_AND_DRINK:
		return activitiessvc.CategoryFoodAndDrink
	case activitiesv1.Category_CATEGORY_HISTORY_AND_CULTURE:
		return activitiessvc.CategoryHistoryAndCulture
	case activitiesv1.Category_CATEGORY_NATURE_AND_OUTDOORS:
		return activitiessvc.CategoryNatureAndOutdoors
	case activitiesv1.Category_CATEGORY_ART_AND_DESIGN:
		return activitiessvc.CategoryArtAndDesign
	case activitiesv1.Category_CATEGORY_SPORTS:
		return activitiessvc.CategorySports
	case activitiesv1.Category_CATEGORY_ENTERTAINMENT_AND_WELLNESS:
		return activitiessvc.CategoryEntertainmentAndWellness
	default:
		logger.Warn("unrecognized category from activities-service", "category", c)
		return ""
	}
}

func toDomainPriceTier(p activitiesv1.PriceTier, logger *slog.Logger) activitiessvc.PriceTier {
	switch p {
	case activitiesv1.PriceTier_PRICE_TIER_UNSPECIFIED:
		return activitiessvc.PriceTierUnspecified
	case activitiesv1.PriceTier_PRICE_TIER_BUDGET:
		return activitiessvc.PriceTierBudget
	case activitiesv1.PriceTier_PRICE_TIER_MODERATE:
		return activitiessvc.PriceTierModerate
	case activitiesv1.PriceTier_PRICE_TIER_PREMIUM:
		return activitiessvc.PriceTierPremium
	case activitiesv1.PriceTier_PRICE_TIER_LUXURY:
		return activitiessvc.PriceTierLuxury
	default:
		logger.Warn("unrecognized price tier from activities-service", "price_tier", p)
		return activitiessvc.PriceTierUnspecified
	}
}
