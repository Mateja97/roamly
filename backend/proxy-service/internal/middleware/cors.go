// Package middleware holds HTTP middleware shared across proxy-service handlers.
package middleware

import "net/http"

// CORS reflects the request Origin so browser clients (the Expo web build,
// frontend/) can call this HTTP edge from a different origin/port. Safe to
// reflect unconditionally here: these endpoints are stateless and carry no
// cookies/credentials, so there's no session to leak cross-origin.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			// PATCH and X-Admin-Token (T2) support the admin panel's write
			// endpoints; every other route ignores both.
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token")
			// This is a global CORS wrapper, not admin-only — the public
			// app's POST /activities/query also preflights (its JSON body
			// isn't a "simple" content-type), so 0 would force an OPTIONS
			// round-trip before every single query on that hot path
			// forever. 300s bounds the window instead: short enough that a
			// stale preflight (cached before a route/method change) can't
			// outlive a redeploy in practice, as it did for T2's PATCH
			// rollout, without giving up caching on the frequent path.
			w.Header().Set("Access-Control-Max-Age", "300")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
