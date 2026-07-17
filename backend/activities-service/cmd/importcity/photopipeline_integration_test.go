//go:build integration

// Integration coverage for ensurePhotos, the invariant-critical piece of the
// import pipeline: it must never duplicate photos on a re-run (Fix for the
// under-3-photos case) and must leave an already-sufficient row untouched.
// Opt-in: requires a docker daemon. Run with `go test -tags=integration ./...`.
// ponytail: same throwaway-container pattern as
// internal/repository/integration_test.go's startTestPostgres — duplicated
// here rather than exported cross-package, since it's a dozen lines and this
// is the only other package that needs it.
package main

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"activities-service/internal/photo"
	"activities-service/internal/repository"

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
	if err := shareddb.Migrate(context.Background(), db, repository.Migrations()); err != nil {
		t.Fatalf("running migrations: %v", err)
	}
	return db
}

// tinyPNG is a 1x1 image, valid enough for photo.Store.Save to decode and
// resave — its content doesn't matter, only that it's a real PNG.
func tinyPNG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatalf("encoding fixture PNG: %v", err)
	}
	return buf.Bytes()
}

func TestEnsurePhotos_Integration(t *testing.T) {
	db := startTestPostgres(t)
	repo := repository.New(db)
	store := photo.NewStore(t.TempDir())
	ctx := context.Background()

	var hits int
	photoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Write(tinyPNG(t))
	}))
	t.Cleanup(photoServer.Close)
	httpClient := photoServer.Client()

	insert := func(t *testing.T, sourceURL string) string {
		t.Helper()
		a, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
			Title: "Fixture", Description: "d", Category: activitiessvc.CategoryCafes,
			Lat: 44.8, Lng: 20.4, Country: "Serbia", City: "Belgrade",
			Rating: 4.0, Status: activitiessvc.StatusPending, Source: "firecrawl", SourceURL: sourceURL,
		})
		if err != nil {
			t.Fatalf("seeding row: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, a.ID) })
		return a.ID
	}

	t.Run("row with fewer than 3 reachable photos ends up pending + needs-photos, and a re-run does not duplicate", func(t *testing.T) {
		id := insert(t, "http://example/needs-photos")
		row := inputRow{Title: "Fixture", City: "Belgrade", Country: "Serbia", PhotoURLs: []string{photoServer.URL + "/1"}}

		rs, err := ensurePhotos(ctx, repo, store, httpClient, "", id, row)
		if err != nil {
			t.Fatalf("ensurePhotos() first run error: %v", err)
		}
		if rs.status != activitiessvc.StatusPending || !contains(rs.tags, "needs-photos") {
			t.Fatalf("first run status = %+v, want pending + needs-photos (only 1 photo, under minPhotos)", rs)
		}

		got, err := repo.GetByID(ctx, id)
		if err != nil {
			t.Fatalf("GetByID() after first run: %v", err)
		}
		if len(got.Photos) != 1 {
			t.Fatalf("photos after first run = %d, want 1", len(got.Photos))
		}
		hitsAfterFirst := hits

		// Regression guard for the duplicate-photos fix: running the SAME
		// row through ensurePhotos a second time must not change len(photos).
		rs2, err := ensurePhotos(ctx, repo, store, httpClient, "", id, row)
		if err != nil {
			t.Fatalf("ensurePhotos() second run error: %v", err)
		}
		if !contains(rs2.tags, "needs-photos") {
			t.Errorf("second run tags = %v, want still needs-photos (still under minPhotos)", rs2.tags)
		}

		got2, err := repo.GetByID(ctx, id)
		if err != nil {
			t.Fatalf("GetByID() after second run: %v", err)
		}
		if len(got2.Photos) != len(got.Photos) {
			t.Errorf("photos after second run = %d, want unchanged at %d (re-run must not duplicate)", len(got2.Photos), len(got.Photos))
		}
		if hits != hitsAfterFirst {
			t.Errorf("scraped-URL server got %d more hits on the re-run, want 0 (no existing photos == 0 required to re-download)", hits-hitsAfterFirst)
		}
	})

	t.Run("re-importing a published under-3-photo row does not reset its status", func(t *testing.T) {
		id := insert(t, "http://example/published-needs-photos")
		published := activitiessvc.StatusPublished
		if _, err := repo.Update(ctx, id, activitiessvc.UpdatePatch{Status: &published}); err != nil {
			t.Fatalf("publishing fixture row: %v", err)
		}

		row := inputRow{Title: "Fixture", City: "Belgrade", Country: "Serbia", PhotoURLs: []string{photoServer.URL + "/1"}}
		if _, err := ensurePhotos(ctx, repo, store, httpClient, "", id, row); err != nil {
			t.Fatalf("ensurePhotos() error: %v", err)
		}

		got, err := repo.GetByID(ctx, id)
		if err != nil {
			t.Fatalf("GetByID() error: %v", err)
		}
		if got.Status != activitiessvc.StatusPublished {
			t.Errorf("status after re-import = %q, want still %q (approval must survive an under-3-photo re-import)", got.Status, activitiessvc.StatusPublished)
		}
	})

	t.Run("row that already has >=3 photos is left untouched, no new downloads", func(t *testing.T) {
		id := insert(t, "http://example/already-full")
		existingPhotos := []activitiessvc.Photo{
			{URL: "/photos/x/a.jpg"}, {URL: "/photos/x/b.jpg"}, {URL: "/photos/x/c.jpg"},
		}
		if _, err := repo.Update(ctx, id, activitiessvc.UpdatePatch{Photos: &existingPhotos}); err != nil {
			t.Fatalf("seeding 3 photos: %v", err)
		}

		hitsBefore := hits
		row := inputRow{Title: "Fixture", City: "Belgrade", Country: "Serbia", PhotoURLs: []string{photoServer.URL + "/1"}}
		rs, err := ensurePhotos(ctx, repo, store, httpClient, "", id, row)
		if err != nil {
			t.Fatalf("ensurePhotos() error: %v", err)
		}
		if contains(rs.tags, "needs-photos") {
			t.Errorf("tags = %v, want no needs-photos tag (already has 3 photos)", rs.tags)
		}
		if hits != hitsBefore {
			t.Errorf("photo server got %d hits, want 0 (row with >=3 photos must skip entirely, no downloads)", hits-hitsBefore)
		}

		got, err := repo.GetByID(ctx, id)
		if err != nil {
			t.Fatalf("GetByID() error: %v", err)
		}
		if len(got.Photos) != 3 {
			t.Errorf("photos = %d, want unchanged at 3", len(got.Photos))
		}
	})
}
