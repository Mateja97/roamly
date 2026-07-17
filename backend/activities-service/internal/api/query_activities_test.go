package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
	activitiesv1 "backend/shared/proto/activities/v1"

	"activities-service/internal/service"
)

type fakeQueryService struct {
	out []activitiessvc.Activity
	err error
	got service.Request

	citySuggestOut  []activitiessvc.CitySuggestion
	citySuggestErr  error
	gotCitySuggestQ string

	adminCitiesOut []string
	adminCitiesErr error

	listOut       activitiessvc.ListResult
	listPage      int
	listPageSize  int
	listErr       error
	gotListReq    service.ListRequest
	getOut        activitiessvc.Activity
	getErr        error
	gotGetID      string
	createOut     activitiessvc.Activity
	createErr     error
	gotCreate     activitiessvc.NewActivity
	updateOut     activitiessvc.Activity
	updateErr     error
	gotUpdateID   string
	gotUpdatePtch activitiessvc.UpdatePatch

	saveURL, saveThumbURL string
	saveErr               error
	gotSaveActivityID     string
	gotSaveData           []byte

	unlinkErr   error
	gotUnlinked []string
}

func (f *fakeQueryService) Query(_ context.Context, req service.Request) ([]activitiessvc.Activity, error) {
	f.got = req
	return f.out, f.err
}

func (f *fakeQueryService) SuggestCities(_ context.Context, query string) ([]activitiessvc.CitySuggestion, error) {
	f.gotCitySuggestQ = query
	return f.citySuggestOut, f.citySuggestErr
}

func (f *fakeQueryService) AdminListCities(_ context.Context) ([]string, error) {
	return f.adminCitiesOut, f.adminCitiesErr
}

func (f *fakeQueryService) List(_ context.Context, req service.ListRequest) (activitiessvc.ListResult, int, int, error) {
	f.gotListReq = req
	return f.listOut, f.listPage, f.listPageSize, f.listErr
}

func (f *fakeQueryService) GetByID(_ context.Context, id string) (activitiessvc.Activity, error) {
	f.gotGetID = id
	return f.getOut, f.getErr
}

func (f *fakeQueryService) Create(_ context.Context, in activitiessvc.NewActivity) (activitiessvc.Activity, error) {
	f.gotCreate = in
	return f.createOut, f.createErr
}

func (f *fakeQueryService) Update(_ context.Context, id string, patch activitiessvc.UpdatePatch) (activitiessvc.Activity, error) {
	f.gotUpdateID = id
	f.gotUpdatePtch = patch
	return f.updateOut, f.updateErr
}

// Save implements photoStore, so a fakeQueryService can serve as both
// dialServer dependencies in every test in this package — only
// upload_photo_test.go actually exercises it.
func (f *fakeQueryService) Save(activityID string, data []byte) (string, string, error) {
	f.gotSaveActivityID = activityID
	f.gotSaveData = data
	return f.saveURL, f.saveThumbURL, f.saveErr
}

// Unlink implements photoStore alongside Save, so a fakeQueryService can
// keep serving as both dialServer dependencies for every test in this
// package — only update_activity_test.go's T2 cases care about calls
// reaching a real store, and those use dialServerWithPhotos instead.
func (f *fakeQueryService) Unlink(url string) error {
	f.gotUnlinked = append(f.gotUnlinked, url)
	return f.unlinkErr
}

func dialServer(t *testing.T, svc queryService) activitiesv1.ActivitiesServiceClient {
	t.Helper()
	photos, _ := svc.(photoStore)
	return dialServerWithPhotos(t, svc, photos)
}

// dialServerWithPhotos is dialServer with an explicit photoStore, for tests
// that need a real filesystem-backed store (T2's on-disk unlink
// assertions) rather than fakeQueryService's call-tracking stub.
func dialServerWithPhotos(t *testing.T, svc queryService, photos photoStore) activitiesv1.ActivitiesServiceClient {
	t.Helper()
	lis := bufconn.Listen(1024 * 1024)
	srv := NewGRPCServer(svc, photos, slog.New(slog.DiscardHandler))
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dialing bufconn: %v", err)
	}
	t.Cleanup(func() {
		if err := conn.Close(); err != nil {
			t.Logf("closing bufconn: %v", err)
		}
	})
	return activitiesv1.NewActivitiesServiceClient(conn)
}

