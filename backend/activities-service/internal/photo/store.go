// Package photo turns an admin-uploaded image's bytes into stored files: it
// is the sole writer of activities-service's /data/photos volume, and it
// never touches the database — a sibling to repository, not a layer inside
// it. Decoding IS the content-type check (image/jpeg + image/png are the
// only registered decoders here, so a decode failure means "not one of
// those two formats", regardless of what the client claimed).
package photo

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png" // registers the PNG decoder; only jpeg+png are accepted
	"os"
	"path"
	"path/filepath"
	"strings"

	"golang.org/x/image/draw"

	sharederrors "backend/shared/errors"
)

const (
	mainMaxEdge  = 2000
	thumbMaxEdge = 256
	jpegQuality  = 85
	dirPerm      = 0o755
)

// Store saves resized copies of uploaded photos under root, one
// subdirectory per activity.
type Store struct {
	root string
}

// NewStore returns a Store rooted at root (e.g. "/data/photos").
func NewStore(root string) *Store {
	return &Store{root: root}
}

// Save decodes data as a JPEG or PNG image (a decode failure is the
// content-type rejection — never a trust of client-supplied MIME type or
// file extension), downscales it to a 2000px and a 256px longest-edge JPEG
// (never upscaled), and writes both under root/activityID. It returns the
// pair of /photos/... URLs proxy-service's public file server exposes.
func (s *Store) Save(activityID string, data []byte) (url, thumbURL string, err error) {
	dir, err := s.activityDir(activityID)
	if err != nil {
		return "", "", err
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", "", fmt.Errorf("%w: not a decodable JPEG/PNG image", sharederrors.ErrInvalidInput)
	}

	if err := os.MkdirAll(dir, dirPerm); err != nil {
		return "", "", fmt.Errorf("creating photo directory: %w", err)
	}

	id := randomID()
	mainName, thumbName := id+".jpg", id+"_t.jpg"
	if err := saveResized(img, filepath.Join(dir, mainName), mainMaxEdge); err != nil {
		return "", "", fmt.Errorf("saving photo: %w", err)
	}
	if err := saveResized(img, filepath.Join(dir, thumbName), thumbMaxEdge); err != nil {
		return "", "", fmt.Errorf("saving thumbnail: %w", err)
	}

	return path.Join("/photos", activityID, mainName), path.Join("/photos", activityID, thumbName), nil
}

// Unlink removes photoURL's file, but only when every guard holds (T2):
//
//   - Ours to delete: photoURL must carry the /photos/ prefix every URL Save
//     returns starts with. A Google-sourced URL never does, and is left
//     untouched — this returns nil, not an error, since "not ours" is the
//     expected outcome for most photos on most saves.
//   - Inside the root: the resolved path must land inside root. A photos[]
//     entry reaches here from an admin PATCH body, not just from Save, so a
//     hand-crafted "/photos/../../etc/passwd" must be rejected rather than
//     followed.
//
// A file that is already gone is treated as success (nil), not an error —
// Unlink's job is "this file must not exist afterward", which already
// holds. Any other failure, including either guard above, is returned for
// the caller to log at warn; Unlink never fails on its own, and the caller
// (UpdateActivity, T2) never fails the request over an unlink error.
func (s *Store) Unlink(photoURL string) error {
	// "/photos/" is the leading path segment every URL Save returns starts
	// with (see its path.Join("/photos", ...) above) — the "ours to
	// delete" guard.
	rel, ok := strings.CutPrefix(photoURL, "/photos/")
	if !ok {
		return nil
	}

	full := filepath.Join(s.root, filepath.FromSlash(rel))
	if !withinRoot(s.root, full) {
		return fmt.Errorf("%w: photo url %q resolves outside %s", sharederrors.ErrInvalidInput, photoURL, s.root)
	}

	if err := os.Remove(full); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing photo %s: %w", full, err)
	}
	return nil
}

// withinRoot reports whether path resolves inside root once both are made
// absolute — the path-traversal guard Unlink applies before removing
// anything.
func withinRoot(root, path string) bool {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// activityDir validates activityID before it ever reaches a filesystem
// path: filepath.Base(activityID) == activityID rejects any path separator
// or ".."/"." component (e.g. "../etc" -> Base "etc" != input), so nothing
// can escape root.
func (s *Store) activityDir(activityID string) (string, error) {
	if activityID == "" || activityID == "." || activityID == ".." || filepath.Base(activityID) != activityID {
		return "", fmt.Errorf("%w: invalid activity id %q", sharederrors.ErrInvalidInput, activityID)
	}
	return filepath.Join(s.root, activityID), nil
}

// saveResized downscales img to maxEdge's longest side and JPEG-encodes it
// to path.
func saveResized(img image.Image, path string, maxEdge int) (err error) {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}()
	return jpeg.Encode(f, resizeToMaxEdge(img, maxEdge), &jpeg.Options{Quality: jpegQuality})
}

// resizeToMaxEdge downscales img so its longest edge is maxEdge, preserving
// aspect ratio; an image already at or under maxEdge is returned unchanged
// (never upscaled).
func resizeToMaxEdge(img image.Image, maxEdge int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	longest := max(w, h)
	if longest <= maxEdge {
		return img
	}

	scale := float64(maxEdge) / float64(longest)
	dst := image.NewRGBA(image.Rect(0, 0, int(float64(w)*scale), int(float64(h)*scale)))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
	return dst
}

// randomID returns a UUID-shaped random hex string. crypto/rand + hex
// covers what a filename needs; the RFC 4122 version/variant bits don't
// matter for a filename, so this skips a real UUID dependency.
func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("crypto/rand: %v", err)) // ponytail: crypto/rand.Read only fails if the OS's CSPRNG is broken — unrecoverable, not worth threading an error return through Save for.
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
