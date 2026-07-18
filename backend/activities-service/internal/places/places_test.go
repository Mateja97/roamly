package places_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"activities-service/internal/places"
)

func TestSearchText_Decoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Goog-Api-Key") != "k" {
			t.Errorf("missing api key header")
		}
		if r.Header.Get("X-Goog-FieldMask") != "places.photos" {
			t.Errorf("fieldMask = %q", r.Header.Get("X-Goog-FieldMask"))
		}
		io.WriteString(w, `{"places":[{"id":"p1","displayName":{"text":"Koffein"},"rating":4.5}],"nextPageToken":"tok2"}`)
	}))
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	got, err := c.SearchText(context.Background(), "coffee in Belgrade", "", "places.photos")
	if err != nil {
		t.Fatalf("SearchText: %v", err)
	}
	if len(got.Places) != 1 || got.Places[0].ID != "p1" || got.Places[0].DisplayName.Text != "Koffein" {
		t.Fatalf("got %+v", got)
	}
	if got.NextPageToken != "tok2" {
		t.Fatalf("NextPageToken = %q, want tok2", got.NextPageToken)
	}
}

func TestPhotoMediaURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/places/X/photos/Y/media" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("key") != "k" || r.URL.Query().Get("skipHttpRedirect") != "true" {
			t.Errorf("query = %q", r.URL.RawQuery)
		}
		io.WriteString(w, `{"photoUri":"http://img/final.jpg"}`)
	}))
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	got, err := c.PhotoMediaURL(context.Background(), "places/X/photos/Y")
	if err != nil {
		t.Fatalf("PhotoMediaURL: %v", err)
	}
	if got != "http://img/final.jpg" {
		t.Fatalf("got %q", got)
	}
}

func TestPhotoMediaURL_MissingURI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{}`)
	}))
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	if _, err := c.PhotoMediaURL(context.Background(), "places/X/photos/Y"); err == nil {
		t.Fatal("expected error for missing photoUri")
	}
}

func TestSearchText_RetriesOn429ThenSucceeds(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			io.WriteString(w, `{"error":"rate limited"}`)
			return
		}
		io.WriteString(w, `{"places":[{"id":"p1"}]}`)
	}))
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	got, err := c.SearchText(context.Background(), "q", "", "places.id")
	if err != nil {
		t.Fatalf("SearchText: %v", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 (one retry)", calls)
	}
	if len(got.Places) != 1 || got.Places[0].ID != "p1" {
		t.Fatalf("got %+v", got)
	}
}

func TestNewFromEnv(t *testing.T) {
	t.Setenv("GOOGLE_MAPS_API_KEY", "")
	if _, err := places.NewFromEnv(); err == nil {
		t.Fatal("expected error when GOOGLE_MAPS_API_KEY is unset")
	}

	t.Setenv("GOOGLE_MAPS_API_KEY", "k")
	c, err := places.NewFromEnv()
	if err != nil || c == nil {
		t.Fatalf("NewFromEnv() = %v, %v, want a client, nil", c, err)
	}
}

func TestFirstPhoto(t *testing.T) {
	tests := []struct {
		name       string
		searchBody string
		wantErr    bool
		wantAuthor string
	}{
		{
			name: "resolves photo and attribution",
			searchBody: `{"places":[{"photos":[{"name":"places/X/photos/Y",
				"authorAttributions":[{"displayName":"Jane","uri":"http://author/jane"}]}]}]}`,
			wantAuthor: "Jane",
		},
		{
			name:       "no places in result is ErrNoPhoto",
			searchBody: `{"places":[]}`,
			wantErr:    true,
		},
		{
			name:       "place with no photos is ErrNoPhoto",
			searchBody: `{"places":[{"photos":[]}]}`,
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mux := http.NewServeMux()
			mux.HandleFunc("/v1/places:searchText", func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, tt.searchBody)
			})
			mux.HandleFunc("/v1/places/X/photos/Y/media", func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `{"photoUri":"http://img/final.jpg"}`)
			})
			srv := httptest.NewServer(mux)
			defer srv.Close()

			c := places.NewWithBase("k", srv.URL)
			got, err := c.FirstPhoto(context.Background(), "Koffein Belgrade")
			if tt.wantErr {
				if !errors.Is(err, places.ErrNoPhoto) {
					t.Fatalf("FirstPhoto() error = %v, want ErrNoPhoto", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("FirstPhoto(): %v", err)
			}
			if got.URL != "http://img/final.jpg" || got.Author != tt.wantAuthor {
				t.Fatalf("got %+v", got)
			}
		})
	}
}

func TestSearchText_NoRetryOnOther4xx(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, `{"error":"bad request"}`)
	}))
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	if _, err := c.SearchText(context.Background(), "q", "", "places.id"); err == nil {
		t.Fatal("expected error")
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 (no retry on 4xx other than 429)", calls)
	}
}