func TestQueryActivities_HappyPath(t *testing.T) {
	fake := &fakeQueryService{out: []activitiessvc.Activity{
		{
			ID: "1", Title: "Kayaking", Category: activitiessvc.CategorySport,
			Location: activitiessvc.Point{Lat: 44.8, Lng: 20.4}, Country: "Serbia",
			Rating: 4.8,
			Photos: []activitiessvc.Photo{{URL: "img1", Author: "Jane Doe", AuthorLink: "https://example.com", ThumbURL: "img1_t", Caption: "Sunset"}},
			Tags:   []string{"sports"}, DistanceKM: 3.2,
			Details: []byte(`{"difficulty":3}`),
			City:    "Belgrade", Address: "Ada Ciganlija bb", Status: activitiessvc.StatusPublished,
		},
	}}
	client := dialServer(t, fake)

	resp, err := client.QueryActivities(context.Background(), &activitiesv1.QueryActivitiesRequest{
		Scope:           activitiesv1.Scope_SCOPE_NEARBY,
		CurrentLocation: &activitiesv1.Location{Lat: 44.8, Lng: 20.4},
	})
	if err != nil {
		t.Fatalf("QueryActivities() unexpected error: %v", err)
	}
	if len(resp.GetActivities()) != 1 {
		t.Fatalf("got %d activities, want 1", len(resp.GetActivities()))
	}
	got := resp.GetActivities()[0]
	if got.GetId() != "1" || got.GetCategory() != activitiesv1.Category_CATEGORY_SPORT {
		t.Errorf("unexpected activity translation: %+v", got)
	}
	if got.GetCity() != "Belgrade" || got.GetAddress() != "Ada Ciganlija bb" || got.GetStatus() != activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED {
		t.Errorf("unexpected city/address/status translation: %+v", got)
	}
	if len(got.GetPhotos()) != 1 || got.GetPhotos()[0].GetUrl() != "img1" || got.GetPhotos()[0].GetAuthor() != "Jane Doe" {
		t.Errorf("unexpected photo translation: %+v", got.GetPhotos())
	}
	if got.GetPhotos()[0].GetThumbUrl() != "img1_t" || got.GetPhotos()[0].GetCaption() != "Sunset" {
		t.Errorf("unexpected thumb_url/caption translation: %+v", got.GetPhotos())
	}
	if got.GetDetails() != `{"difficulty":3}` {
		t.Errorf("details = %q, want passthrough of the domain JSON", got.GetDetails())
	}
	if fake.got.Scope != activitiessvc.ScopeNearby {
		t.Errorf("service received scope = %v, want nearby", fake.got.Scope)
	}
}

