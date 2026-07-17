package api

import (
	"log/slog"
	"net/http"

	"proxy-service/internal/middleware"
)

// RegisterAdminRoutes wires the T2 admin surface onto mux, every route
// gated by middleware.AdminAuth. When adminToken is empty, it registers
// nothing at all — fail closed: an unset/empty token must mean "these
// routes don't exist", never "everything allowed" — and returns false so
// the caller (main.go) can log that /admin is disabled.
func RegisterAdminRoutes(mux *http.ServeMux, client adminActivitiesClient, adminToken string, logger *slog.Logger) bool {
	if adminToken == "" {
		return false
	}
	adminAuth := middleware.AdminAuth(adminToken, logger)
	mux.Handle("GET /admin/activities", adminAuth(http.HandlerFunc(NewAdminListActivitiesHandler(client, logger).Handle)))
	mux.Handle("GET /admin/activities/{id}", adminAuth(http.HandlerFunc(NewAdminGetActivityHandler(client, logger).Handle)))
	mux.Handle("PATCH /admin/activities/{id}", adminAuth(http.HandlerFunc(NewAdminPatchActivityHandler(client, logger).Handle)))
	mux.Handle("POST /admin/activities", adminAuth(http.HandlerFunc(NewAdminCreateActivityHandler(client, logger).Handle)))
	mux.Handle("POST /admin/activities/{id}/photos", adminAuth(http.HandlerFunc(NewAdminUploadPhotoHandler(client, logger).Handle)))
	return true
}
