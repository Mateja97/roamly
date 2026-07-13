//go:build integration

// Integration coverage for the real Postgres+PostGIS query path (scope
// radius via the GiST index, filter narrowing, closest-first ordering).
// Opt-in: requires a docker daemon. Run with `go test -tags=integration ./...`.
// ponytail: shells out to the docker CLI directly instead of adding
// testcontainers-go — one throwaway container, start/wait/stop is a dozen
// lines; reach for testcontainers if this grows more containers or retry logic.
package repository

import (
	"context"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

func startTestPostgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("docker not available, skipping integration test")
	}

	out, err := exec.Command("docker", "run", "--rm", "-d",
		"-e", "POSTGRES_PASSWORD=test",
		"-p", "127.0.0.1::5432",
		"postgis/postgis:16-3.4-alpine",
	).Output()
	if err != nil {
		t.Skipf("could not start postgres container: %v", err)
	}
	containerID := strings.TrimSpace(string(out))
	t.Cleanup(func() { exec.Command("docker", "rm", "-f", containerID).Run() })

	portOut, err := exec.Command("docker", "port", containerID, "5432/tcp").Output()
	if err != nil {
		t.Fatalf("could not discover mapped port: %v", err)
	}
	hostPort := strings.TrimSpace(strings.Split(strings.TrimSpace(string(portOut)), ":")[1])
	dsn := "postgres://postgres:test@127.0.0.1:" + hostPort + "/postgres?sslmode=disable"

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var db *pgxpool.Pool
	for {
		db, err = shareddb.Connect(ctx, dsn)
		if err == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("postgres never became ready: %v", err)
		case <-time.After(500 * time.Millisecond):
		}
	}
	if err := shareddb.Migrate(context.Background(), db, Migrations()); err != nil {
		t.Fatalf("running migrations: %v", err)
	}
	return db
}

func TestActivities_Query_Integration(t *testing.T) {
	db := startTestPostgres(t)
	repo := New(db)
	ctx := context.Background()

	belgrade := &activitiessvc.Point{Lat: 44.8125, Lng: 20.4612}

	t.Run("home scope returns only the Serbia cluster, closest first", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeHome, HomeLocation: belgrade, MaxDistanceKM: 50,
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		if len(got) < 5 {
			t.Fatalf("got %d activities, want at least 5", len(got))
		}
		for i, a := range got {
			if a.Country != "Serbia" {
				t.Errorf("activity %q has country %q, want Serbia (out of scope)", a.Title, a.Country)
			}
			if i > 0 && got[i-1].DistanceKM > a.DistanceKM {
				t.Errorf("results not closest-first at index %d: %v then %v", i, got[i-1].DistanceKM, a.DistanceKM)
			}
		}
	})

	t.Run("my_country scope excludes home_country", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeMyCountry, HomeCountry: "Serbia",
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		if len(got) < 5 {
			t.Fatalf("got %d activities, want at least 5", len(got))
		}
		for _, a := range got {
			if a.Country == "Serbia" {
				t.Errorf("activity %q is in home_country, should be excluded", a.Title)
			}
		}
	})

	t.Run("category filter narrows results", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeMyCountry, HomeCountry: "Serbia",
			Categories: []activitiessvc.Category{activitiessvc.CategorySports},
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		for _, a := range got {
			if a.Category != activitiessvc.CategorySports {
				t.Errorf("activity %q has category %q, want sports", a.Title, a.Category)
			}
		}
		if len(got) == 0 {
			t.Fatal("expected at least one sports activity outside Serbia")
		}
	})

	t.Run("min_rating filter narrows results", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeHome, HomeLocation: belgrade, MaxDistanceKM: 50,
			MinRating: 4.7,
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		for _, a := range got {
			if a.Rating < 4.7 {
				t.Errorf("activity %q has rating %v, want >= 4.7", a.Title, a.Rating)
			}
		}
	})
}
