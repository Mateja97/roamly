package tripadvisor_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"activities-service/internal/tripadvisor"

	"backend/shared/models/activitiessvc"
)

func TestNearbySearch_Decoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/catalog/locations/nearby" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("category") != "RESTAURANT" {
			t.Errorf("category = %q", r.URL.Query().Get("category"))
		}
		if r.URL.Query().Get("locale") != "en-US" {
			t.Errorf("locale = %q", r.URL.Query().Get("locale"))
		}
		io.WriteString(w, `{
			"data" : [ {
				"location" : {
					"id" : 26453069,
					"geo_id" : 294472,
					"geo" : "Belgrade",
					"names" : [ { "language" : "en", "value" : "Yugo Verse", "primary" : true } ],
					"descriptions" : [ ],
					"addresses" : [ { "city" : "Belgrade", "country_name" : "Serbia", "country_code" : "RS", "language" : "en", "formatted" : "Belgrade Serbia" } ],
					"coordinates" : { "latitude" : 44.8125450, "longitude" : 20.4612300 }
				},
				"bearing" : 25.311538986936455,
				"distance_kilometers" : 0.005541395423669973
			} ]
		}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.NearbySearch(context.Background(), 44.81, 20.46, 15, "RESTAURANT")
	if err != nil {
		t.Fatalf("NearbySearch: %v", err)
	}
	if len(got) != 1 || got[0].LocationID != "26453069" || got[0].Name != "Yugo Verse" {
		t.Fatalf("got %+v", got)
	}
}

func TestNearbySearch_MissingOverallRatingDoesNotError(t *testing.T) {
	// overall_rating may be entirely absent for a location with no ratings
	// yet — NearbySearch must tolerate that (LocationSummary doesn't carry
	// rating anyway, but the parser must not choke on the missing key).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"data":[{"location":{"id":1,"names":[{"language":"en","value":"No Ratings Yet","primary":true}]}}]}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.NearbySearch(context.Background(), 0, 0, 1, "RESTAURANT")
	if err != nil {
		t.Fatalf("NearbySearch: %v", err)
	}
	if len(got) != 1 || got[0].LocationID != "1" || got[0].Name != "No Ratings Yet" {
		t.Fatalf("got %+v", got)
	}
}

func TestLocationDetails_Decoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/locations/13834051" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("locale") != "en-US" {
			t.Errorf("locale = %q", r.URL.Query().Get("locale"))
		}
		io.WriteString(w, `{
			"id" : 13834051,
			"geo_id" : 187791,
			"geo" : "Rome",
			"names" : [ { "language" : "en", "value" : "Alfredo's Transfers & Tours", "primary" : true } ],
			"status" : { "value" : "OPEN" },
			"descriptions" : [ { "language" : "en", "value" : "Alfredo's transfers & tours provides..." } ],
			"photos" : { "total_count" : 53 },
			"addresses" : [ { "city" : "Rome", "country_name" : "Italy", "country_code" : "IT", "postal_code" : "00195", "language" : "en", "formatted" : "Rome 00195 Italy" } ],
			"coordinates" : { "latitude" : 41.9028050, "longitude" : 12.4964100 },
			"phone_numbers" : [ { "value" : "+39 339 314 2147", "type" : "phone" } ],
			"urls" : {
				"tripadvisor" : { "main" : "https://www.tripadvisor.com/Attraction_Review-g187791-d13834051-Reviews-Alfredo_s_Transfers_&_Tours-Rome_Lazio.html?m=70260", "photos" : "...", "write_review" : "...", "questions_answers" : "..." },
				"official" : "http://romashuttle.com"
			},
			"traveler_ratings" : {
				"overall" : { "rating" : 5.0, "count" : 96, "icon_url" : "https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/5.0-70260-4.png" },
				"breakdowns" : [ { "count" : 96, "rating" : 5, "rating_name" : "Excellent" } ],
				"language_counts" : [ { "count" : 66, "language" : "en" } ],
				"subratings" : [ ]
			},
			"official_email" : "info@romashuttle.com",
			"recommended_visit_length" : 3
		}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationDetails(context.Background(), "13834051")
	if err != nil {
		t.Fatalf("LocationDetails: %v", err)
	}
	want := tripadvisor.LocationDetails{
		LocationID:     "13834051",
		Name:           "Alfredo's Transfers & Tours",
		Lat:            41.9028050,
		Lng:            12.4964100,
		Address:        "Rome 00195 Italy",
		City:           "Rome",
		Country:        "Italy",
		Phone:          "+39 339 314 2147",
		Rating:         5.0,
		ReviewCount:    96,
		RatingImageURL: "https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/5.0-70260-4.png",
		WebURL:         "https://www.tripadvisor.com/Attraction_Review-g187791-d13834051-Reviews-Alfredo_s_Transfers_&_Tours-Rome_Lazio.html?m=70260",
		// Subratings zero-value: the fixture's own "subratings" is an empty
		// array (real locations without traveler subratings yet).
	}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestLocationDetails_SubratingsDecoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{
			"id" : 26453069,
			"names" : [ { "language" : "en", "value" : "Yugo Verse", "primary" : true } ],
			"traveler_ratings" : {
				"overall" : { "rating" : 4.5, "count" : 320 },
				"subratings" : [
					{ "name" : "Food", "rating_value" : 4.5 },
					{ "name" : "Service", "rating_value" : 4.0 },
					{ "name" : "Value", "rating_value" : 4.0 },
					{ "name" : "Atmosphere", "rating_value" : 4.5 },
					{ "name" : "Cleanliness", "rating_value" : 5.0 }
				]
			}
		}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationDetails(context.Background(), "26453069")
	if err != nil {
		t.Fatalf("LocationDetails: %v", err)
	}
	// "Cleanliness" isn't one of the 4 categories the detail page's grid
	// shows (frame 5b) — it's dropped rather than mapped anywhere.
	want := tripadvisor.Subratings{Food: 4.5, Service: 4.0, Value: 4.0, Atmosphere: 4.5}
	if got.Subratings != want {
		t.Fatalf("Subratings = %+v, want %+v", got.Subratings, want)
	}
}

