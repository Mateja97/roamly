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
// for the exposure: no directory-shaped request may enumerate the volume
// or land on a listing — pinned to its exact status per shape, including
// the bare "/photos" mux subtree redirect, so a future route-pattern
// change can't silently reopen the listing through that redirect.
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

	tests := []struct {
		path         string
		wantCode     int
		wantLocation string // "" = not checked
	}{
		{path: "/photos", wantCode: http.StatusTemporaryRedirect, wantLocation: "/photos/"},
		{path: "/photos/", wantCode: http.StatusNotFound},
		{path: "/photos/1", wantCode: http.StatusNotFound},
		{path: "/photos/1/", wantCode: http.StatusNotFound},
	}
	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != tt.wantCode {
			t.Errorf("GET %s: status = %d, want %d", tt.path, rec.Code, tt.wantCode)
		}
		if tt.wantLocation != "" {
			if loc := rec.Header().Get("Location"); loc != tt.wantLocation {
				t.Errorf("GET %s: Location = %q, want %q", tt.path, loc, tt.wantLocation)
			}
		}
		if strings.Contains(rec.Body.String(), "abc.jpg") {
			t.Errorf("GET %s: body leaks directory contents: %q", tt.path, rec.Body.String())
		}
	}
}

// TestRegisterPhotoRoutes_TraversalStillRejected proves the directory
// wrapper doesn't weaken http.Dir's existing ".." rejection. Pinned to
// exact status per encoding: a plain ".." is redirected out of the
// /photos/ subtree by ServeMux's own path cleaning (307, off-prefix
// Location, never reaches http.Dir); the percent-encoded forms reach
// http.Dir as a literal ".." and 404. Asserting only "not 200" would let
// a 500 (a crash, not a rejection) pass silently.
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

	tests := []struct {
		path     string
		wantCode int
	}{
		{path: "/photos/../secret.txt", wantCode: http.StatusTemporaryRedirect},
		{path: "/photos/..%2fsecret.txt", wantCode: http.StatusNotFound},
		{path: "/photos/..%252fsecret.txt", wantCode: http.StatusNotFound},
	}
	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != tt.wantCode {
			t.Errorf("GET %s: status = %d, want %d", tt.path, rec.Code, tt.wantCode)
		}
		if strings.Contains(rec.Body.String(), "nope") {
			t.Errorf("GET %s: body leaked file outside root: %q", tt.path, rec.Body.String())
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
