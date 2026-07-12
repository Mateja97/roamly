package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORS_PreflightShortCircuits(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodOptions, "/activities/query", nil)
	req.Header.Set("Origin", "http://localhost:4174")
	rec := httptest.NewRecorder()

	CORS(next).ServeHTTP(rec, req)

	if called {
		t.Fatal("preflight OPTIONS should not reach the wrapped handler")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:4174" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want reflected origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Fatal("Access-Control-Allow-Methods missing on preflight response")
	}
}

func TestCORS_RealRequestPassesThroughWithOriginHeader(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/activities/query", nil)
	req.Header.Set("Origin", "http://localhost:4174")
	rec := httptest.NewRecorder()

	CORS(next).ServeHTTP(rec, req)

	if !called {
		t.Fatal("non-preflight request should reach the wrapped handler")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:4174" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want reflected origin", got)
	}
}