func TestLocationDetails_MissingPhoneAndSubratingsParseAsZero(t *testing.T) {
	// phone_numbers and subratings are both optional per the Terra API — a
	// location without either must decode cleanly, not error the sync.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"id":222,"names":[{"language":"en","value":"New Place","primary":true}],"traveler_ratings":{}}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationDetails(context.Background(), "222")
	if err != nil {
		t.Fatalf("LocationDetails: %v", err)
	}
	if got.Phone != "" || got.Subratings != (tripadvisor.Subratings{}) {
		t.Fatalf("got %+v, want zero-value Phone/Subratings for a location that returns neither", got)
	}
}

func TestLocationDetails_MissingRatingsAndAddressParseAsZero(t *testing.T) {
	// A brand-new location can lack traveler_ratings.overall entirely and
	// have an empty addresses array — both must parse as zero values, not
	// error the whole call.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"id":222,"names":[{"language":"en","value":"New Place","primary":true}],"addresses":[],"traveler_ratings":{}}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationDetails(context.Background(), "222")
	if err != nil {
		t.Fatalf("LocationDetails: %v", err)
	}
	if got.Rating != 0 || got.ReviewCount != 0 || got.Lat != 0 || got.Lng != 0 || got.City != "" || got.Country != "" || got.Address != "" {
		t.Fatalf("got %+v, want all-zero optional fields for a bare response", got)
	}
	if got.LocationID != "222" || got.Name != "New Place" {
		t.Fatalf("got %+v, want LocationID=222 Name=New Place", got)
	}
}

func TestLocationPhotos_Decoding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/locations/13834051/photos" {
			t.Errorf("path = %q", r.URL.Path)
		}
		io.WriteString(w, `{"data":[
			{"id":458242600,"location_id":13834051,"photo":{"key":"a.jpg","original_size_url":"https://dynamic-media.tacdn.com/media/1.jpg","original_height":1200,"original_width":1600,"media_type":"photo"},"publish_ts":"2020-05-09T10:55:33.259Z","source":{"name":"Traveler"},"user":{"username":"*********","geo_id":33028,"geo":"San Marcos"}},
			{"id":458242601,"location_id":13834051,"photo":{"key":"b.jpg","original_size_url":"","media_type":"photo"},"user":{"username":"noimage"}},
			{"id":458242602,"location_id":13834051,"photo":{"key":"c.jpg","original_size_url":"https://dynamic-media.tacdn.com/media/2.jpg","media_type":"photo"},"user":{"username":"bob"}}
		],"pagination":{"page":1,"size":2,"total_pages":3,"total_elements":5}}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationPhotos(context.Background(), "13834051", 2)
	if err != nil {
		t.Fatalf("LocationPhotos: %v", err)
	}
	want := []activitiessvc.Photo{
		{URL: "https://dynamic-media.tacdn.com/media/1.jpg", Author: "*********", Provider: activitiessvc.ProviderTripadvisor},
		{URL: "https://dynamic-media.tacdn.com/media/2.jpg", Author: "bob", Provider: activitiessvc.ProviderTripadvisor},
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
		if r.URL.Path != "/locations/13834051/reviews" {
			t.Errorf("path = %q", r.URL.Path)
		}
		io.WriteString(w, `{"data":[{
			"id":1056258071,
			"publish_ts":"2026-04-12T01:13:01.907Z",
			"rating":5,
			"trip_type":"FAMILY",
			"travel_date":"2026-04",
			"url":"https://www.tripadvisor.com/ShowUserReviews-g187791-d13834051-r1056258071-Alfredo_s_Transfers_Tours-Rome_Lazio.html",
			"user":{"username":"allymN6850AM","geo_id":187514,"geo":"Madrid"},
			"photos":[],
			"title":[{"language":"en","value":"Outstanding service - prompt and professional","primary":true}],
			"text":[{"language":"en","value":"Outstanding service - prompt and professional. Reasonable rates...","primary":true}],
			"subratings":[]
		}],"pagination":{"page":1,"size":2,"total_pages":2,"total_elements":3}}`)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("k", srv.URL)
	got, err := c.LocationReviews(context.Background(), "13834051")
	if err != nil {
		t.Fatalf("LocationReviews: %v", err)
	}
	want := []tripadvisor.Review{{Rating: 5, Date: "2026-04-12T01:13:01.907Z", Text: "Outstanding service - prompt and professional. Reasonable rates..."}}
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
	if _, err := c.NearbySearch(context.Background(), 0, 0, 1, "RESTAURANT"); err != nil {
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
		if r.Header.Get("X-API-Key") != "bad-key" {
			t.Errorf("X-API-Key header = %q, want %q", r.Header.Get("X-API-Key"), "bad-key")
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := tripadvisor.NewWithBase("bad-key", srv.URL)
	if _, err := c.NearbySearch(context.Background(), 0, 0, 1, "RESTAURANT"); err == nil {
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
