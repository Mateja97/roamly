package photo

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	sharederrors "backend/shared/errors"
)

// fakePNG returns a blank w x h PNG — only its dimensions matter to these
// tests (decode success/failure and resize output size), not its pixels.
func fakePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatalf("encoding fixture PNG: %v", err)
	}
	return buf.Bytes()
}

func decodedEdge(t *testing.T, path string) int {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("opening %s: %v", path, err)
	}
	defer func() { _ = f.Close() }()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		t.Fatalf("decoding %s: %v", path, err)
	}
	return max(cfg.Width, cfg.Height)
}

func TestSave_RejectsNonImage(t *testing.T) {
	s := NewStore(t.TempDir())

	_, _, err := s.Save("activity-1", []byte("this is definitely not an image"))
	if !errors.Is(err, sharederrors.ErrInvalidInput) {
		t.Fatalf("Save() error = %v, want ErrInvalidInput", err)
	}
}

func TestSave_ProducesBothSizes(t *testing.T) {
	root := t.TempDir()
	s := NewStore(root)

	url, thumbURL, err := s.Save("activity-1", fakePNG(t, 3000, 1500))
	if err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	mainPath := filepath.Join(root, "activity-1", filepath.Base(url))
	thumbPath := filepath.Join(root, "activity-1", filepath.Base(thumbURL))

	if got := decodedEdge(t, mainPath); got != mainMaxEdge {
		t.Errorf("main photo longest edge = %d, want %d", got, mainMaxEdge)
	}
	if got := decodedEdge(t, thumbPath); got != thumbMaxEdge {
		t.Errorf("thumbnail longest edge = %d, want %d", got, thumbMaxEdge)
	}
}

func TestSave_DoesNotUpscaleASmallImage(t *testing.T) {
	root := t.TempDir()
	s := NewStore(root)

	url, _, err := s.Save("activity-1", fakePNG(t, 100, 80))
	if err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	mainPath := filepath.Join(root, "activity-1", filepath.Base(url))
	if got := decodedEdge(t, mainPath); got != 100 {
		t.Errorf("main photo longest edge = %d, want 100 (unchanged, never upscaled)", got)
	}
}

func TestSave_RejectsTraversalInActivityID(t *testing.T) {
	tests := []string{"../evil", "/etc/passwd", "..", ".", "", "a/b"}
	for _, id := range tests {
		t.Run(id, func(t *testing.T) {
			s := NewStore(t.TempDir())
			_, _, err := s.Save(id, fakePNG(t, 10, 10))
			if !errors.Is(err, sharederrors.ErrInvalidInput) {
				t.Errorf("Save(%q) error = %v, want ErrInvalidInput", id, err)
			}
		})
	}
}

// writeFile creates path (and its parent dir) with arbitrary content —
// Unlink only cares that the file existed, not what's in it.
func writeFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("creating %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
}

func exists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	if err == nil {
		return true
	}
	if os.IsNotExist(err) {
		return false
	}
	t.Fatalf("stat %s: %v", path, err)
	return false
}

func TestUnlink(t *testing.T) {
	tests := []struct {
		name       string
		url        string
		skipCreate bool // don't pre-create filePath, to prove an already-gone file isn't an error
		wantErr    bool
		wantExists bool // whether the file at filePath still exists after Unlink
	}{
		{name: "removes a photo url under root", url: "/photos/act1/photo.jpg", wantExists: false},
		{name: "already-gone file is not an error", url: "/photos/act1/photo.jpg", skipCreate: true, wantExists: false},
		{name: "google url is left untouched", url: "https://maps.googleapis.com/photo.jpg", wantExists: true},
		{name: "traversal url is rejected, not followed", url: "/photos/../escape.jpg", wantErr: true, wantExists: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			// filePath is where the guarded case ("removes...") expects the
			// file; the traversal case deliberately plants its decoy one
			// level above root, which "/photos/../escape.jpg" resolves to.
			filePath := filepath.Join(root, "act1", "photo.jpg")
			if tt.url == "/photos/../escape.jpg" {
				filePath = filepath.Join(root, "..", "escape.jpg")
			}
			if !tt.skipCreate {
				writeFile(t, filePath)
			}

			s := NewStore(root)
			err := s.Unlink(tt.url)
			if tt.wantErr && err == nil {
				t.Fatal("Unlink() error = nil, want error")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("Unlink() error = %v, want nil", err)
			}
			if got := exists(t, filePath); got != tt.wantExists {
				t.Errorf("file exists = %v, want %v", got, tt.wantExists)
			}
		})
	}
}
