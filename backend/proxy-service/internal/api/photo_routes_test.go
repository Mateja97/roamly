package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg", ct)
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

// TestRegisterPhotoRoutes_DirectoriesAreNotListed is the regression guard
// for the exposure: no bare, nested, or trailing-slash directory request
// may enumerate the volume or 301-redirect toward a listing — all must
// 404 like a missing file.
func TestRegisterPhotoRoutes_DirectoriesAreNotListed(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "1"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "1", "abc.jpg"), []byte("fake-jpeg-bytes"), 0o644); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}

	mux := http.NewServeMux()
	RegisterPhotoRoutes(mux, root)

	for _, path := range []string{"/photos/", "/photos/1", "/photos/1/"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want 404 (not a redirect or listing)", path, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "abc.jpg") {
			t.Errorf("GET %s: body leaks directory contents: %q", path, rec.Body.String())
		}
	}
}

// TestRegisterPhotoRoutes_TraversalStillRejected proves the directory
// wrapper doesn't weaken http.Dir's existing ".." rejection, including an
// encoded variant that net/http decodes before routing.
func TestRegisterPhotoRoutes_TraversalStillRejected(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "abc.jpg"), []byte("fake-jpeg-bytes"), 0o644); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatalf("write outside fixture: %v", err)
	}

	mux := http.NewServeMux()
	RegisterPhotoRoutes(mux, root)

	for _, path := range []string{"/photos/../secret.txt", "/photos/..%2fsecret.txt"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code == http.StatusOK {
			t.Errorf("GET %s: status = 200, want traversal rejected", path)
		}
		if strings.Contains(rec.Body.String(), "nope") {
			t.Errorf("GET %s: body leaked file outside root: %q", path, rec.Body.String())
		}
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
