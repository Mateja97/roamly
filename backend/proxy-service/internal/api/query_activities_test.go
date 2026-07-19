package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"
)

type fakeActivitiesClient struct {
	resp *activitiesv1.QueryActivitiesResponse
	err  error
	got  *activitiesv1.QueryActivitiesRequest
}

func (f *fakeActivitiesClient) QueryActivities(_ context.Context, req *activitiesv1.QueryActivitiesRequest) (*activitiesv1.QueryActivitiesResponse, error) {
	f.got = req
	return f.resp, f.err
}

func doRequest(t *testing.T, h *QueryActivitiesHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/activities/query", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.Handle(rec, req)
	return rec
}

func TestQueryActivitiesHandler_HappyPath(t *testing.T) {
	fake := &fakeActivitiesClient{resp: &activitiesv1.QueryActivitiesResponse{
		Activities: []*activitiesv1.Activity{{
			Id: "1", Title: "Kayaking", Category: activitiesv1.Category_CATEGORY_SPORT,
			Location: &activitiesv1.Location{Lat: 44.8, Lng: 20.4}, Country: "Serbia",
			Rating: 4.8,
			Photos: []*activitiesv1.Photo{
				{Url: "img1", Author: "Jane Doe", AuthorLink: "https://example.com/jane", ThumbUrl: "img1_t", Caption: "Sunset view"},
				{Url: "img2"}, // unresolved: no author, attribution must be omitted
			},
			Tags: []string{"sports"}, DistanceKm: 3.2,
			Details: `{"difficulty":3,"what_to_bring":["water"]}`,
			City:    "Belgrade", Address: "Ada Ciganlija bb",
			Status:      activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED,
			Subcategory: "extreme_sports",
		}},
	}}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"nearby","current_location":{"lat":44.8,"lng":20.4},"subcategories":["extreme_sports"]}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var got queryActivitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Activities) != 1 || got.Activities[0].Category != "sport" {
		t.Errorf("unexpected response: %+v", got)
	}
	photos := got.Activities[0].ImageRefs
	if len(photos) != 2 || photos[0].URI != "img1" || photos[0].Attribution == nil || photos[0].Attribution.Author != "Jane Doe" {
		t.Errorf("unexpected resolved photo: %+v", photos)
	}
	if photos[0].ThumbURL != "img1_t" || photos[0].Caption != "Sunset view" {
		t.Errorf("thumb_url/caption must round-trip through the public query endpoint (T4): %+v", photos[0])
	}
	if photos[1].URI != "img2" || photos[1].Attribution != nil {
		t.Errorf("unresolved photo must omit attribution: %+v", photos[1])
	}
	wantDetails := `{"difficulty":3,"what_to_bring":["water"]}`
	if string(got.Activities[0].Details) != wantDetails {
		t.Errorf("details = %s, want %s (decoded object, not a re-encoded string)", got.Activities[0].Details, wantDetails)
	}
	if got.Activities[0].City != "Belgrade" || got.Activities[0].Address != "Ada Ciganlija bb" || got.Activities[0].Status != "published" {
		t.Errorf("unexpected city/address/status: %+v", got.Activities[0])
	}
	if got.Activities[0].Subcategory != "extreme_sports" {
		t.Errorf("subcategory = %q, want extreme_sports", got.Activities[0].Subcategory)
	}
	if fake.got.GetScope() != activitiesv1.Scope_SCOPE_NEARBY {
		t.Errorf("gRPC request scope = %v, want SCOPE_NEARBY", fake.got.GetScope())
	}
	if gotSubs := fake.got.GetSubcategories(); len(gotSubs) != 1 || gotSubs[0] != "extreme_sports" {
		t.Errorf("gRPC request subcategories = %v, want [extreme_sports]", gotSubs)
	}
}

func TestQueryActivitiesHandler_ForwardsAnywhereDistanceFilter(t *testing.T) {
	fake := &fakeActivitiesClient{resp: &activitiesv1.QueryActivitiesResponse{}}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"anywhere","current_location":{"lat":44.8,"lng":20.4},"max_distance_km":300}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if fake.got.GetScope() != activitiesv1.Scope_SCOPE_ANYWHERE {
		t.Errorf("gRPC request scope = %v, want SCOPE_ANYWHERE", fake.got.GetScope())
	}
	if fake.got.GetMaxDistanceKm() != 300 {
		t.Errorf("gRPC request max_distance_km = %v, want 300", fake.got.GetMaxDistanceKm())
	}
}

