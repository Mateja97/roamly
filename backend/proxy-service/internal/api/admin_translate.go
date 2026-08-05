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

// adminActivitiesClient is the subset of shared/clients/activitiessvc.Client
// the admin (T2) handlers need.
type adminActivitiesClient interface {
	ListActivities(ctx context.Context, req *activitiesv1.ListActivitiesRequest) (*activitiesv1.ListActivitiesResponse, error)
	GetActivity(ctx context.Context, req *activitiesv1.GetActivityRequest) (*activitiesv1.Activity, error)
	CreateActivity(ctx context.Context, req *activitiesv1.CreateActivityRequest) (*activitiesv1.Activity, error)
	UpdateActivity(ctx context.Context, req *activitiesv1.UpdateActivityRequest) (*activitiesv1.Activity, error)
	UploadPhoto(ctx context.Context, req *activitiesv1.UploadPhotoRequest) (*activitiesv1.UploadPhotoResponse, error)
	ListAdminCities(ctx context.Context, req *activitiesv1.ListAdminCitiesRequest) (*activitiesv1.ListAdminCitiesResponse, error)
}

// adminPhotoDTO is the admin surface's photo shape: url plus the T1
// additions thumb_url/caption — no attribution wrapper, that's the public
// app card's concern, per product-tasks.md's T2 response shape.
type adminPhotoDTO struct {
	URL      string `json:"url"`
	ThumbURL string `json:"thumb_url,omitempty"`
	Caption  string `json:"caption,omitempty"`
}

type adminStatsDTO struct {
	Total     int `json:"total"`
	Published int `json:"published"`
	Draft     int `json:"draft"`
	Pending   int `json:"pending"`
}

// adminActivityListItemDTO is the admin list's row shape: a subset of the
// full activity, per product-tasks.md's T2 response shape.
type adminActivityListItemDTO struct {
	ID       string          `json:"id"`
	Title    string          `json:"title"`
	Category string          `json:"category"`
	City     string          `json:"city"`
	Status   string          `json:"status"`
	Rating   float64         `json:"rating"`
	Photos   []adminPhotoDTO `json:"photos"`
}

// adminLocationDTO is the admin DTO's coordinate pair (T3,
// admin-activities-schema-resync) — mirrors the proto's Location shape.
type adminLocationDTO struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// adminActivityDTO is the full admin activity view: GetActivity's response,
// and the created/updated activity CreateActivity/PatchActivity return.
type adminActivityDTO struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	City        string          `json:"city"`
	Address     string          `json:"address"`
	Status      string          `json:"status"`
	Rating      float64         `json:"rating"`
	Details     json.RawMessage `json:"details"`
	Photos      []adminPhotoDTO `json:"photos"`
	// Subcategory (T1) is the optional, category-validated subtype slug;
	// "" when not set.
	Subcategory string `json:"subcategory"`
	// Location (T3, admin-activities-schema-resync) is nil/omitted when the
	// activity has no real coordinates (Null Island, (0,0) — every
	// admin-created row) rather than a fabricated {0,0} that would render
	// the map preview over the Gulf of Guinea.
	Location *adminLocationDTO `json:"location,omitempty"`
	// CreatedAt (T3, admin-activities-schema-resync) is RFC3339-formatted,
	// already formatted upstream by activities-service; "" (also omitted)
	// on the same not-yet-scanned edge case toProtoActivity's doc names.
	CreatedAt string `json:"created_at,omitempty"`
}

type listActivitiesResponseDTO struct {
	Activities []adminActivityListItemDTO `json:"activities"`
	Total      int                        `json:"total"`
	Page       int                        `json:"page"`
	PageSize   int                        `json:"page_size"`
	Stats      adminStatsDTO              `json:"stats"`
}

func toAdminPhotoDTOs(photos []*activitiesv1.Photo) []adminPhotoDTO {
	out := make([]adminPhotoDTO, len(photos))
	for i, p := range photos {
		out[i] = adminPhotoDTO{URL: p.GetUrl(), ThumbURL: p.GetThumbUrl(), Caption: p.GetCaption()}
	}
	return out
}

