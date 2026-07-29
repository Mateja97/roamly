package tripadvisor_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"activities-service/internal/tripadvisor"

	"backend/shared/models/activitiessvc"
)

func TestNearbySearch_Decoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/location/nearby_search" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("category") != "restaurants" {
			t.Errorf("category = %q", r.URL.Query().Get("category"))
		}
		if r.URL.Query().Get("key") != "k" {
			t.Errorf("missing api key")
		}
		io.WriteString(w, `{"data":[{"location_id":"111","name":"Ambar Beograd"}]}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.NearbySearch(context.Background(), 44.81, 20.46, 15, "restaurants")
	if err != nil {
		t.Fatalf("NearbySearch: %v", err)
	}
	if len(got) != 1 || got[0].LocationID != "111" || got[0].Name != "Ambar Beograd" {
		t.Fatalf("got %+v", got)
	}
}

func TestLocationDetails_Decoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/location/111/details" {
			t.Errorf("path = %q", r.URL.Path)
		}
		io.WriteString(w, `{
			"location_id":"111","name":"Ambar Beograd",
			"latitude":"44.8062","longitude":"20.4226",
			"address_obj":{"address_string":"Bulevar Milutina Milankovica 1i, Beograd"},
			"rating":"4.5","num_reviews":"1204",
			"rating_image_url":"https://www.tripadvisor.com/img/cdsi/ratings/4.5.svg",
			"web_url":"https://www.tripadvisor.com/Restaurant_Review-x",
			"ranking_data":{"ranking_string":"#12 of 1,780 Restaurants in Belgrade"},
			"category":{"name":"restaurant"},
			"subcategory":[{"name":"wine_bar"}],
			"photo":{"images":{"large":{"url":"https://media.tripadvisor.com/x.jpg"}}}
		}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationDetails(context.Background(), "111")
	if err != nil {
		t.Fatalf("LocationDetails: %v", err)
	}
	want := tripadvisor.LocationDetails{
		LocationID: "111", Name: "Ambar Beograd",
		Lat: 44.8062, Lng: 20.4226,
		Address:        "Bulevar Milutina Milankovica 1i, Beograd",
		Rating:         4.5,
		ReviewCount:    1204,
		RankingString:  "#12 of 1,780 Restaurants in Belgrade",
		RatingImageURL: "https://www.tripadvisor.com/img/cdsi/ratings/4.5.svg",
		WebURL:         "https://www.tripadvisor.com/Restaurant_Review-x",
		Category:       "restaurant",
		Subcategories:  []string{"wine_bar"},
		PhotoURL:       "https://media.tripadvisor.com/x.jpg",
	}
	if got.LocationID != want.LocationID || got.Name != want.Name || got.Lat != want.Lat || got.Lng != want.Lng ||
		got.Address != want.Address || got.Rating != want.Rating || got.ReviewCount != want.ReviewCount ||
		got.RankingString != want.RankingString || got.RatingImageURL != want.RatingImageURL ||
		got.WebURL != want.WebURL || got.Category != want.Category || got.PhotoURL != want.PhotoURL ||
		!slices.Equal(got.Subcategories, want.Subcategories) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestLocationDetails_MissingNumericFieldsParseAsZero(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"location_id":"222","name":"New Place"}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationDetails(context.Background(), "222")
	if err != nil {
		t.Fatalf("LocationDetails: %v", err)
	}
	if got.Rating != 0 || got.ReviewCount != 0 || got.Lat != 0 || got.Lng != 0 {
		t.Fatalf("got %+v, want all-zero numeric fields for a bare response", got)
	}
}

func TestLocationPhotos_Decoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/location/111/photos" {
			t.Errorf("path = %q", r.URL.Path)
		}
		io.WriteString(w, `{"data":[
			{"images":{"large":{"url":"https://media.tripadvisor.com/1.jpg"}},"user":{"username":"jane"}},
			{"images":{"large":{"url":""}},"user":{"username":"noimage"}},
			{"images":{"large":{"url":"https://media.tripadvisor.com/2.jpg"}},"user":{"username":"bob"}}
		]}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationPhotos(context.Background(), "111", 2)
	if err != nil {
		t.Fatalf("LocationPhotos: %v", err)
	}
	want := []activitiessvc.Photo{
		{URL: "https://media.tripadvisor.com/1.jpg", Author: "jane", Provider: activitiessvc.ProviderTripadvisor},
		{URL: "https://media.tripadvisor.com/2.jpg", Author: "bob", Provider: activitiessvc.ProviderTripadvisor},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d photos, want %d (limit=2, blank-URL entry skipped): %+v", len(got), len(want), got)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("photo[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestLocationReviews_Decoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/location/111/reviews" {
			t.Errorf("path = %q", r.URL.Path)
		}
		io.WriteString(w, `{"data":[{"rating":5,"published_date":"2026-06-14","text":"Great rakia."}]}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationReviews(context.Background(), "111")
	if err != nil {
		t.Fatalf("LocationReviews: %v", err)
	}
	want := []tripadvisor.Review{{Rating: 5, Date: "2026-06-14", Text: "Great rakia."}}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestDoJSON_RetriesOn503ThenSucceeds(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		io.WriteString(w, `{"data":[]}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	if _, err := c.NearbySearch(context.Background(), 0, 0, 1, "restaurants"); err != nil {
		t.Fatalf("NearbySearch: %v", err)
	}
	if attempts < 2 {
		t.Fatalf("attempts = %d, want a retry after the first 503", attempts)
	}
}

func TestDoJSON_NonTransientErrorDoesNotRetry(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("bad-key", srv.URL)
	if _, err := c.NearbySearch(context.Background(), 0, 0, 1, "restaurants"); err == nil {
		t.Fatal("NearbySearch() error = nil, want error for 401")
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want exactly 1 (401 is non-transient)", attempts)
	}
}

func TestNewFromEnv(t *testing.T) {
	t.Setenv("TRIPADVISOR_API_KEY", "")
	if _, err := tripadvisor.NewFromEnv(); err == nil {
		t.Fatal("NewFromEnv() error = nil, want error when TRIPADVISOR_API_KEY unset")
	}

	t.Setenv("TRIPADVISOR_API_KEY", "k")
	c, err := tripadvisor.NewFromEnv()
	if err != nil || c == nil {
		t.Fatalf("NewFromEnv() = %v, %v, want a client and no error", c, err)
	}
}