func TestQueryActivitiesHandler_ForwardsAnywhereCities(t *testing.T) {
	fake := &fakeActivitiesClient{resp: &activitiesv1.QueryActivitiesResponse{}}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"anywhere","cities":[{"lat":41.9,"lng":12.5},{"lat":48.85,"lng":2.35}],"max_distance_km":50}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	gotCities := fake.got.GetCities()
	if len(gotCities) != 2 || gotCities[0].GetLat() != 41.9 || gotCities[1].GetLng() != 2.35 {
		t.Errorf("gRPC request cities = %v, want [{41.9,12.5},{48.85,2.35}]", gotCities)
	}
}

func TestQueryActivitiesHandler_AnywhereWithoutLocationOrDistanceFilter(t *testing.T) {
	fake := &fakeActivitiesClient{resp: &activitiesv1.QueryActivitiesResponse{}}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"anywhere"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if fake.got.GetCurrentLocation() != nil {
		t.Errorf("gRPC request current_location = %v, want nil", fake.got.GetCurrentLocation())
	}
}

func TestQueryActivitiesHandler_EmptyResultIsNotAnError(t *testing.T) {
	fake := &fakeActivitiesClient{resp: &activitiesv1.QueryActivitiesResponse{}}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"nearby","current_location":{"lat":44.8,"lng":20.4}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var got queryActivitiesResponseDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.Activities == nil || len(got.Activities) != 0 {
		t.Errorf("activities = %v, want empty (non-nil) slice", got.Activities)
	}
}

func TestQueryActivitiesHandler_ValidationFailures(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"unknown scope", `{"scope":"galaxy"}`},
		{"retired home scope", `{"scope":"home","current_location":{"lat":1,"lng":1}}`},
		{"unknown category", `{"scope":"nearby","current_location":{"lat":1,"lng":1},"categories":["not_a_category"]}`},
		{"malformed JSON body", `{not-json`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeActivitiesClient{}
			h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

			rec := doRequest(t, h, tt.body)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

// TestQueryActivitiesHandler_StrayRemovedFieldIsIgnored: a stale app build
// that still sends a filter field the backend has since dropped must not
// hard-fail the request — the unknown JSON key is silently ignored.
func TestQueryActivitiesHandler_StrayRemovedFieldIsIgnored(t *testing.T) {
	fake := &fakeActivitiesClient{resp: &activitiesv1.QueryActivitiesResponse{}}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"nearby","current_location":{"lat":1,"lng":1},"price_tier":"budget"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestCategoryTranslation(t *testing.T) {
	tests := []struct {
		name   string
		wire   string
		proto  activitiesv1.Category
		domain activitiessvc.Category
	}{
		{"restaurants", "restaurants", activitiesv1.Category_CATEGORY_RESTAURANTS, activitiessvc.CategoryRestaurants},
		{"cafes", "cafes", activitiesv1.Category_CATEGORY_CAFES, activitiessvc.CategoryCafes},
		{"bars", "bars", activitiesv1.Category_CATEGORY_BARS, activitiessvc.CategoryBars},
		{"nightlife", "nightlife", activitiesv1.Category_CATEGORY_NIGHTLIFE, activitiessvc.CategoryNightlife},
		{"nature", "nature", activitiesv1.Category_CATEGORY_NATURE, activitiessvc.CategoryNature},
		{"sport", "sport", activitiesv1.Category_CATEGORY_SPORT, activitiessvc.CategorySport},
		{"kids", "kids", activitiesv1.Category_CATEGORY_KIDS, activitiessvc.CategoryKids},
		{"culture", "culture", activitiesv1.Category_CATEGORY_CULTURE, activitiessvc.CategoryCulture},
		{"art", "art", activitiesv1.Category_CATEGORY_ART, activitiessvc.CategoryArt},
		{"wellness", "wellness", activitiesv1.Category_CATEGORY_WELLNESS, activitiessvc.CategoryWellness},
		{"shopping", "shopping", activitiesv1.Category_CATEGORY_SHOPPING, activitiessvc.CategoryShopping},
		{"entertainment", "entertainment", activitiesv1.Category_CATEGORY_ENTERTAINMENT, activitiessvc.CategoryEntertainment},
		{"tours_experiences", "tours_experiences", activitiesv1.Category_CATEGORY_TOURS_EXPERIENCES, activitiessvc.CategoryToursExperiences},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotProto, ok := toProtoCategory(tt.wire)
			if !ok || gotProto != tt.proto {
				t.Errorf("toProtoCategory(%q) = (%v, %v), want (%v, true)", tt.wire, gotProto, ok, tt.proto)
			}
			gotDomain := toDomainCategory(tt.proto, slog.New(slog.DiscardHandler))
			if gotDomain != tt.domain {
				t.Errorf("toDomainCategory(%v) = %q, want %q", tt.proto, gotDomain, tt.domain)
			}
		})
	}

	oldValues := []string{"food_and_drink", "history_and_culture", "nature_and_outdoors", "art_and_design", "sports", "entertainment_and_wellness"}
	for _, v := range oldValues {
		t.Run("retired value "+v+" rejected", func(t *testing.T) {
			if _, ok := toProtoCategory(v); ok {
				t.Errorf("toProtoCategory(%q) accepted a retired category value", v)
			}
		})
	}

	t.Run("unknown wire value rejected", func(t *testing.T) {
		if _, ok := toProtoCategory("bogus"); ok {
			t.Error("toProtoCategory(bogus) accepted an unknown category value")
		}
	})
	t.Run("unknown proto value maps to empty domain with a warning log", func(t *testing.T) {
		if got := toDomainCategory(activitiesv1.Category(99), slog.New(slog.DiscardHandler)); got != "" {
			t.Errorf("toDomainCategory(99) = %q, want empty", got)
		}
	})
}

