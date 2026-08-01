package places_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
		if _, err := io.WriteString(w, `{"places":[{"id":"p1","displayName":{"text":"Koffein"},"rating":4.5}],"nextPageToken":"tok2"}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
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
		if _, err := io.WriteString(w, `{"photoUri":"http://img/final.jpg"}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
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
		if _, err := io.WriteString(w, `{}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
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
			if _, err := io.WriteString(w, `{"error":"rate limited"}`); err != nil {
				t.Errorf("writing response: %v", err)
			}
			return
		}
		if _, err := io.WriteString(w, `{"places":[{"id":"p1"}]}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
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
				if _, err := io.WriteString(w, tt.searchBody); err != nil {
					t.Errorf("writing response: %v", err)
				}
			})
			mux.HandleFunc("/v1/places/X/photos/Y/media", func(w http.ResponseWriter, r *http.Request) {
				if _, err := io.WriteString(w, `{"photoUri":"http://img/final.jpg"}`); err != nil {
					t.Errorf("writing response: %v", err)
				}
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

func TestResolvePhotos(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/places/place-1", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Goog-FieldMask") != "photos" {
			t.Errorf("fieldMask = %q", r.Header.Get("X-Goog-FieldMask"))
		}
		if _, err := io.WriteString(w, `{"photos":[
			{"name":"places/place-1/photos/A","authorAttributions":[{"displayName":"Jane","uri":"http://author/jane"}]},
			{"name":"places/place-1/photos/B"},
			{"name":"places/place-1/photos/C"}
		]}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})
	mux.HandleFunc("/v1/places/place-1/photos/A/media", func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.WriteString(w, `{"photoUri":"http://img/a.jpg"}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})
	mux.HandleFunc("/v1/places/place-1/photos/B/media", func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.WriteString(w, `{"photoUri":"http://img/b.jpg"}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})
	mux.HandleFunc("/v1/places/place-1/photos/C/media", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest) // one bad photo, shouldn't sink the rest
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	got, err := c.ResolvePhotos(context.Background(), "place-1", 5)
	if err != nil {
		t.Fatalf("ResolvePhotos(): %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d photos, want 2 (one skipped on media error): %+v", len(got), got)
	}
	if got[0].URL != "http://img/a.jpg" || got[0].Author != "Jane" || got[0].AuthorLink != "http://author/jane" {
		t.Errorf("photo[0] = %+v", got[0])
	}
	if got[1].URL != "http://img/b.jpg" {
		t.Errorf("photo[1] = %+v", got[1])
	}
}

func TestResolvePhotos_RespectsLimit(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/places/place-1", func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.WriteString(w, `{"photos":[{"name":"places/place-1/photos/A"},{"name":"places/place-1/photos/B"}]}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})
	mux.HandleFunc("/v1/places/place-1/photos/A/media", func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.WriteString(w, `{"photoUri":"http://img/a.jpg"}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})
	mux.HandleFunc("/v1/places/place-1/photos/B/media", func(w http.ResponseWriter, r *http.Request) {
		t.Error("media call for photo B should not happen, limit is 1")
		if _, err := io.WriteString(w, `{"photoUri":"http://img/b.jpg"}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	got, err := c.ResolvePhotos(context.Background(), "place-1", 1)
	if err != nil {
		t.Fatalf("ResolvePhotos(): %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d photos, want 1", len(got))
	}
}

// wantDetailFieldMask is places.go's detailFieldMask, duplicated here (an
// external test package can't reference the unexported const) so the
// assertion below is a real behavioral check, not a tautology against the
// implementation.
const wantDetailFieldMask = "rating,userRatingCount,reviews,reviews.authorAttribution," +
	"editorialSummary,generativeSummary,priceLevel,priceRange,regularOpeningHours," +
	"primaryTypeDisplayName,websiteUri,googleMapsUri,goodForChildren,goodForGroups," +
	"allowsDogs,restroom,outdoorSeating,liveMusic,parkingOptions,accessibilityOptions," +
	"servesCoffee,servesVegetarianFood,menuForChildren,dineIn,takeout,reservable"

func TestPlaceDetails(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		wantErr    bool
		wantRating float64
		wantVenue  string
	}{
		{
			name:   "full response",
			status: http.StatusOK,
			body: `{
				"rating": 4.6,
				"userRatingCount": 214,
				"priceLevel": "PRICE_LEVEL_MODERATE",
				"googleMapsUri": "https://maps.google.com/?cid=1",
				"websiteUri": "https://example.com",
				"primaryTypeDisplayName": {"text": "Museum"},
				"editorialSummary": {"text": "A lovely museum."},
				"reviews": [{
					"rating": 5,
					"text": {"text": "Great place"},
					"publishTime": "2026-01-01T00:00:00Z",
					"authorAttribution": {"displayName": "Jane", "photoUri": "http://img/jane.jpg", "uri": "http://profile/jane"}
				}],
				"goodForChildren": true,
				"servesCoffee": true,
				"parkingOptions": {"freeParkingLot": true},
				"accessibilityOptions": {"wheelchairAccessibleEntrance": true}
			}`,
			wantRating: 4.6,
			wantVenue:  "Museum",
		},
		{
			name:       "partial response, fields absent",
			status:     http.StatusOK,
			body:       `{"rating": 4.1}`,
			wantRating: 4.1,
		},
		{
			name:    "non-200",
			status:  http.StatusNotFound,
			body:    `{"error": "not found"}`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/places/place-1" {
					t.Errorf("path = %q", r.URL.Path)
				}
				if got := r.Header.Get("X-Goog-FieldMask"); got != wantDetailFieldMask {
					t.Errorf("fieldMask = %q, want %q", got, wantDetailFieldMask)
				}
				w.WriteHeader(tt.status)
				if _, err := io.WriteString(w, tt.body); err != nil {
					t.Errorf("writing response: %v", err)
				}
			}))
			defer srv.Close()

			c := places.NewWithBase("k", srv.URL)
			got, err := c.PlaceDetails(context.Background(), "place-1")
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("PlaceDetails(): %v", err)
			}
			if got.Rating != tt.wantRating {
				t.Errorf("Rating = %v, want %v", got.Rating, tt.wantRating)
			}
			if got.PrimaryTypeDisplayName.Text != tt.wantVenue {
				t.Errorf("PrimaryTypeDisplayName.Text = %q, want %q", got.PrimaryTypeDisplayName.Text, tt.wantVenue)
			}
		})
	}
}

