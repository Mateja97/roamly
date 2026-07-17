package googlephotos_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"activities-service/internal/googlephotos"
)

func TestFirstPhoto(t *testing.T) {
	// Two mocked Places endpoints: searchText then media redirect.
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/places:searchText", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"places":[{"photos":[{"name":"places/X/photos/Y",
			"authorAttributions":[{"displayName":"Jane","uri":"http://author/jane"}]}]}]}`)
	})
	mux.HandleFunc("/v1/places/X/photos/Y/media", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"photoUri":"http://img/final.jpg"}`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	got, err := googlephotos.FirstPhotoWithBase(context.Background(), srv.Client(), "k", "Koffein Belgrade", srv.URL)
	if err != nil {
		t.Fatalf("FirstPhoto: %v", err)
	}
	if got.URL != "http://img/final.jpg" || got.Author != "Jane" {
		t.Fatalf("got %+v", got)
	}
}
