package api

import "net/http"

// RegisterPhotoRoutes serves GET /photos/... straight off the shared
// /data/photos volume (root), stdlib http.FileServer. Public — no
// adminAuth: the app needs these images. Registered as its own subtree
// pattern ("/photos/"), which Go's ServeMux can never confuse with
// "/admin/..." or any other existing route.
func RegisterPhotoRoutes(mux *http.ServeMux, root string) {
	mux.Handle("GET /photos/", http.StripPrefix("/photos/", http.FileServer(http.Dir(root))))
}
