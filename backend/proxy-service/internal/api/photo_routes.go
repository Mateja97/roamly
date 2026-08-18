package api

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
)

// noDirListingFS wraps an http.FileSystem so Open refuses directories,
// making them behave like a missing file (404) instead of the underlying
// FileServer's directory-index / redirect-to-index behaviour. FileServer
// only lists a directory (or 301s "/sub" to "/sub/" first) once Open
// succeeds and Stat says IsDir — refusing it here, before FileServer ever
// sees a directory, covers both cases with one check. Also normalizes
// every Open failure to plain fs.ErrNotExist: the wrapped filesystem is
// os.Root-backed (see RegisterPhotoRoutes below), and os.Root reports a
// symlink that escapes the root with its own error, not one that
// os.IsNotExist recognizes — left unwrapped, FileServer would answer a
// symlink-escape attempt with 500 instead of the 404 every other
// rejection (missing file, traversal, directory) already gets here.
//
// ponytail: skips a custom http.Handler wrapper that inspects the response
// after FileServer writes it (can't un-send a 200) and skips replacing
// FileServer with a hand-rolled file-serving handler (loses Range/If-*
// support FileServer already gives for free). A one-method http.FileSystem
// is the smallest hook stdlib exposes before FileServer decides to list —
// collapsing every error case (including a genuine permission error) to
// 404 is deliberate: this route is public and unauthenticated, so there's
// no caller who should ever see the difference between "missing" and
// "rejected".
type noDirListingFS struct {
	inner http.FileSystem
}

func (nfs noDirListingFS) Open(name string) (http.File, error) {
	f, err := nfs.inner.Open(name)
	if err != nil {
		return nil, fs.ErrNotExist
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, fs.ErrNotExist
	}
	if info.IsDir() {
		_ = f.Close()
		return nil, fs.ErrNotExist
	}
	return f, nil
}

// RegisterPhotoRoutes serves GET /photos/... straight off the shared
// /data/photos volume (root), stdlib http.FileServer. Public — no
// adminAuth: the app needs these images. Registered as its own subtree
// pattern ("/photos/"), which Go's ServeMux can never confuse with
// "/admin/..." or any other existing route. Directory requests (bare or
// nested) 404 via noDirListingFS instead of listing the volume.
//
// root is opened via os.OpenRoot instead of http.Dir: http.Dir rejects
// ".." in the request path but still follows a symlink that lives inside
// root and points outside it, serving whatever is on the other end.
// activities-service writes this volume from remotely-sourced photo data,
// so a symlink landing in it isn't something to assume away. os.Root
// confines every Open (symlink or not) to inside root and errors on
// anything that would escape, closing that hole while leaving in-root
// symlinks, Range requests, conditional requests, and content-type
// sniffing untouched — they all still go through the same
// http.FileServer.
func RegisterPhotoRoutes(mux *http.ServeMux, root string) error {
	r, err := os.OpenRoot(root)
	if err != nil {
		return fmt.Errorf("opening photos root %q: %w", root, err)
	}
	mux.Handle("GET /photos/", http.StripPrefix("/photos/", http.FileServer(noDirListingFS{inner: http.FS(r.FS())})))
	return nil
}
