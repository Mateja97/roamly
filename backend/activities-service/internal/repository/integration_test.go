//go:build integration

// Integration coverage for the real Postgres+PostGIS query path (scope
// radius via the GiST index, filter narrowing, closest-first ordering).
// Opt-in: requires a docker daemon. Run with `go test -tags=integration ./...`.
// ponytail: shells out to the docker CLI directly instead of adding
// testcontainers-go — one throwaway container, start/wait/stop is a dozen
// lines; reach for testcontainers if this grows more containers or retry logic.
package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"activities-service/internal/service"
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

	// Cluster A (Serbia, 7 activities) sits around Belgrade; cluster B (5
	// activities) sits abroad. See migrations/0002_seed.sql.
	belgrade := &activitiessvc.Point{Lat: 44.8125, Lng: 20.4612}

	t.Run("nearby scope returns only the Serbia cluster, closest first", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeNearby, CurrentLocation: belgrade, MaxDistanceKM: 50,
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

	t.Run("anywhere scope with a tight radius narrows to the Serbia cluster", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeAnywhere, CurrentLocation: belgrade, MaxDistanceKM: 50,
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		if len(got) < 5 {
			t.Fatalf("got %d activities, want at least 5", len(got))
		}
		for _, a := range got {
			if a.Country != "Serbia" {
				t.Errorf("activity %q has country %q, want Serbia (out of the anchored radius)", a.Title, a.Country)
			}
		}
	})

	t.Run("anywhere scope with no max_distance_km returns broadly, uncapped", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeAnywhere, CurrentLocation: belgrade,
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		var sawAbroad bool
		for _, a := range got {
			if a.Country != "Serbia" {
				sawAbroad = true
			}
		}
		if !sawAbroad {
			t.Error("expected activities outside Serbia when max_distance_km is unset (truly anywhere)")
		}
	})

	t.Run("anywhere scope with no reference point returns broadly", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeAnywhere,
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		if len(got) < 12 {
			t.Fatalf("got %d activities, want at least 12 (no filter applied)", len(got))
		}
	})

	t.Run("nearby scope enforces the 10km boundary", func(t *testing.T) {
		// 1 degree latitude ~= 111.19 km; place one activity just inside a
		// 10km radius and one just outside, then query with that fixed
		// radius (T2's service.NearbyRadiusKM value, inlined to keep this
		// package's tests independent of the service package).
		const nearbyRadiusKM = 10.0
		const kmPerDegreeLat = 111.19
		insideLat := belgrade.Lat + (9.0 / kmPerDegreeLat)
		outsideLat := belgrade.Lat + (11.0 / kmPerDegreeLat)

		var insideID, outsideID string
		err := db.QueryRow(ctx,
			`INSERT INTO activities (title, description, category, location, country, rating)
			VALUES ('Boundary Inside Test', 'test fixture', 'nature',
				ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 'Serbia', 4.0)
			RETURNING id`,
			belgrade.Lng, insideLat,
		).Scan(&insideID)
		if err != nil {
			t.Fatalf("inserting inside fixture: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, insideID) })

		err = db.QueryRow(ctx,
			`INSERT INTO activities (title, description, category, location, country, rating)
			VALUES ('Boundary Outside Test', 'test fixture', 'nature',
				ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 'Serbia', 4.0)
			RETURNING id`,
			belgrade.Lng, outsideLat,
		).Scan(&outsideID)
		if err != nil {
			t.Fatalf("inserting outside fixture: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, outsideID) })

		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeNearby, CurrentLocation: belgrade, MaxDistanceKM: nearbyRadiusKM,
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}

		var sawInside, sawOutside bool
		for _, a := range got {
			if a.ID == insideID {
				sawInside = true
			}
			if a.ID == outsideID {
				sawOutside = true
			}
		}
		if !sawInside {
			t.Error("activity ~9km away should be returned within the 10km radius")
		}
		if sawOutside {
			t.Error("activity ~11km away should not be returned within the 10km radius")
		}
	})

	t.Run("anywhere scope with cities unions per-city radius, independent of current_location", func(t *testing.T) {
		rome := activitiessvc.Point{Lat: 41.8902, Lng: 12.4922}
		newYork := &activitiessvc.Point{Lat: 40.7128, Lng: -74.0060} // far from both Rome and Belgrade
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope:           activitiessvc.ScopeAnywhere,
			CurrentLocation: newYork, // must be ignored for filtering once cities is set
			Cities:          []activitiessvc.Point{rome},
			MaxDistanceKM:   50,
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		if len(got) != 1 || got[0].Title != "Colosseum Guided Tour" {
			t.Fatalf("got %v, want exactly the Rome activity (near city A, far from current_location)", got)
		}
	})

	t.Run("anywhere scope with no cities falls back to point-radius from current_location", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeAnywhere, CurrentLocation: belgrade, MaxDistanceKM: 50,
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		for _, a := range got {
			if a.Country != "Serbia" {
				t.Errorf("activity %q has country %q, want Serbia (no-city fallback anchors on current_location)", a.Title, a.Country)
			}
		}
	})

	t.Run("category filter narrows results", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope:      activitiessvc.ScopeAnywhere,
			Categories: []activitiessvc.Category{activitiessvc.CategorySport},
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		for _, a := range got {
			if a.Category != activitiessvc.CategorySport {
				t.Errorf("activity %q has category %q, want sport", a.Title, a.Category)
			}
		}
		if len(got) == 0 {
			t.Fatal("expected at least one sport activity")
		}
	})

	t.Run("city column is backfilled and queryable per T1", func(t *testing.T) {
		wantCounts := map[string]int{
			"Belgrade":  13, // 7 from 0002_seed.sql + 6 new demo activities from 0008
			"Rome":      1,
			"Paris":     1,
			"Tokyo":     1,
			"New York":  1,
			"Barcelona": 1,
		}
		for city, want := range wantCounts {
			var got int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM activities WHERE city = $1", city).Scan(&got); err != nil {
				t.Fatalf("querying city %q: %v", city, err)
			}
			if got != want {
				t.Errorf("city %q: got %d activities, want %d", city, got, want)
			}
		}

		var uncategorized int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM activities WHERE city IS NULL").Scan(&uncategorized); err != nil {
			t.Fatalf("querying uncategorized: %v", err)
		}
		if uncategorized != 0 {
			t.Errorf("got %d seed activities with no city, want 0 (all seeded rows are backfilled)", uncategorized)
		}
	})

	t.Run("SuggestCities prefix match returns city, country and centroid (T4)", func(t *testing.T) {
		got, err := repo.SuggestCities(ctx, "Bar")
		if err != nil {
			t.Fatalf("SuggestCities() error: %v", err)
		}
		if len(got) != 1 || got[0].City != "Barcelona" || got[0].Country != "Spain" {
			t.Fatalf("got %+v, want exactly one Barcelona/Spain suggestion", got)
		}
		if got[0].Centroid.Lat == 0 || got[0].Centroid.Lng == 0 {
			t.Errorf("got zero-value centroid %+v, want the activity's coordinates", got[0].Centroid)
		}
	})

	t.Run("SuggestCities non-matching prefix returns an empty list, not an error", func(t *testing.T) {
		got, err := repo.SuggestCities(ctx, "Zzznope")
		if err != nil {
			t.Fatalf("SuggestCities() error: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("got %d suggestions, want 0", len(got))
		}
	})

	t.Run("details column round-trips category-specific JSON for a fresh row", func(t *testing.T) {
		var restaurantID string
		err := db.QueryRow(ctx,
			`INSERT INTO activities (title, description, category, location, country, rating, details)
			VALUES ('Details Fixture', 'test fixture', 'restaurants',
				ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 'Serbia', 4.0, $3)
			RETURNING id`,
			belgrade.Lng, belgrade.Lat, `{"cuisine":"Italian","popular_dishes":[{"name":"Pizza","price":"$12"}]}`,
		).Scan(&restaurantID)
		if err != nil {
			t.Fatalf("inserting details fixture: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, restaurantID) })

		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeAnywhere, CurrentLocation: belgrade, MaxDistanceKM: 5,
			Categories: []activitiessvc.Category{activitiessvc.CategoryRestaurants},
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}

		var found bool
		for _, a := range got {
			if a.ID != restaurantID {
				continue
			}
			found = true
			var details activitiessvc.RestaurantDetails
			if err := json.Unmarshal(a.Details, &details); err != nil {
				t.Fatalf("unmarshaling details: %v", err)
			}
			if details.Cuisine != "Italian" || len(details.PopularDishes) != 1 {
				t.Errorf("got details %+v, want Cuisine=Italian with 1 popular dish", details)
			}
		}
		if !found {
			t.Fatal("expected the details fixture activity in the results")
		}
	})

	t.Run("0008 backfills every category with a demo activity carrying valid, non-empty details", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{Scope: activitiessvc.ScopeAnywhere})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}

		wantCategories := []activitiessvc.Category{
			activitiessvc.CategoryRestaurants, activitiessvc.CategoryCafes, activitiessvc.CategoryBars,
			activitiessvc.CategoryNightlife, activitiessvc.CategoryNature, activitiessvc.CategorySport,
			activitiessvc.CategoryKids, activitiessvc.CategoryCulture, activitiessvc.CategoryArt,
			activitiessvc.CategoryWellness, activitiessvc.CategoryShopping, activitiessvc.CategoryEntertainment,
		}

		seenWithDetails := map[activitiessvc.Category]bool{}
		for _, a := range got {
			if len(bytes.TrimSpace(a.Details)) == 0 || string(a.Details) == "{}" {
				continue
			}
			if err := service.ValidateDetails(a.Category, a.Details); err != nil {
				t.Errorf("activity %q (category %s) has details that fail ValidateDetails: %v", a.Title, a.Category, err)
				continue
			}
			seenWithDetails[a.Category] = true
		}

		for _, cat := range wantCategories {
			if !seenWithDetails[cat] {
				t.Errorf("no seeded activity found for category %q with a non-empty, valid details payload", cat)
			}
		}
	})

	t.Run("0009 backfills action_url onto every seed row in the 8 affected categories, and year onto Art", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{Scope: activitiessvc.ScopeAnywhere})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}

		actionURLCategories := map[activitiessvc.Category]bool{
			activitiessvc.CategoryRestaurants:   true,
			activitiessvc.CategoryBars:          true,
			activitiessvc.CategoryNightlife:     true,
			activitiessvc.CategorySport:         true,
			activitiessvc.CategoryCulture:       true,
			activitiessvc.CategoryArt:           true,
			activitiessvc.CategoryWellness:      true,
			activitiessvc.CategoryEntertainment: true,
		}

		for _, a := range got {
			if !actionURLCategories[a.Category] {
				continue
			}
			var payload struct {
				ActionURL *string `json:"action_url"`
				Year      *int    `json:"year"`
			}
			if err := json.Unmarshal(a.Details, &payload); err != nil {
				t.Errorf("activity %q: unmarshaling details: %v", a.Title, err)
				continue
			}
			if payload.ActionURL == nil || *payload.ActionURL == "" {
				t.Errorf("activity %q (category %s) missing action_url after migration 0009", a.Title, a.Category)
			}
			if a.Category == activitiessvc.CategoryArt && (payload.Year == nil || *payload.Year == 0) {
				t.Errorf("activity %q (Art) missing year after migration 0009", a.Title)
			}
			if err := service.ValidateDetails(a.Category, a.Details); err != nil {
				t.Errorf("activity %q (category %s): ValidateDetails failed after 0009 backfill: %v", a.Title, a.Category, err)
			}
		}
	})

	t.Run("min_rating filter narrows results", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope: activitiessvc.ScopeNearby, CurrentLocation: belgrade, MaxDistanceKM: 50,
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