func TestPlaceDetails_FullResponseDecodesEverything(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.WriteString(w, `{
			"rating": 4.6,
			"userRatingCount": 214,
			"reviews": [{
				"rating": 5,
				"text": {"text": "Great place"},
				"publishTime": "2026-01-01T00:00:00Z",
				"authorAttribution": {"displayName": "Jane", "photoUri": "http://img/jane.jpg", "uri": "http://profile/jane"}
			}],
			"editorialSummary": {"text": "A lovely museum."},
			"generativeSummary": {"overview": {"text": "AI-written overview."}},
			"priceRange": {"startPrice": {"currencyCode": "EUR", "units": "10"}, "endPrice": {"currencyCode": "EUR", "units": "20"}},
			"websiteUri": "https://example.com",
			"googleMapsUri": "https://maps.google.com/?cid=1",
			"goodForChildren": true,
			"allowsDogs": true,
			"parkingOptions": {"freeParkingLot": true},
			"accessibilityOptions": {"wheelchairAccessibleEntrance": true}
		}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	}))
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	got, err := c.PlaceDetails(context.Background(), "place-1")
	if err != nil {
		t.Fatalf("PlaceDetails(): %v", err)
	}
	if len(got.Reviews) != 1 || got.Reviews[0].AuthorAttribution.DisplayName != "Jane" || got.Reviews[0].Text.Text != "Great place" {
		t.Errorf("Reviews = %+v", got.Reviews)
	}
	if got.EditorialSummary.Text != "A lovely museum." {
		t.Errorf("EditorialSummary.Text = %q", got.EditorialSummary.Text)
	}
	if got.GenerativeSummary.Overview.Text != "AI-written overview." {
		t.Errorf("GenerativeSummary.Overview.Text = %q", got.GenerativeSummary.Overview.Text)
	}
	if got.PriceRange.StartPrice.Units != "10" || got.PriceRange.EndPrice.Units != "20" {
		t.Errorf("PriceRange = %+v", got.PriceRange)
	}
	if !got.GoodForChildren || !got.AllowsDogs {
		t.Errorf("amenity booleans not decoded: %+v", got)
	}
	if !got.ParkingOptions["freeParkingLot"] {
		t.Errorf("ParkingOptions = %+v", got.ParkingOptions)
	}
	if !got.AccessibilityOptions["wheelchairAccessibleEntrance"] {
		t.Errorf("AccessibilityOptions = %+v", got.AccessibilityOptions)
	}
}

func TestPlaceDetails_Timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(200 * time.Millisecond):
			if _, err := io.WriteString(w, `{"rating": 4.5}`); err != nil {
				t.Errorf("writing response: %v", err)
			}
		}
	}))
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	if _, err := c.PlaceDetails(ctx, "place-1"); err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestSearchText_NoRetryOnOther4xx(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusBadRequest)
		if _, err := io.WriteString(w, `{"error":"bad request"}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
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

func TestClient_SearchNearby(t *testing.T) {
	var gotBody map[string]any
	var gotMask, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMask = r.Header.Get("X-Goog-FieldMask")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decoding request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		if _, err := io.WriteString(w, `{"places":[{"id":"abc","displayName":{"text":"Ada Beach"},"primaryType":"beach"}]}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	}))
	defer srv.Close()

	c := places.NewWithBase("test-key", srv.URL)
	got, err := c.SearchNearby(context.Background(), places.NearbyRequest{
		Lat: 44.81, Lng: 20.46, RadiusM: 10000,
		IncludedTypes: []string{"beach"}, MaxResults: 20,
	}, places.NearbyFieldMask)
	if err != nil {
		t.Fatalf("SearchNearby() error: %v", err)
	}

	if gotPath != "/v1/places:searchNearby" {
		t.Errorf("path = %q, want /v1/places:searchNearby", gotPath)
	}
	if gotMask != places.NearbyFieldMask {
		t.Errorf("field mask = %q, want %q", gotMask, places.NearbyFieldMask)
	}
	if len(got) != 1 || got[0].ID != "abc" || got[0].PrimaryType != "beach" {
		t.Fatalf("places = %+v, want one place id=abc primaryType=beach", got)
	}

	// The circle locationRestriction is the whole reason this uses
	// searchNearby rather than searchText: it is a hard geographic bound,
	// where searchText's circle is only a bias.
	restriction, ok := gotBody["locationRestriction"].(map[string]any)
	if !ok {
		t.Fatalf("locationRestriction missing from body %+v", gotBody)
	}
	circle, ok := restriction["circle"].(map[string]any)
	if !ok {
		t.Fatalf("circle missing from locationRestriction %+v", restriction)
	}
	if circle["radius"] != float64(10000) {
		t.Errorf("radius = %v, want 10000", circle["radius"])
	}
	center, ok := circle["center"].(map[string]any)
	if !ok || center["latitude"] != 44.81 || center["longitude"] != 20.46 {
		t.Errorf("center = %+v, want lat 44.81 lng 20.46", center)
	}
	if gotBody["maxResultCount"] != float64(20) {
		t.Errorf("maxResultCount = %v, want 20", gotBody["maxResultCount"])
	}
	types, ok := gotBody["includedTypes"].([]any)
	if !ok || len(types) != 1 || types[0] != "beach" {
		t.Errorf("includedTypes = %+v, want [beach]", gotBody["includedTypes"])
	}
}

func TestClient_ReverseGeocodeCity(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		if _, err := io.WriteString(w, `{"status":"OK","results":[{"address_components":[
			{"long_name":"Belgrade","types":["locality","political"]},
			{"long_name":"Serbia","types":["country","political"]}]}]}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	}))
	defer srv.Close()

	c := places.NewWithBase("test-key", srv.URL)
	city, country, err := c.ReverseGeocodeCity(context.Background(), 44.8125, 20.4612)
	if err != nil {
		t.Fatalf("ReverseGeocodeCity() error: %v", err)
	}
	if city != "Belgrade" || country != "Serbia" {
		t.Errorf("city/country = %q/%q, want Belgrade/Serbia", city, country)
	}
	// language=en is the whole point: Places' own locality component returns
	// "Beograd" regardless of languageCode (verified live), which is what
	// fragmented the catalog into eight spellings of one city.
	if !strings.Contains(gotQuery, "language=en") {
		t.Errorf("query = %q, want language=en", gotQuery)
	}
	if !strings.Contains(gotQuery, "result_type=locality") {
		t.Errorf("query = %q, want result_type=locality", gotQuery)
	}
}

func TestClient_ReverseGeocodeCity_ZeroResults(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if _, err := io.WriteString(w, `{"status":"ZERO_RESULTS","results":[]}`); err != nil {
			t.Errorf("writing response: %v", err)
		}
	}))
	defer srv.Close()

	c := places.NewWithBase("test-key", srv.URL)
	city, country, err := c.ReverseGeocodeCity(context.Background(), 0, 0)
	if err != nil {
		t.Fatalf("ReverseGeocodeCity() error: %v — mid-ocean is not an error, it is an empty answer", err)
	}
	if city != "" || country != "" {
		t.Errorf("city/country = %q/%q, want empty for ZERO_RESULTS", city, country)
	}
}
