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
}

func (f *fakeQueryService) Query(_ context.Context, req service.Request) ([]activitiessvc.Activity, error) {
	f.got = req
	return f.out, f.err
}

func dialServer(t *testing.T, svc queryService) activitiesv1.ActivitiesServiceClient {
	t.Helper()
	lis := bufconn.Listen(1024 * 1024)
	srv := NewGRPCServer(svc, slog.New(slog.DiscardHandler))
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
			ID: "1", Title: "Kayaking", Category: activitiessvc.CategorySports,
			Location: activitiessvc.Point{Lat: 44.8, Lng: 20.4}, Country: "Serbia",
			Rating: 4.8,
			Photos: []activitiessvc.Photo{{URL: "img1", Author: "Jane Doe", AuthorLink: "https://example.com"}},
			Tags:   []string{"sports"}, DistanceKM: 3.2,
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
	if got.GetId() != "1" || got.GetCategory() != activitiesv1.Category_CATEGORY_SPORTS {
		t.Errorf("unexpected activity translation: %+v", got)
	}
	if len(got.GetPhotos()) != 1 || got.GetPhotos()[0].GetUrl() != "img1" || got.GetPhotos()[0].GetAuthor() != "Jane Doe" {
		t.Errorf("unexpected photo translation: %+v", got.GetPhotos())
	}
	if fake.got.Scope != activitiessvc.ScopeNearby {
		t.Errorf("service received scope = %v, want nearby", fake.got.Scope)
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
