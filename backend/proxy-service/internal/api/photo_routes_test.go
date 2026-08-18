package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// symlinkOrSkip creates a symlink and skips the test (not fails) if the
// platform/environment refuses symlink creation (e.g. no privilege).
func symlinkOrSkip(t *testing.T, oldname, newname string) {
	t.Helper()
	if err := os.Symlink(oldname, newname); err != nil {
		t.Skipf("symlinks not supported here: %v", err)
	}
}

func TestRegisterPhotoRoutes_ServesFileFromRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "1"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "1", "abc.jpg"), []byte("fake-jpeg-bytes"), 0o644); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}

	mux := http.NewServeMux()
	if err := RegisterPhotoRoutes(mux, root); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}

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
	if err := RegisterPhotoRoutes(mux, t.TempDir()); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}

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
	if err := RegisterPhotoRoutes(mux, root); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}

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
	if err := RegisterPhotoRoutes(mux, root); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}

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
	if err := RegisterPhotoRoutes(mux, t.TempDir()); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}
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

// TestRegisterPhotoRoutes_SymlinkEscapingRootNotServed is the regression
// guard for the symlink-escape exposure: http.Dir follows a symlink inside
// root straight to a target outside it, serving that target's bytes with a
// 200. os.Root (via RegisterPhotoRoutes) must refuse this instead.
func TestRegisterPhotoRoutes_SymlinkEscapingRootNotServed(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("outside-root-secret-bytes"), 0o644); err != nil {
		t.Fatalf("write outside fixture: %v", err)
	}
	relTarget, err := filepath.Rel(root, secret)
	if err != nil {
		t.Fatalf("filepath.Rel: %v", err)
	}
	symlinkOrSkip(t, relTarget, filepath.Join(root, "link.txt"))

	mux := http.NewServeMux()
	if err := RegisterPhotoRoutes(mux, root); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/photos/link.txt", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Errorf("status = 200, want the escaping symlink rejected")
	}
	if strings.Contains(rec.Body.String(), "outside-root-secret-bytes") {
		t.Errorf("body leaked file outside root: %q", rec.Body.String())
	}
}

// TestRegisterPhotoRoutes_SymlinkToOutsideDirNotServed is the directory
// variant: a symlink inside root pointing at a directory outside it must
// not make that directory's files reachable through the subtree.
func TestRegisterPhotoRoutes_SymlinkToOutsideDirNotServed(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("outside-dir-secret"), 0o644); err != nil {
		t.Fatalf("write outside fixture: %v", err)
	}
	relTarget, err := filepath.Rel(root, outside)
	if err != nil {
		t.Fatalf("filepath.Rel: %v", err)
	}
	symlinkOrSkip(t, relTarget, filepath.Join(root, "linkdir"))

	mux := http.NewServeMux()
	if err := RegisterPhotoRoutes(mux, root); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/photos/linkdir/secret.txt", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Errorf("status = 200, want the escaping symlink rejected")
	}
	if strings.Contains(rec.Body.String(), "outside-dir-secret") {
		t.Errorf("body leaked file outside root: %q", rec.Body.String())
	}
}

// TestRegisterPhotoRoutes_SymlinkInsideRootIsServed pins the chosen
// behaviour for a symlink that stays inside root: it does not escape, so
// os.Root permits it and it stays servable — same as any other file.
func TestRegisterPhotoRoutes_SymlinkInsideRootIsServed(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "real.jpg"), []byte("fake-jpeg-bytes"), 0o644); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}
	symlinkOrSkip(t, "real.jpg", filepath.Join(root, "link.jpg"))

	mux := http.NewServeMux()
	if err := RegisterPhotoRoutes(mux, root); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/photos/link.jpg", nil)
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

// TestRegisterPhotoRoutes_RangeAndConditionalRequests re-pins the
// byte-identical serving behaviour #210 verified manually (http.Dir):
// Range, If-Range, If-Modified-Since, and plain serving must all still
// work unchanged now that the volume is opened via os.Root instead.
func TestRegisterPhotoRoutes_RangeAndConditionalRequests(t *testing.T) {
	root := t.TempDir()
	content := []byte("0123456789abcdef")
	path := filepath.Join(root, "abc.jpg")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat fixture: %v", err)
	}
	modTime := info.ModTime()

	mux := http.NewServeMux()
	if err := RegisterPhotoRoutes(mux, root); err != nil {
		t.Fatalf("RegisterPhotoRoutes: %v", err)
	}

	do := func(headers map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/photos/abc.jpg", nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	t.Run("plain", func(t *testing.T) {
		rec := do(nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if rec.Body.String() != string(content) {
			t.Errorf("body = %q, want %q", rec.Body.String(), content)
		}
	})

	t.Run("range", func(t *testing.T) {
		rec := do(map[string]string{"Range": "bytes=0-3"})
		if rec.Code != http.StatusPartialContent {
			t.Fatalf("status = %d, want 206", rec.Code)
		}
		if rec.Body.String() != "0123" {
			t.Errorf("body = %q, want %q", rec.Body.String(), "0123")
		}
	})

	t.Run("bad range", func(t *testing.T) {
		rec := do(map[string]string{"Range": "bytes=999-9999"})
		if rec.Code != http.StatusRequestedRangeNotSatisfiable {
			t.Fatalf("status = %d, want 416", rec.Code)
		}
	})

	t.Run("if-modified-since not modified", func(t *testing.T) {
		rec := do(map[string]string{"If-Modified-Since": modTime.Add(time.Hour).UTC().Format(http.TimeFormat)})
		if rec.Code != http.StatusNotModified {
			t.Fatalf("status = %d, want 304", rec.Code)
		}
	})

	t.Run("if-range satisfied serves partial", func(t *testing.T) {
		rec := do(map[string]string{
			"Range":    "bytes=0-3",
			"If-Range": modTime.UTC().Format(http.TimeFormat),
		})
		if rec.Code != http.StatusPartialContent {
			t.Fatalf("status = %d, want 206", rec.Code)
		}
	})
}
