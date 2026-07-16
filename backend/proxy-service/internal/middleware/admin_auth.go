package middleware

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"
)

// AdminAuth gates every /admin/* route behind a shared token (T2). The
// caller in main.go only wires this middleware onto the mux when
// ADMIN_API_TOKEN is non-empty — an unset/empty token must mean "these
// routes are never registered", never "everything allowed", so there is no
// bypass path inside AdminAuth itself; it always requires an exact match.
//
// token is compared with crypto/subtle.ConstantTimeCompare rather than ==,
// so a wrong guess can't be timed byte-by-byte against the real value.
//
// Security note: a token delivered to a browser-based admin panel is
// visible to anyone with the page's JS bundle — see
// backend/proxy-service/README.md's "Admin authentication" section for the
// accepted trade-off this represents.
func AdminAuth(token string, logger *slog.Logger) func(http.Handler) http.Handler {
	want := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got := []byte(r.Header.Get("X-Admin-Token"))
			if subtle.ConstantTimeCompare(got, want) != 1 {
				writeAdminAuthError(w, logger)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// writeAdminAuthError writes the same {"error": "..."} shape
// proxy-service/internal/api's writeError uses; duplicated here (rather
// than importing the api package into middleware) to keep middleware
// dependency-free of the transport layer it gates.
func writeAdminAuthError(w http.ResponseWriter, logger *slog.Logger) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	if err := json.NewEncoder(w).Encode(struct {
		Error string `json:"error"`
	}{Error: "invalid or missing admin token"}); err != nil {
		logger.Error("encode admin auth error response", "error", err)
	}
}
