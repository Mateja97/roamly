package middleware

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminAuth(t *testing.T) {
	tests := []struct {
		name       string
		token      string
		gotHeader  string
		wantCalled bool
		wantStatus int
	}{
		{"correct token allows the request through", "secret", "secret", true, http.StatusOK},
		{"missing token header rejected", "secret", "", false, http.StatusForbidden},
		{"wrong token rejected", "secret", "wrong", false, http.StatusForbidden},
		{"a token that is a prefix of the real one is still rejected", "secret", "secr", false, http.StatusForbidden},
		{"a longer token containing the real one is still rejected", "secret", "secretmore", false, http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, "/admin/activities", nil)
			if tt.gotHeader != "" {
				req.Header.Set("X-Admin-Token", tt.gotHeader)
			}
			rec := httptest.NewRecorder()

			AdminAuth(tt.token, slog.New(slog.DiscardHandler))(next).ServeHTTP(rec, req)

			if called != tt.wantCalled {
				t.Errorf("wrapped handler called = %v, want %v", called, tt.wantCalled)
			}
			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if !tt.wantCalled && rec.Body.String() == "" {
				t.Error("rejected request should still get a JSON error body")
			}
		})
	}
}

func TestAdminAuth_RejectedBodyIsTheStandardErrorShape(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/admin/activities", nil)
	rec := httptest.NewRecorder()

	AdminAuth("secret", slog.New(slog.DiscardHandler))(http.NotFoundHandler()).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	const want = `{"error":"invalid or missing admin token"}` + "\n"
	if rec.Body.String() != want {
		t.Errorf("body = %q, want %q", rec.Body.String(), want)
	}
}
