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

// queryActivitiesRequestDTO is the HTTP request body. scope/categories
// reuse the exact lowercase snake_case strings
// backend/shared/models/activitiessvc defines, so this JSON contract and
// activities-service's own domain vocabulary never drift apart.
//
// ponytail: a stray key from a now-removed filter field in the request body
// is silently ignored by encoding/json (no struct field to decode it into) —
// a stale app build sending the dropped field must not hard-fail.
type queryActivitiesRequestDTO struct {
	Scope string `json:"scope"`
	// Required for scope "nearby". Optional for "anywhere": omitted (e.g.
	// device location denied) still returns broad, distance-unfiltered
	// results.
	CurrentLocation *locationDTO `json:"current_location,omitempty"`
	Categories      []string     `json:"categories,omitempty"`
	MinRating       float64      `json:"min_rating,omitempty"`
	// Narrows results to within this distance of current_location, or (for
	// scope "anywhere") of the nearest entry in cities. 0 = no cap
	// ("anywhere" at the top of the distance slider). Requires
	// current_location or a non-empty cities to be set; scope "anywhere"
	// accepts any positive value (not capped to "nearby"'s configured
	// radius).
	MaxDistanceKM float64 `json:"max_distance_km,omitempty"`
	// Scope "anywhere" only: zero or more city centroids to anchor the
	// search on instead of current_location. When set, takes priority over
	// current_location for distance filtering (union of any-city radius).
	Cities []locationDTO `json:"cities,omitempty"`
}

// attributionDTO is Google's mandatory author attribution for a Places
// photo (name + optional profile link). Omitted from the wire entirely
// (via photoDTO's omitempty) when the photo hasn't been resolved yet.
type attributionDTO struct {
	Author string `json:"author"`
	Link   string `json:"link,omitempty"`
}

// photoDTO is one activity photo. Attribution is nil (and therefore
// omitted) for an unresolved photo — the app's existing normalizer treats
// that identically to today's plain-string wire format.
type photoDTO struct {
	URI         string          `json:"uri"`
	Attribution *attributionDTO `json:"attribution,omitempty"`
}

// activityDTO carries every field the app's activity card needs to render.
type activityDTO struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	Location    locationDTO     `json:"location"`
	Country     string          `json:"country"`
	Rating      float64         `json:"rating"`
	ImageRefs   []photoDTO      `json:"image_refs"`
	Tags        []string        `json:"tags"`
	DistanceKM  float64         `json:"distance_km"`
	// Details is the category-specific detail payload (T2), passed through
	// as a decoded JSON object — activities-service's `details` proto field
	// is already a JSON string, so this is a raw re-embed, not a
	// string-of-a-string.
	Details json.RawMessage `json:"details"`
	// City, Address, and Status are T1 additions. Status is always
	// "published" here: QueryActivities (the RPC this handler calls) only
	// ever returns published activities.
	City    string `json:"city"`
	Address string `json:"address"`
	Status  string `json:"status"`
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

	cities := make([]*activitiesv1.Location, len(reqDTO.Cities))
	for i, c := range reqDTO.Cities {
		cities[i] = &activitiesv1.Location{Lat: c.Lat, Lng: c.Lng}
	}

	grpcReq := &activitiesv1.QueryActivitiesRequest{
		Scope:           scope,
		CurrentLocation: toProtoLocation(reqDTO.CurrentLocation),
		Categories:      categories,
		MinRating:       reqDTO.MinRating,
		MaxDistanceKm:   reqDTO.MaxDistanceKM,
		Cities:          cities,
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
	case activitiessvc.ScopeNearby:
		return activitiesv1.Scope_SCOPE_NEARBY, true
	case activitiessvc.ScopeAnywhere:
		return activitiesv1.Scope_SCOPE_ANYWHERE, true
	default:
		return activitiesv1.Scope_SCOPE_UNSPECIFIED, false
	}
}

