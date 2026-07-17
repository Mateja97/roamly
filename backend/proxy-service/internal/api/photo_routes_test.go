package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRegisterPhotoRoutes_ServesFileFromRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "1"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "1", "abc.jpg"), []byte("fake-jpeg-bytes"), 0o644); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}

	mux := http.NewServeMux()
	RegisterPhotoRoutes(mux, root)

	req := httptest.NewRequest(http.MethodGet, "/photos/1/abc.jpg", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "fake-jpeg-bytes" {
		t.Errorf("body = %q, want fixture contents", rec.Body.String())
	}
}

func TestRegisterPhotoRoutes_MissingFileIs404(t *testing.T) {
	mux := http.NewServeMux()
	RegisterPhotoRoutes(mux, t.TempDir())

	req := httptest.NewRequest(http.MethodGet, "/photos/1/missing.jpg", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// TestRegisterPhotoRoutes_DoesNotShadowAdminRoutes proves the acceptance
// criterion: registering /photos/ alongside /admin/* must not intercept
// admin traffic.
func TestRegisterPhotoRoutes_DoesNotShadowAdminRoutes(t *testing.T) {
	mux := http.NewServeMux()
	RegisterPhotoRoutes(mux, t.TempDir())
	if !RegisterAdminRoutes(mux, &fakeAdminActivitiesClient{}, "secret", slog.New(slog.DiscardHandler)) {
		t.Fatal("RegisterAdminRoutes() = false")
	}

	req := httptest.NewRequest(http.MethodGet, "/admin/activities", nil)
	req.Header.Set("X-Admin-Token", "secret")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code == http.StatusNotFound {
		t.Error("GET /admin/activities = 404, want the admin route still registered")
	}
}