func TestDetailsJSON(t *testing.T) {
	tests := []struct {
		name string
		in   []byte
		want string
	}{
		{"nil defaults to empty object", nil, "{}"},
		{"empty slice defaults to empty object", []byte{}, "{}"},
		{"non-empty payload passes through unchanged", []byte(`{"cuisine":"Italian"}`), `{"cuisine":"Italian"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := detailsJSON(tt.in); got != tt.want {
				t.Errorf("detailsJSON(%s) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestQueryActivities_InvalidInputMapsToInvalidArgument(t *testing.T) {
	fake := &fakeQueryService{err: fmt.Errorf("resolving query: %w", sharederrors.ErrInvalidInput)}
	client := dialServer(t, fake)

	_, err := client.QueryActivities(context.Background(), &activitiesv1.QueryActivitiesRequest{
		Scope: activitiesv1.Scope_SCOPE_NEARBY,
	})
	if err == nil {
		t.Fatal("QueryActivities() error = nil, want InvalidArgument")
	}
	if code := status.Code(err); code != codes.InvalidArgument {
		t.Errorf("status code = %v, want InvalidArgument", code)
	}
}

func TestToDomainScope(t *testing.T) {
	tests := []struct {
		name string
		in   activitiesv1.Scope
		want activitiessvc.Scope
	}{
		{"nearby maps through", activitiesv1.Scope_SCOPE_NEARBY, activitiessvc.ScopeNearby},
		{"anywhere maps through", activitiesv1.Scope_SCOPE_ANYWHERE, activitiessvc.ScopeAnywhere},
		{"out-of-range wire value maps to empty (service rejects)", activitiesv1.Scope(99), activitiessvc.Scope("")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := toDomainScope(tt.in)
			if got != tt.want {
				t.Errorf("toDomainScope(%v) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestCategoryTranslation(t *testing.T) {
	tests := []struct {
		name   string
		domain activitiessvc.Category
		proto  activitiesv1.Category
	}{
		{"restaurants", activitiessvc.CategoryRestaurants, activitiesv1.Category_CATEGORY_RESTAURANTS},
		{"cafes", activitiessvc.CategoryCafes, activitiesv1.Category_CATEGORY_CAFES},
		{"bars", activitiessvc.CategoryBars, activitiesv1.Category_CATEGORY_BARS},
		{"nightlife", activitiessvc.CategoryNightlife, activitiesv1.Category_CATEGORY_NIGHTLIFE},
		{"nature", activitiessvc.CategoryNature, activitiesv1.Category_CATEGORY_NATURE},
		{"sport", activitiessvc.CategorySport, activitiesv1.Category_CATEGORY_SPORT},
		{"kids", activitiessvc.CategoryKids, activitiesv1.Category_CATEGORY_KIDS},
		{"culture", activitiessvc.CategoryCulture, activitiesv1.Category_CATEGORY_CULTURE},
		{"art", activitiessvc.CategoryArt, activitiesv1.Category_CATEGORY_ART},
		{"wellness", activitiessvc.CategoryWellness, activitiesv1.Category_CATEGORY_WELLNESS},
		{"shopping", activitiessvc.CategoryShopping, activitiesv1.Category_CATEGORY_SHOPPING},
		{"entertainment", activitiessvc.CategoryEntertainment, activitiesv1.Category_CATEGORY_ENTERTAINMENT},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := toProtoCategory(tt.domain); got != tt.proto {
				t.Errorf("toProtoCategory(%q) = %v, want %v", tt.domain, got, tt.proto)
			}
			if got := toDomainCategory(tt.proto); got != tt.domain {
				t.Errorf("toDomainCategory(%v) = %q, want %q", tt.proto, got, tt.domain)
			}
		})
	}
	t.Run("unknown proto value maps to empty domain", func(t *testing.T) {
		if got := toDomainCategory(activitiesv1.Category(99)); got != "" {
			t.Errorf("toDomainCategory(99) = %q, want empty", got)
		}
	})
	t.Run("unknown domain value maps to CATEGORY_UNSPECIFIED", func(t *testing.T) {
		if got := toProtoCategory(activitiessvc.Category("bogus")); got != activitiesv1.Category_CATEGORY_UNSPECIFIED {
			t.Errorf("toProtoCategory(bogus) = %v, want CATEGORY_UNSPECIFIED", got)
		}
	})
}

func TestStatusTranslation(t *testing.T) {
	tests := []struct {
		name   string
		domain activitiessvc.Status
		proto  activitiesv1.ActivityStatus
	}{
		{"published", activitiessvc.StatusPublished, activitiesv1.ActivityStatus_ACTIVITY_STATUS_PUBLISHED},
		{"draft", activitiessvc.StatusDraft, activitiesv1.ActivityStatus_ACTIVITY_STATUS_DRAFT},
		{"pending", activitiessvc.StatusPending, activitiesv1.ActivityStatus_ACTIVITY_STATUS_PENDING},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := toProtoStatus(tt.domain); got != tt.proto {
				t.Errorf("toProtoStatus(%q) = %v, want %v", tt.domain, got, tt.proto)
			}
		})
	}
	t.Run("unknown domain value maps to ACTIVITY_STATUS_UNSPECIFIED", func(t *testing.T) {
		if got := toProtoStatus(activitiessvc.Status("bogus")); got != activitiesv1.ActivityStatus_ACTIVITY_STATUS_UNSPECIFIED {
			t.Errorf("toProtoStatus(bogus) = %v, want ACTIVITY_STATUS_UNSPECIFIED", got)
		}
	})
}

func TestQueryActivities_UnexpectedErrorMapsToInternal(t *testing.T) {
	fake := &fakeQueryService{err: errors.New("db exploded")}
	client := dialServer(t, fake)

	_, err := client.QueryActivities(context.Background(), &activitiesv1.QueryActivitiesRequest{
		Scope: activitiesv1.Scope_SCOPE_ANYWHERE,
	})
	if err == nil {
		t.Fatal("QueryActivities() error = nil, want Internal")
	}
	if code := status.Code(err); code != codes.Internal {
		t.Errorf("status code = %v, want Internal", code)
	}
}