func toProtoCategory(c string) (activitiesv1.Category, bool) {
	switch activitiessvc.Category(c) {
	case activitiessvc.CategoryRestaurants:
		return activitiesv1.Category_CATEGORY_RESTAURANTS, true
	case activitiessvc.CategoryCafes:
		return activitiesv1.Category_CATEGORY_CAFES, true
	case activitiessvc.CategoryBars:
		return activitiesv1.Category_CATEGORY_BARS, true
	case activitiessvc.CategoryNightlife:
		return activitiesv1.Category_CATEGORY_NIGHTLIFE, true
	case activitiessvc.CategoryNature:
		return activitiesv1.Category_CATEGORY_NATURE, true
	case activitiessvc.CategorySport:
		return activitiesv1.Category_CATEGORY_SPORT, true
	case activitiessvc.CategoryKids:
		return activitiesv1.Category_CATEGORY_KIDS, true
	case activitiessvc.CategoryCulture:
		return activitiesv1.Category_CATEGORY_CULTURE, true
	case activitiessvc.CategoryArt:
		return activitiesv1.Category_CATEGORY_ART, true
	case activitiessvc.CategoryWellness:
		return activitiesv1.Category_CATEGORY_WELLNESS, true
	case activitiessvc.CategoryShopping:
		return activitiesv1.Category_CATEGORY_SHOPPING, true
	case activitiessvc.CategoryEntertainment:
		return activitiesv1.Category_CATEGORY_ENTERTAINMENT, true
	default:
		return activitiesv1.Category_CATEGORY_UNSPECIFIED, false
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
		Rating:      a.GetRating(),
		ImageRefs:   toPhotoDTOs(a.GetPhotos()),
		Tags:        nonNilTags(a.GetTags()),
		DistanceKM:  a.GetDistanceKm(),
		Details:     detailsJSON(a.GetDetails()),
		City:        a.GetCity(),
		Address:     a.GetAddress(),
		Status:      toDomainStatus(a.GetStatus(), logger),
	}
}

// toDomainStatus converts the wire enum to the lowercase snake_case string
// convention this JSON API already uses for category; an unrecognized value
// logs a warning and falls back to "" rather than breaking the whole
// response over one activity's status.
func toDomainStatus(s activitiesv1.ActivityStatus, logger *slog.Logger) string {
	switch s {
	case activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED:
		return string(activitiessvc.StatusPublished)
	case activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT:
		return string(activitiessvc.StatusDraft)
	case activitiesv1.ActivityStatus_ACTIVITY_STATUS_PENDING:
		return string(activitiessvc.StatusPending)
	default:
		logger.Warn("unrecognized status from activities-service", "status", s)
		return ""
	}
}

// detailsJSON re-embeds activities-service's JSON-string details field as a
// raw JSON value; empty/malformed input falls back to "{}" rather than
// breaking the whole response over one activity's detail data.
func detailsJSON(details string) json.RawMessage {
	if !json.Valid([]byte(details)) {
		return json.RawMessage("{}")
	}
	return json.RawMessage(details)
}

// nonNilTags guards against proto3's repeated-field getters returning nil
// for an unset field: the DTO has no `omitempty`, so a nil slice would
// serialize as JSON null instead of [] and crash clients that assume tags
// is always an array (see ActivityDetailScreen.tsx's `activity.tags.length`).
func nonNilTags(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}

func toPhotoDTOs(photos []*activitiesv1.Photo) []photoDTO {
	out := make([]photoDTO, len(photos))
	for i, p := range photos {
		dto := photoDTO{URI: p.GetUrl()}
		if p.GetAuthor() != "" {
			dto.Attribution = &attributionDTO{Author: p.GetAuthor(), Link: p.GetAuthorLink()}
		}
		out[i] = dto
	}
	return out
}

func toDomainCategory(c activitiesv1.Category, logger *slog.Logger) activitiessvc.Category {
	switch c {
	case activitiesv1.Category_CATEGORY_RESTAURANTS:
		return activitiessvc.CategoryRestaurants
	case activitiesv1.Category_CATEGORY_CAFES:
		return activitiessvc.CategoryCafes
	case activitiesv1.Category_CATEGORY_BARS:
		return activitiessvc.CategoryBars
	case activitiesv1.Category_CATEGORY_NIGHTLIFE:
		return activitiessvc.CategoryNightlife
	case activitiesv1.Category_CATEGORY_NATURE:
		return activitiessvc.CategoryNature
	case activitiesv1.Category_CATEGORY_SPORT:
		return activitiessvc.CategorySport
	case activitiesv1.Category_CATEGORY_KIDS:
		return activitiessvc.CategoryKids
	case activitiesv1.Category_CATEGORY_CULTURE:
		return activitiessvc.CategoryCulture
	case activitiesv1.Category_CATEGORY_ART:
		return activitiessvc.CategoryArt
	case activitiesv1.Category_CATEGORY_WELLNESS:
		return activitiessvc.CategoryWellness
	case activitiesv1.Category_CATEGORY_SHOPPING:
		return activitiessvc.CategoryShopping
	case activitiesv1.Category_CATEGORY_ENTERTAINMENT:
		return activitiessvc.CategoryEntertainment
	default:
		logger.Warn("unrecognized category from activities-service", "category", c)
		return ""
	}
}