func toProtoPhotoList(photos []adminPhotoDTO) []*activitiesv1.Photo {
	out := make([]*activitiesv1.Photo, len(photos))
	for i, p := range photos {
		out[i] = &activitiesv1.Photo{Url: p.URL, ThumbUrl: p.ThumbURL, Caption: p.Caption}
	}
	return out
}

func toAdminActivityListItemDTO(a *activitiesv1.Activity, logger *slog.Logger) adminActivityListItemDTO {
	return adminActivityListItemDTO{
		ID:       a.GetId(),
		Title:    a.GetTitle(),
		Category: string(toDomainCategory(a.GetCategory(), logger)),
		City:     a.GetCity(),
		Status:   toDomainStatus(a.GetStatus(), logger),
		Rating:   a.GetRating(),
		Photos:   toAdminPhotoDTOs(a.GetPhotos()),
	}
}

func toAdminActivityDTO(a *activitiesv1.Activity, logger *slog.Logger) adminActivityDTO {
	return adminActivityDTO{
		ID:          a.GetId(),
		Title:       a.GetTitle(),
		Description: a.GetDescription(),
		Category:    string(toDomainCategory(a.GetCategory(), logger)),
		City:        a.GetCity(),
		Address:     a.GetAddress(),
		Status:      toDomainStatus(a.GetStatus(), logger),
		Rating:      a.GetRating(),
		Details:     detailsJSON(a.GetDetails()),
		Photos:      toAdminPhotoDTOs(a.GetPhotos()),
		Subcategory: a.GetSubcategory(),
		Location:    toAdminLocationDTO(a.GetLocation()),
		CreatedAt:   a.GetCreatedAt(),
	}
}

// toAdminLocationDTO omits the coordinate pair entirely for (0,0) — Null
// Island, the sentinel every admin-created row's location scans as (no
// admin-facing geocoding exists yet, see repository.Create's doc) — rather
// than surfacing a fabricated real-looking coordinate.
func toAdminLocationDTO(l *activitiesv1.Location) *adminLocationDTO {
	if l.GetLat() == 0 && l.GetLng() == 0 {
		return nil
	}
	return &adminLocationDTO{Lat: l.GetLat(), Lng: l.GetLng()}
}

// toProtoStatus is the admin write path's wire string -> proto enum, the
// reverse of toDomainStatus — mirrors toProtoCategory's shape (string in,
// enum + ok out) so an unknown status 400s the same way an unknown category
// does.
func toProtoStatus(s string) (activitiesv1.ActivityStatus, bool) {
	switch activitiessvc.Status(s) {
	case activitiessvc.StatusPublished:
		return activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED, true
	case activitiessvc.StatusDraft:
		return activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT, true
	case activitiessvc.StatusPending:
		return activitiesv1.ActivityStatus_ACTIVITY_STATUS_PENDING, true
	default:
		return activitiesv1.ActivityStatus_ACTIVITY_STATUS_UNSPECIFIED, false
	}
}

// writeGRPCError maps a gRPC status code from an activities-service call
// onto proxy-service's fixed HTTP status set, per
// backend/proxy-service/README.md's table. QueryActivities/SuggestCities
// never return NotFound/AlreadyExists/PermissionDenied, so the admin
// endpoints are the first callers needing the full table.
func writeGRPCError(w http.ResponseWriter, err error, logger *slog.Logger) {
	switch status.Code(err) {
	case codes.NotFound:
		writeError(w, http.StatusNotFound, "not found", logger)
	case codes.InvalidArgument, codes.FailedPrecondition:
		writeError(w, http.StatusBadRequest, status.Convert(err).Message(), logger)
	case codes.PermissionDenied, codes.Unauthenticated:
		writeError(w, http.StatusForbidden, "forbidden", logger)
	case codes.AlreadyExists:
		writeError(w, http.StatusConflict, "conflict", logger)
	default:
		logger.Error("admin activities call failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error", logger)
	}
}
