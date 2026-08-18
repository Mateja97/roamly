package api

import (
	"io/fs"
	"net/http"
)

// noDirListingFS wraps an http.FileSystem so Open refuses directories,
// making them behave like a missing file (404) instead of the underlying
// FileServer's directory-index / redirect-to-index behaviour. FileServer
// only lists a directory (or 301s "/sub" to "/sub/" first) once Open
// succeeds and Stat says IsDir — refusing it here, before FileServer ever
// sees a directory, covers both cases with one check. Delegates entirely
// to the wrapped http.Dir for path resolution, so its traversal rejection
// (no "..") is untouched.
//
// ponytail: skips a custom http.Handler wrapper that inspects the response
// after FileServer writes it (can't un-send a 200) and skips replacing
// FileServer with a hand-rolled file-serving handler (loses Range/If-*
// support FileServer already gives for free). A one-method http.FileSystem
// is the smallest hook stdlib exposes before FileServer decides to list.
type noDirListingFS struct {
	inner http.FileSystem
}

func (nfs noDirListingFS) Open(name string) (http.File, error) {
	f, err := nfs.inner.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
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
func RegisterPhotoRoutes(mux *http.ServeMux, root string) {
	mux.Handle("GET /photos/", http.StripPrefix("/photos/", http.FileServer(noDirListingFS{inner: http.Dir(root)})))
}