func TestStatusTranslation(t *testing.T) {
	tests := []struct {
		name  string
		proto activitiesv1.ActivityStatus
		want  string
	}{
		{"published", activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED, "published"},
		{"draft", activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT, "draft"},
		{"pending", activitiesv1.ActivityStatus_ACTIVITY_STATUS_PENDING, "pending"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := toDomainStatus(tt.proto, slog.New(slog.DiscardHandler)); got != tt.want {
				t.Errorf("toDomainStatus(%v) = %q, want %q", tt.proto, got, tt.want)
			}
		})
	}
	t.Run("unknown proto value maps to empty with a warning log", func(t *testing.T) {
		if got := toDomainStatus(activitiesv1.ActivityStatus(99), slog.New(slog.DiscardHandler)); got != "" {
			t.Errorf("toDomainStatus(99) = %q, want empty", got)
		}
	})
}

func TestQueryActivitiesHandler_GRPCInvalidArgumentMapsTo400(t *testing.T) {
	fake := &fakeActivitiesClient{err: status.Error(codes.InvalidArgument, "missing current_location for scope nearby")}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"nearby"}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestDetailsJSON(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"valid object passes through unchanged", `{"cuisine":"Italian"}`, `{"cuisine":"Italian"}`},
		{"empty string falls back to empty object", "", "{}"},
		{"malformed JSON falls back to empty object", `{not-json`, "{}"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := string(detailsJSON(tt.in)); got != tt.want {
				t.Errorf("detailsJSON(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNonNilTags(t *testing.T) {
	if got := nonNilTags(nil); got == nil || len(got) != 0 {
		t.Errorf("nonNilTags(nil) = %#v, want non-nil empty slice", got)
	}
	if got := nonNilTags([]string{"a"}); len(got) != 1 || got[0] != "a" {
		t.Errorf("nonNilTags([a]) = %#v, want [a]", got)
	}
}

func TestQueryActivitiesHandler_GRPCInternalMapsTo500(t *testing.T) {
	fake := &fakeActivitiesClient{err: status.Error(codes.Internal, "internal error")}
	h := NewQueryActivitiesHandler(fake, slog.New(slog.DiscardHandler))

	rec := doRequest(t, h, `{"scope":"anywhere"}`)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}
