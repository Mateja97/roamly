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
