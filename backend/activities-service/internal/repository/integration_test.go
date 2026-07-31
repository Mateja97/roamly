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
	"errors"
	"fmt"
	"io/fs"
	"os/exec"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"activities-service/internal/service"
	shareddb "backend/shared/db"
	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
)

// startTestPostgresPool starts a throwaway Postgres container and returns a
// connected, unmigrated pool — the part startTestPostgres and
// TestMigration0021DedupePreservesUniqueConstraint (which needs to seed rows
// mid-chain, before 0019-0021 run) both need.
func startTestPostgresPool(t *testing.T) *pgxpool.Pool {
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
	return db
}

func startTestPostgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	db := startTestPostgresPool(t)
	if err := shareddb.Migrate(context.Background(), db, Migrations()); err != nil {
		t.Fatalf("running migrations: %v", err)
	}
	return db
}

// migrationsThrough returns the embedded migration set truncated to the
// files up to and including cutoff (by filename, sorted the same way
// shareddb.Migrate applies them) — lets a test seed rows between two
// migrations instead of only before or after the whole chain.
func migrationsThrough(cutoff string) fs.FS {
	full := Migrations()
	entries, err := fs.ReadDir(full, ".")
	if err != nil {
		panic(err)
	}
	out := fstest.MapFS{}
	for _, e := range entries {
		if e.Name() > cutoff {
			continue
		}
		data, err := fs.ReadFile(full, e.Name())
		if err != nil {
			panic(err)
		}
		out[e.Name()] = &fstest.MapFile{Data: data}
	}
	return out
}

func TestMigration0012IngestionColumns(t *testing.T) {
	ctx := context.Background()
	pool := startTestPostgres(t)

	// description is nullable
	var isNullable string
	err := pool.QueryRow(ctx, `SELECT is_nullable FROM information_schema.columns
		WHERE table_name='activities' AND column_name='description'`).Scan(&isNullable)
	if err != nil {
		t.Fatalf("querying description column: %v", err)
	}
	if isNullable != "YES" {
		t.Fatalf("description is_nullable = %q, want YES", isNullable)
	}

	// source_url unique index rejects duplicates
	_, err = pool.Exec(ctx, `INSERT INTO activities
		(title, description, category, location, country, rating, source_url)
		VALUES ('A','d','cafes', ST_SetSRID(ST_MakePoint(0,0),4326)::geography, 'X', 0, 'http://x/1')`)
	if err != nil {
		t.Fatalf("first insert: %v", err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO activities
		(title, description, category, location, country, rating, source_url)
		VALUES ('B','d','cafes', ST_SetSRID(ST_MakePoint(0,0),4326)::geography, 'X', 0, 'http://x/1')`)
	if err == nil {
		t.Fatal("duplicate source_url insert succeeded, want unique-violation error")
	}
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
			"Belgrade":  98, // 7 from 0002_seed.sql - 1 (Skadarlija recategorized to restaurants) + 6 demo from 0008 - 1 bar - 1 cafe (0022 deletes legacy non-Tripadvisor cafes) + 118 from 0011_import_belgrade_listings - 20 restaurants/bars - 10 cafes (0016/0022 delete legacy non-Tripadvisor)
			"Rome":      1,  // history_and_culture (survives 0016)
			"Paris":     0,  // was food_and_drink, recategorized to restaurants in 0006, deleted by 0016
			"Tokyo":     0,  // was food_and_drink, recategorized to restaurants in 0006, deleted by 0016
			"New York":  1,  // sports (survives 0016)
			"Barcelona": 1,  // art_and_design (survives 0016)
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

	t.Run("existing seed rows backfill to published (T1)", func(t *testing.T) {
		var nonPublished int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM activities WHERE status != 'published'").Scan(&nonPublished); err != nil {
			t.Fatalf("counting non-published rows: %v", err)
		}
		if nonPublished != 0 {
			t.Errorf("got %d non-published seed rows, want 0 (the live catalog must backfill to published, not draft)", nonPublished)
		}
	})

	t.Run("draft and pending activities never appear in Query results (T1)", func(t *testing.T) {
		insertWithStatus := func(title, status string) string {
			var id string
			err := db.QueryRow(ctx,
				`INSERT INTO activities (title, description, category, location, country, rating, status)
				VALUES ($1, 'test fixture', 'nature',
					ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 'Serbia', 4.0, $4)
				RETURNING id`,
				title, belgrade.Lng, belgrade.Lat, status,
			).Scan(&id)
			if err != nil {
				t.Fatalf("inserting %s fixture: %v", status, err)
			}
			t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, id) })
			return id
		}
		draftID := insertWithStatus("Draft Fixture", "draft")
		pendingID := insertWithStatus("Pending Fixture", "pending")

		got, err := repo.Query(ctx, activitiessvc.QueryFilter{Scope: activitiessvc.ScopeAnywhere})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		for _, a := range got {
			if a.ID == draftID {
				t.Error("draft activity leaked into public Query results")
			}
			if a.ID == pendingID {
				t.Error("pending activity leaked into public Query results")
			}
		}
	})

	t.Run("status CHECK constraint rejects an invalid value", func(t *testing.T) {
		_, err := db.Exec(ctx,
			`INSERT INTO activities (title, description, category, location, country, rating, status)
			VALUES ('Bad Status Fixture', 'test fixture', 'nature',
				ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 'Serbia', 4.0, 'bogus')`,
			belgrade.Lng, belgrade.Lat,
		)
		if err == nil {
			t.Fatal("expected an error inserting an invalid status value, got nil")
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

	t.Run("SuggestCities excludes a draft-only city (T1)", func(t *testing.T) {
		var id string
		err := db.QueryRow(ctx,
			`INSERT INTO activities (title, description, category, location, country, city, rating, status)
			VALUES ('Draft City Fixture', 'test fixture', 'nature',
				ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 'Narnia', 'Zzzville', 4.0, 'draft')
			RETURNING id`,
			belgrade.Lng, belgrade.Lat,
		).Scan(&id)
		if err != nil {
			t.Fatalf("inserting draft-only city fixture: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, id) })

		got, err := repo.SuggestCities(ctx, "Zzz")
		if err != nil {
			t.Fatalf("SuggestCities() error: %v", err)
		}
		if len(got) != 0 {
			t.Errorf("got %+v, want no suggestions (Zzzville only exists as a draft row)", got)
		}

		t.Run("AdminDistinctCities includes it (T2 has no published-only restriction)", func(t *testing.T) {
			got, err := repo.AdminDistinctCities(ctx)
			if err != nil {
				t.Fatalf("AdminDistinctCities() error: %v", err)
			}
			found := false
			for _, c := range got {
				if c == "Zzzville" {
					found = true
				}
			}
			if !found {
				t.Errorf("got %v, want it to include the draft-only city Zzzville", got)
			}
		})
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
			// restaurants, cafes and bars demo activities are deleted by 0016/0022 (legacy
			// non-Tripadvisor). All seeded restaurants/cafes/bars were sourced from Google or
			// created by hand; 0016/0022 are the cutover to Tripadvisor-exclusive for these
			// three categories.
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

// TestActivities_Query_DedupesCrossCategoryDuplicatesWhenUnfiltered proves
// Task 8b: Upsert conflicts on (source_url, category) (see 0017), so a venue
// matching discovery rows in two categories legitimately becomes two rows —
// live example: Tašmajdan as both nature/park and sport/sports_court. An
// unfiltered Query must collapse those into one; a category-filtered Query
// must still surface every one of them, since a filter already narrows to at
// most one row per venue. A separate container from
// TestActivities_Query_Integration so these fixture rows can't perturb that
// test's exact-count assertions on the seeded catalog.
func TestActivities_Query_DedupesCrossCategoryDuplicatesWhenUnfiltered(t *testing.T) {
	db := startTestPostgres(t)
	repo := New(db)
	ctx := context.Background()

	const externalID = "dedup-test-tasmajdan"
	base := activitiessvc.IngestActivity{
		Title: "Dedup Test Tasmajdan", Description: "test fixture",
		Lat: 44.8125, Lng: 20.4612, Country: "Serbia", City: "Belgrade",
		Rating: 4.5, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: externalID,
	}

	parkIn := base
	parkIn.Category = activitiessvc.CategoryNature
	parkIn.Subcategory = "park"
	parkIn.SourceURL = "https://places/dedup-test-tasmajdan-nature"
	parkRow, err := repo.Upsert(ctx, parkIn)
	if err != nil {
		t.Fatalf("upserting park row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, parkRow.ID) })

	sportIn := base
	sportIn.Category = activitiessvc.CategorySport
	sportIn.Subcategory = "sports_court"
	sportIn.SourceURL = "https://places/dedup-test-tasmajdan-sport"
	sportRow, err := repo.Upsert(ctx, sportIn)
	if err != nil {
		t.Fatalf("upserting sport row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, sportRow.ID) })

	// Same external_id, no subcategory — the tie-break (subcategory <> '')
	// DESC must never let this one win over park/sport, both of which carry
	// a subtype.
	noSubtypeIn := base
	noSubtypeIn.Category = activitiessvc.CategoryEntertainment
	noSubtypeIn.SourceURL = "https://places/dedup-test-tasmajdan-entertainment"
	noSubtypeRow, err := repo.Upsert(ctx, noSubtypeIn)
	if err != nil {
		t.Fatalf("upserting no-subtype row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, noSubtypeRow.ID) })

	// An unrelated venue (different external_id) that dedup must never touch.
	unrelatedIn := activitiessvc.IngestActivity{
		Title: "Dedup Test Unrelated Gallery", Description: "test fixture",
		Lat: 44.82, Lng: 20.47, Country: "Serbia", City: "Belgrade",
		Rating: 4.0, Status: activitiessvc.StatusPublished,
		Source: "google_places", ExternalID: "dedup-test-unrelated",
		Category: activitiessvc.CategoryArt, SourceURL: "https://places/dedup-test-unrelated",
	}
	unrelatedRow, err := repo.Upsert(ctx, unrelatedIn)
	if err != nil {
		t.Fatalf("upserting unrelated row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, unrelatedRow.ID) })

	fixtureIDs := map[string]bool{parkRow.ID: true, sportRow.ID: true, noSubtypeRow.ID: true}
	survivorOf := func(got []activitiessvc.Activity) string {
		for _, a := range got {
			if fixtureIDs[a.ID] {
				return a.ID
			}
		}
		return ""
	}

	t.Run("unfiltered query collapses the three shared-external_id rows into one, unrelated row untouched", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{Scope: activitiessvc.ScopeAnywhere})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		var hits int
		var sawUnrelated bool
		for _, a := range got {
			if fixtureIDs[a.ID] {
				hits++
			}
			if a.ID == unrelatedRow.ID {
				sawUnrelated = true
			}
		}
		if hits != 1 {
			t.Errorf("got %d of the 3 shared-external_id rows, want exactly 1 (collapsed)", hits)
		}
		if !sawUnrelated {
			t.Error("unrelated row missing from unfiltered results")
		}
	})

	t.Run("category filter still surfaces the venue — dedup must not hide it", func(t *testing.T) {
		got, err := repo.Query(ctx, activitiessvc.QueryFilter{
			Scope:      activitiessvc.ScopeAnywhere,
			Categories: []activitiessvc.Category{activitiessvc.CategorySport},
		})
		if err != nil {
			t.Fatalf("Query() error: %v", err)
		}
		var found bool
		for _, a := range got {
			if a.ID == sportRow.ID {
				found = true
			}
			if fixtureIDs[a.ID] && a.ID != sportRow.ID {
				t.Errorf("sport-filtered query returned a non-sport fixture row %s, want the filter untouched by dedup", a.ID)
			}
		}
		if !found {
			t.Error("sport-filtered query dropped the sport row — dedup must never apply when a category filter narrows the result")
		}
	})

	t.Run("survivor is deterministic across repeated unfiltered queries, not merely the count", func(t *testing.T) {
		first, err := repo.Query(ctx, activitiessvc.QueryFilter{Scope: activitiessvc.ScopeAnywhere})
		if err != nil {
			t.Fatalf("first Query() error: %v", err)
		}
		second, err := repo.Query(ctx, activitiessvc.QueryFilter{Scope: activitiessvc.ScopeAnywhere})
		if err != nil {
			t.Fatalf("second Query() error: %v", err)
		}

		firstSurvivor, secondSurvivor := survivorOf(first), survivorOf(second)
		if firstSurvivor == "" || secondSurvivor == "" {
			t.Fatalf("survivor missing from a run: first=%q second=%q", firstSurvivor, secondSurvivor)
		}
		if firstSurvivor != secondSurvivor {
			t.Errorf("survivor changed across repeated queries (%q then %q); a dedup that picks arbitrarily would still pass a count-only assertion", firstSurvivor, secondSurvivor)
		}
		if firstSurvivor == noSubtypeRow.ID {
			t.Errorf("survivor was the no-subtype row %s, want a subtype-carrying row (park %s or sport %s) to win the tie-break", firstSurvivor, parkRow.ID, sportRow.ID)
		}
	})
}

// TestActivities_AdminCRUD_Integration covers T2's first real write path
// against real Postgres: JSONB details/photos round-trip through pgx's
// automatic marshaling (never exercised before T2 — QueryActivities only
// ever reads), Create's location/country/rating sentinels, Update's partial
// SET list, and List's pagination/filtering/stats. A separate container
// from TestActivities_Query_Integration so writes here can't perturb that
// test's exact-count assertions on the seeded catalog.
func TestActivities_AdminCRUD_Integration(t *testing.T) {
	db := startTestPostgres(t)
	repo := New(db)
	ctx := context.Background()

	t.Run("Create defaults status to what's given, sentinels location/country/rating, and round-trips details+photos", func(t *testing.T) {
		created, err := repo.Create(ctx, activitiessvc.NewActivity{
			Title: "Admin Created Kayaking", Description: "test fixture", Category: activitiessvc.CategorySport,
			City: "Belgrade", Address: "Ada Ciganlija bb", Status: activitiessvc.StatusDraft,
			Details: json.RawMessage(`{"difficulty":3,"what_to_bring":["water"]}`),
			Photos:  []activitiessvc.Photo{{URL: "https://example.com/kayak.jpg"}},
		})
		if err != nil {
			t.Fatalf("Create() error: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, created.ID) })

		if created.ID == "" {
			t.Fatal("Create() returned an empty id")
		}
		if created.Status != activitiessvc.StatusDraft || created.City != "Belgrade" || created.Address != "Ada Ciganlija bb" {
			t.Errorf("created activity = %+v, want status=draft city=Belgrade address='Ada Ciganlija bb'", created)
		}
		if created.Location.Lat != 0 || created.Location.Lng != 0 || created.Country != "" || created.Rating != 0 {
			t.Errorf("created activity location/country/rating = %+v, want the (0,0)/''/0 sentinels", created)
		}
		var details activitiessvc.SportDetails
		if err := json.Unmarshal(created.Details, &details); err != nil {
			t.Fatalf("unmarshaling created details: %v", err)
		}
		if details.Difficulty != 3 || len(details.WhatToBring) != 1 {
			t.Errorf("created details = %+v, want difficulty=3 with 1 item", details)
		}
		if len(created.Photos) != 1 || created.Photos[0].URL != "https://example.com/kayak.jpg" {
			t.Errorf("created photos = %+v, want the one submitted photo", created.Photos)
		}

		t.Run("GetByID returns the created row, drafts included (unlike Query)", func(t *testing.T) {
			got, err := repo.GetByID(ctx, created.ID)
			if err != nil {
				t.Fatalf("GetByID() error: %v", err)
			}
			if got.ID != created.ID || got.Title != created.Title {
				t.Errorf("GetByID() = %+v, want the created activity", got)
			}
		})
	})

	t.Run("Create with no details defaults to an empty object, not NULL/invalid JSON", func(t *testing.T) {
		created, err := repo.Create(ctx, activitiessvc.NewActivity{Title: "No Details", Category: activitiessvc.CategoryKids, Status: activitiessvc.StatusDraft})
		if err != nil {
			t.Fatalf("Create() error: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, created.ID) })
		if string(created.Details) != "{}" {
			t.Errorf("created details = %s, want {}", created.Details)
		}
	})

	t.Run("GetByID on a missing id returns ErrNotFound", func(t *testing.T) {
		_, err := repo.GetByID(ctx, "00000000-0000-0000-0000-000000000000")
		if !errors.Is(err, sharederrors.ErrNotFound) {
			t.Errorf("GetByID() error = %v, want ErrNotFound", err)
		}
	})

	t.Run("Update on a missing id returns ErrNotFound", func(t *testing.T) {
		title := "X"
		_, err := repo.Update(ctx, "00000000-0000-0000-0000-000000000000", activitiessvc.UpdatePatch{Title: &title})
		if !errors.Is(err, sharederrors.ErrNotFound) {
			t.Errorf("Update() error = %v, want ErrNotFound", err)
		}
	})

	t.Run("Update only touches the fields set in the patch", func(t *testing.T) {
		created, err := repo.Create(ctx, activitiessvc.NewActivity{
			Title: "Original Title", Description: "original description", Category: activitiessvc.CategorySport,
			City: "Belgrade", Status: activitiessvc.StatusDraft,
		})
		if err != nil {
			t.Fatalf("Create() error: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, created.ID) })

		newTitle := "Updated Title"
		newStatus := activitiessvc.StatusPublished
		updated, err := repo.Update(ctx, created.ID, activitiessvc.UpdatePatch{Title: &newTitle, Status: &newStatus})
		if err != nil {
			t.Fatalf("Update() error: %v", err)
		}
		if updated.Title != "Updated Title" || updated.Status != activitiessvc.StatusPublished {
			t.Errorf("updated = %+v, want title/status changed", updated)
		}
		if updated.Description != "original description" || updated.City != "Belgrade" || updated.Category != activitiessvc.CategorySport {
			t.Errorf("updated = %+v, want every other field untouched (PATCH semantics)", updated)
		}
	})

	t.Run("Update with an empty-string field sets it, distinct from omitting it", func(t *testing.T) {
		created, err := repo.Create(ctx, activitiessvc.NewActivity{
			Title: "Has A City", Category: activitiessvc.CategoryArt, City: "Paris", Status: activitiessvc.StatusDraft,
		})
		if err != nil {
			t.Fatalf("Create() error: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, created.ID) })

		emptyCity := ""
		updated, err := repo.Update(ctx, created.ID, activitiessvc.UpdatePatch{City: &emptyCity})
		if err != nil {
			t.Fatalf("Update() error: %v", err)
		}
		if updated.City != "" {
			t.Errorf("updated city = %q, want cleared to empty string", updated.City)
		}
	})

	t.Run("Update with no set fields is a no-op read, not an invalid SQL statement", func(t *testing.T) {
		created, err := repo.Create(ctx, activitiessvc.NewActivity{Title: "Untouched", Category: activitiessvc.CategoryArt, Status: activitiessvc.StatusDraft})
		if err != nil {
			t.Fatalf("Create() error: %v", err)
		}
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, created.ID) })

		got, err := repo.Update(ctx, created.ID, activitiessvc.UpdatePatch{})
		if err != nil {
			t.Fatalf("Update() error: %v", err)
		}
		if got.Title != "Untouched" {
			t.Errorf("Update() with an empty patch = %+v, want the row unchanged", got)
		}
	})

	t.Run("List paginates in SQL, filters, and computes catalog-wide stats", func(t *testing.T) {
		fixtures := []struct {
			title, category, city, status string
		}{
			{"List Fixture Alpha", "sport", "Novi Sad", "draft"},
			{"List Fixture Bravo", "sport", "Novi Sad", "pending"},
			{"List Fixture Charlie", "art", "Novi Sad", "published"},
		}
		var ids []string
		for _, f := range fixtures {
			created, err := repo.Create(ctx, activitiessvc.NewActivity{
				Title: f.title, Category: activitiessvc.Category(f.category), City: f.city, Status: activitiessvc.Status(f.status),
			})
			if err != nil {
				t.Fatalf("Create() fixture error: %v", err)
			}
			ids = append(ids, created.ID)
		}
		t.Cleanup(func() {
			for _, id := range ids {
				db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, id)
			}
		})

		t.Run("city + category filter narrows to the matching fixtures, sorted by title", func(t *testing.T) {
			result, err := repo.List(ctx, activitiessvc.ListFilter{City: "Novi Sad", Category: activitiessvc.CategorySport, Limit: 10, Offset: 0})
			if err != nil {
				t.Fatalf("List() error: %v", err)
			}
			if result.Total != 2 || len(result.Activities) != 2 {
				t.Fatalf("List() total/len = %d/%d, want 2/2", result.Total, len(result.Activities))
			}
			if result.Activities[0].Title != "List Fixture Alpha" || result.Activities[1].Title != "List Fixture Bravo" {
				t.Errorf("List() activities = %+v, want title ASC order", result.Activities)
			}
		})

		t.Run("q substring filter is case-insensitive", func(t *testing.T) {
			result, err := repo.List(ctx, activitiessvc.ListFilter{Q: "fixture charlie", Limit: 10, Offset: 0})
			if err != nil {
				t.Fatalf("List() error: %v", err)
			}
			if result.Total != 1 || len(result.Activities) != 1 || result.Activities[0].Title != "List Fixture Charlie" {
				t.Errorf("List() = %+v, want exactly the Charlie fixture", result)
			}
		})

		t.Run("pagination narrows the page while total reflects the whole filtered set", func(t *testing.T) {
			result, err := repo.List(ctx, activitiessvc.ListFilter{City: "Novi Sad", Limit: 1, Offset: 1})
			if err != nil {
				t.Fatalf("List() error: %v", err)
			}
			if result.Total != 3 {
				t.Errorf("List() total = %d, want 3 (unaffected by LIMIT/OFFSET)", result.Total)
			}
			if len(result.Activities) != 1 {
				t.Fatalf("List() page = %+v, want exactly 1 row (limit)", result.Activities)
			}
		})

		t.Run("stats count the whole catalog, ignoring the filter", func(t *testing.T) {
			result, err := repo.List(ctx, activitiessvc.ListFilter{City: "Novi Sad", Category: activitiessvc.CategoryArt, Limit: 10, Offset: 0})
			if err != nil {
				t.Fatalf("List() error: %v", err)
			}
			if result.Stats.Total < result.Total {
				t.Errorf("stats.Total = %d, want >= the filtered Total %d (stats ignore the filter)", result.Stats.Total, result.Total)
			}
			if result.Stats.Draft < 1 || result.Stats.Pending < 1 || result.Stats.Published < 1 {
				t.Errorf("stats = %+v, want at least 1 of each status counted (from these fixtures + the seed data)", result.Stats)
			}
		})
	})
}

func TestUpsertThenUpdateTagsPersistsNeedsPhotos(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgres(t)
	repo := New(db)

	in := activitiessvc.IngestActivity{
		Title: "Tag Fixture", Description: "cafe", Category: activitiessvc.CategoryCafes,
		Lat: 44.8178, Lng: 20.4547, Country: "Serbia", City: "Belgrade",
		Rating: 4.3, Status: activitiessvc.StatusPending,
		Source: "google_places", SourceURL: "http://example/tag-fixture",
	}
	created, err := repo.Upsert(ctx, in)
	if err != nil {
		t.Fatalf("Upsert() error: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, created.ID) })

	tags := []string{"needs-photos"}
	if _, err := repo.Update(ctx, created.ID, activitiessvc.UpdatePatch{Tags: &tags}); err != nil {
		t.Fatalf("Update() error: %v", err)
	}

	got, err := repo.GetByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	found := false
	for _, tag := range got.Tags {
		if tag == "needs-photos" {
			found = true
		}
	}
	if !found {
		t.Errorf("GetByID() tags = %v, want to contain needs-photos", got.Tags)
	}
}

func TestUpsertIdempotentBySourceURL(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgres(t)
	repo := New(db)

	in := activitiessvc.IngestActivity{
		Title: "Koffein", Description: "cafe", Category: activitiessvc.CategoryCafes,
		Lat: 44.8178, Lng: 20.4547, Country: "Serbia", City: "Belgrade",
		Rating: 4.3, Status: activitiessvc.StatusPending,
		Source: "google_places", SourceURL: "http://example/koffein",
	}
	first, err := repo.Upsert(ctx, in)
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, first.ID) })

	// Simulate admin-owned state that a re-import must not clobber: a
	// published status and a downloaded photo, set out-of-band via Update
	// (the same path the importer's photo pipeline and the admin surface use)
	// rather than through Upsert itself.
	publishedStatus := activitiessvc.StatusPublished
	photos := []activitiessvc.Photo{{URL: "/photos/x/a.jpg", ThumbURL: "/photos/x/a_t.jpg"}}
	if _, err := repo.Update(ctx, first.ID, activitiessvc.UpdatePatch{Status: &publishedStatus, Photos: &photos}); err != nil {
		t.Fatalf("seeding published status + photo: %v", err)
	}

	in.Rating = 4.9 // same source_url, changed field
	second, err := repo.Upsert(ctx, in)
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("upsert created a new row (%s != %s), want update in place", first.ID, second.ID)
	}
	if second.Rating != 4.9 {
		t.Fatalf("rating = %v, want 4.9 (updated)", second.Rating)
	}
	if second.Status != activitiessvc.StatusPublished {
		t.Errorf("status = %q, want published preserved (re-import must not un-publish an admin-approved row)", second.Status)
	}
	if len(second.Photos) != 1 || second.Photos[0].URL != "/photos/x/a.jpg" {
		t.Errorf("photos = %+v, want the pre-existing photo preserved (photos excluded from the conflict update)", second.Photos)
	}
}

// TestUpsertDedupesBySourceURLAndCategoryNotSourceURLAlone proves the
// 0017 migration's fix: the same source_url may legitimately exist as two
// separate rows under two different categories (a venue Tripadvisor-synced
// as both Restaurants and Bars, since Terra has no bars-specific category
// and both syncs query it identically), and each category stays idempotent
// on its own — a same-source_url-same-category re-upsert still updates the
// original row in place rather than creating a third one.
func TestUpsertDedupesBySourceURLAndCategoryNotSourceURLAlone(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgres(t)
	repo := New(db)

	const sourceURL = "https://ta/dual-category-venue"
	restaurantIn := activitiessvc.IngestActivity{
		Title: "Ambar Beograd", Category: activitiessvc.CategoryRestaurants,
		Lat: 44.8178, Lng: 20.4547, Country: "Serbia", City: "Belgrade",
		Rating: 4.5, Status: activitiessvc.StatusPublished,
		Source: "tripadvisor", SourceURL: sourceURL, ExternalID: "111",
	}
	barIn := restaurantIn
	barIn.Category = activitiessvc.CategoryBars

	restaurantRow, err := repo.Upsert(ctx, restaurantIn)
	if err != nil {
		t.Fatalf("upserting restaurant row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, restaurantRow.ID) })

	barRow, err := repo.Upsert(ctx, barIn)
	if err != nil {
		t.Fatalf("upserting bar row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, barRow.ID) })

	if restaurantRow.ID == barRow.ID {
		t.Fatalf("bar upsert reused the restaurant row's ID (%s) — same source_url, different category should not collide", restaurantRow.ID)
	}

	gotRestaurant, err := repo.GetByID(ctx, restaurantRow.ID)
	if err != nil {
		t.Fatalf("GetByID(restaurant): %v", err)
	}
	if gotRestaurant.Category != activitiessvc.CategoryRestaurants {
		t.Errorf("restaurant row category = %q, want %q — the bar upsert must not have overwritten it", gotRestaurant.Category, activitiessvc.CategoryRestaurants)
	}

	gotBar, err := repo.GetByID(ctx, barRow.ID)
	if err != nil {
		t.Fatalf("GetByID(bar): %v", err)
	}
	if gotBar.Category != activitiessvc.CategoryBars {
		t.Errorf("bar row category = %q, want %q", gotBar.Category, activitiessvc.CategoryBars)
	}

	// Re-upserting the same source_url + same category (restaurant) must
	// still update the first row in place, not create a third row — the new
	// uniqueness is scoped to (source_url, category), not source_url alone.
	restaurantIn.Rating = 4.9
	thirdUpsert, err := repo.Upsert(ctx, restaurantIn)
	if err != nil {
		t.Fatalf("re-upserting restaurant row: %v", err)
	}
	if thirdUpsert.ID != restaurantRow.ID {
		t.Fatalf("re-upsert with same source_url+category created a new row (%s != %s), want update in place", thirdUpsert.ID, restaurantRow.ID)
	}
	if thirdUpsert.Rating != 4.9 {
		t.Errorf("rating = %v, want 4.9 (updated)", thirdUpsert.Rating)
	}
}

// TestUpsertStoresPlaceIDAsExternalIDWithGooglePlacesSource proves T1's
// ingestion round trip: a known Places place_id lands verbatim in
// external_id (not GoogleMapsURI, not the raw blob), and source reads
// "google_places" — never the old hardcoded "firecrawl".
func TestUpsertStoresPlaceIDAsExternalIDWithGooglePlacesSource(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgres(t)
	repo := New(db)

	const placeID = "ChIJp0lN2xVXWkcR1LFV3KHDbZ0"
	a, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "External ID Fixture", Description: "cafe", Category: activitiessvc.CategoryCafes,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", City: "Belgrade",
		Rating: 4.5, Status: activitiessvc.StatusPending,
		Source: "google_places", SourceURL: "https://maps.google.com/?cid=12345",
		ExternalID: placeID,
	})
	if err != nil {
		t.Fatalf("Upsert() error: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, a.ID) })

	if a.ExternalID != placeID {
		t.Errorf("external_id = %q, want %q", a.ExternalID, placeID)
	}

	got, err := repo.GetByID(ctx, a.ID)
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if got.ExternalID != placeID {
		t.Errorf("persisted external_id = %q, want %q", got.ExternalID, placeID)
	}

	var source string
	if err := db.QueryRow(ctx, `SELECT source FROM activities WHERE id = $1`, a.ID).Scan(&source); err != nil {
		t.Fatalf("querying source: %v", err)
	}
	if source != "google_places" {
		t.Errorf("source = %q, want google_places", source)
	}
}

// TestSyncRegionsPrimaryKey proves 0024's widened composite primary key
// (provider, cell_key, category, subtype) — generalized from Tripadvisor's
// original (cell_key, category) — still rejects an exact duplicate while
// allowing a different category, subtype, or provider at the same cell to
// coexist (Google's per-subtype rows track freshness independently from
// Tripadvisor's whole-category rows).
func TestSyncRegionsPrimaryKey(t *testing.T) {
	ctx := context.Background()
	pool := startTestPostgres(t)

	if _, err := pool.Exec(ctx, `INSERT INTO sync_regions (provider, cell_key, category, subtype, synced_at) VALUES ('tripadvisor', '44.8,20.5', 'restaurants', '', now())`); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sync_regions (provider, cell_key, category, subtype, synced_at) VALUES ('tripadvisor', '44.8,20.5', 'restaurants', '', now())`); err == nil {
		t.Fatal("duplicate (provider, cell_key, category, subtype) insert succeeded, want primary-key violation")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sync_regions (provider, cell_key, category, subtype, synced_at) VALUES ('tripadvisor', '44.8,20.5', 'bars', '', now())`); err != nil {
		t.Fatalf("different-category insert at the same cell: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sync_regions (provider, cell_key, category, subtype, synced_at) VALUES ('google', '44.8,20.5', 'nature', 'beach', now())`); err != nil {
		t.Fatalf("different-provider/subtype insert at the same cell: %v", err)
	}
}

// TestUpsertStoresSourceReadableViaGetByID proves the `source` column
// (already written by Upsert since 0012_ingestion.sql) now round-trips
// through the domain Activity struct via GetByID, not just raw SQL.
func TestUpsertStoresSourceReadableViaGetByID(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgres(t)
	repo := New(db)

	a, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "Source Fixture", Description: "restaurant", Category: activitiessvc.CategoryRestaurants,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", City: "Belgrade",
		Rating: 4.5, Status: activitiessvc.StatusPublished,
		Source: "tripadvisor", SourceURL: "https://www.tripadvisor.com/Restaurant_Review-x",
		ExternalID: "12345",
	})
	if err != nil {
		t.Fatalf("Upsert() error: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, a.ID) })

	got, err := repo.GetByID(ctx, a.ID)
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if got.Source != "tripadvisor" {
		t.Errorf("Source = %q, want %q", got.Source, "tripadvisor")
	}
}

// TestSyncedAtAndMarkSynced proves the repository-layer freshness
// read/write the lazy sync (service.Activities.syncTripadvisorIfNeeded)
// relies on: no record reports ok=false, MarkSynced then SyncedAt reports
// a fresh timestamp, and a different category at the same cell is tracked
// independently.
func TestSyncedAtAndMarkSynced(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgres(t)
	repo := New(db)

	_, ok, err := repo.SyncedAt(ctx, "tripadvisor", "44.8,20.5", "restaurants", "")
	if err != nil {
		t.Fatalf("SyncedAt() error: %v", err)
	}
	if ok {
		t.Fatal("SyncedAt() ok = true, want false for a never-synced cell")
	}

	// ponytail: small sleep to account for potential clock skew between
	// container and host (database now() might be slightly earlier than Go time.Now()).
	time.Sleep(time.Millisecond)
	before := time.Now()
	if err := repo.MarkSynced(ctx, "tripadvisor", "44.8,20.5", "restaurants", ""); err != nil {
		t.Fatalf("MarkSynced() error: %v", err)
	}

	syncedAt, ok, err := repo.SyncedAt(ctx, "tripadvisor", "44.8,20.5", "restaurants", "")
	if err != nil {
		t.Fatalf("SyncedAt() error: %v", err)
	}
	if !ok {
		t.Fatal("SyncedAt() ok = false, want true right after MarkSynced")
	}
	if syncedAt.Before(before) {
		t.Errorf("syncedAt = %v, want >= %v", syncedAt, before)
	}

	_, ok, err = repo.SyncedAt(ctx, "tripadvisor", "44.8,20.5", "bars", "")
	if err != nil {
		t.Fatalf("SyncedAt() error: %v", err)
	}
	if ok {
		t.Fatal("SyncedAt() ok = true for bars, want false — restaurants and bars track independently")
	}

	// Re-marking the same cell/category updates the timestamp in place
	// rather than erroring on a duplicate primary key.
	if err := repo.MarkSynced(ctx, "tripadvisor", "44.8,20.5", "restaurants", ""); err != nil {
		t.Fatalf("MarkSynced() (second call) error: %v", err)
	}

	// A Google row at the same cell but a different provider/subtype tracks
	// freshness independently — the granularity 0024 exists for.
	_, ok, err = repo.SyncedAt(ctx, "google", "44.8,20.5", "nature", "beach")
	if err != nil {
		t.Fatalf("SyncedAt() error: %v", err)
	}
	if ok {
		t.Fatal("SyncedAt() ok = true for google/nature/beach, want false — providers and subtypes track independently")
	}
}

// TestDeleteLegacyRestaurantsBars_Predicate proves 0016's cutover DELETE
// targets exactly the rows it should. The migration itself already ran
// (once, against an empty DB) by the time startTestPostgres returns —
// there's no data yet for a one-time cleanup migration to act on in a
// fresh test DB — so this test re-executes 0016's exact DELETE statement
// against freshly seeded fixture rows, the only way to exercise a
// one-time data migration's WHERE-clause logic.
func TestDeleteLegacyRestaurantsBars_Predicate(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgres(t)
	repo := New(db)

	googleRestaurant, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "Legacy Google Restaurant", Description: "d", Category: activitiessvc.CategoryRestaurants,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.0, Status: activitiessvc.StatusPending,
		Source: "google_places", SourceURL: "http://legacy/1",
	})
	if err != nil {
		t.Fatalf("seeding google restaurant: %v", err)
	}
	taRestaurant, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "Tripadvisor Restaurant", Description: "d", Category: activitiessvc.CategoryRestaurants,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.5, Status: activitiessvc.StatusPublished,
		Source: "tripadvisor", SourceURL: "http://legacy/2",
	})
	if err != nil {
		t.Fatalf("seeding tripadvisor restaurant: %v", err)
	}
	otherCategory, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "Legacy Google Museum", Description: "d", Category: activitiessvc.CategoryCulture,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.2, Status: activitiessvc.StatusPending,
		Source: "google_places", SourceURL: "http://legacy/3",
	})
	if err != nil {
		t.Fatalf("seeding other-category row: %v", err)
	}
	adminBar, err := repo.Create(ctx, activitiessvc.NewActivity{
		Title: "Legacy Admin Bar", Category: activitiessvc.CategoryBars, Status: activitiessvc.StatusPublished,
	})
	if err != nil {
		t.Fatalf("seeding admin-created bar: %v", err)
	}

	if _, err := db.Exec(ctx, `DELETE FROM activities WHERE category IN ('restaurants', 'bars') AND source IS DISTINCT FROM 'tripadvisor'`); err != nil {
		t.Fatalf("running 0016's delete: %v", err)
	}

	if _, err := repo.GetByID(ctx, googleRestaurant.ID); !errors.Is(err, sharederrors.ErrNotFound) {
		t.Errorf("legacy google restaurant: GetByID() error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetByID(ctx, adminBar.ID); !errors.Is(err, sharederrors.ErrNotFound) {
		t.Errorf("legacy admin bar: GetByID() error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetByID(ctx, taRestaurant.ID); err != nil {
		t.Errorf("tripadvisor restaurant: GetByID() error = %v, want it to survive the delete", err)
	} else {
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, taRestaurant.ID) })
	}
	if _, err := repo.GetByID(ctx, otherCategory.ID); err != nil {
		t.Errorf("other-category google row: GetByID() error = %v, want it to survive the delete", err)
	} else {
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, otherCategory.ID) })
	}
}

// TestDeleteTripadvisorJunkVenues_Predicate proves 0019's cleanup DELETE
// matches service.hasFoodDrinkSignal exactly: rows with no price_level, no
// subratings, and under 10 reviews are removed; a row with any one of those
// three signals survives, mirroring the sync-time gate this migration is a
// one-time catch-up for.
func TestDeleteTripadvisorJunkVenues_Predicate(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgres(t)
	repo := New(db)

	details := func(t *testing.T, priceLevel string, subratings bool, reviewCount int) json.RawMessage {
		t.Helper()
		ta := map[string]any{"review_count": reviewCount}
		if priceLevel != "" {
			ta["price_level"] = priceLevel
		}
		if subratings {
			ta["subratings"] = map[string]any{"food": map[string]any{"rating": 4.0}}
		}
		raw, err := json.Marshal(map[string]any{"tripadvisor": ta})
		if err != nil {
			t.Fatalf("marshaling details: %v", err)
		}
		return raw
	}

	seed := func(t *testing.T, title string, sourceURL string, d json.RawMessage) activitiessvc.Activity {
		t.Helper()
		got, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
			Title: title, Category: activitiessvc.CategoryRestaurants,
			Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.0, Status: activitiessvc.StatusPublished,
			Source: "tripadvisor", SourceURL: sourceURL, Details: d,
		})
		if err != nil {
			t.Fatalf("seeding %q: %v", title, err)
		}
		return got
	}

	junkNoSignal := seed(t, "Game Centar", "http://ta/junk1", details(t, "", false, 3))
	junkFewReviews := seed(t, "Belgrade By Night", "http://ta/junk2", details(t, "", false, 0))
	legitPrice := seed(t, "Inferno Pizza", "http://ta/legit1", details(t, "$$ - $$$", false, 4))
	legitSubrating := seed(t, "Gradska Pivnica Terazije", "http://ta/legit2", details(t, "", true, 8))
	legitReviewCount := seed(t, "Aviator Coffee Explorer", "http://ta/legit3", details(t, "", false, 40))
	legitAtFloor := seed(t, "Chips & Love", "http://ta/legit4", details(t, "", false, 10))

	const deleteJunkSQL = `
DELETE FROM activities
WHERE source = 'tripadvisor'
  AND category IN ('restaurants', 'bars')
  AND COALESCE(details -> 'tripadvisor' ->> 'price_level', '') = ''
  AND details -> 'tripadvisor' -> 'subratings' IS NULL
  AND COALESCE((details -> 'tripadvisor' ->> 'review_count')::int, 0) < 10`
	if _, err := db.Exec(ctx, deleteJunkSQL); err != nil {
		t.Fatalf("running 0019's delete: %v", err)
	}

	for _, junk := range []activitiessvc.Activity{junkNoSignal, junkFewReviews} {
		if _, err := repo.GetByID(ctx, junk.ID); !errors.Is(err, sharederrors.ErrNotFound) {
			t.Errorf("junk row %q: GetByID() error = %v, want ErrNotFound", junk.Title, err)
		}
	}
	for _, legit := range []activitiessvc.Activity{legitPrice, legitSubrating, legitReviewCount, legitAtFloor} {
		if _, err := repo.GetByID(ctx, legit.ID); err != nil {
			t.Errorf("legit row %q: GetByID() error = %v, want it to survive the delete", legit.Title, err)
		} else {
			t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, legit.ID) })
		}
	}
}

// TestMigration0021DedupePreservesUniqueConstraint reproduces the exact bug
// a live rebase caught: the old per-due-category upsert loop left a real
// venue as two rows sharing one external_id/source_url but different
// categories (0017 allows that: UNIQUE is on (source_url, category), not
// source_url alone). Reassigning both rows to the classifier's single
// category before deleting the surplus one collides with that same index
// mid-migration (SQLSTATE 23505). This runs the real 0019-0021 migration
// files (not an inlined SQL copy) against a seeded duplicate pair, so a
// regression in delete-before-reclassify ordering fails this test with the
// same error a real deploy hit.
func TestMigration0021DedupePreservesUniqueConstraint(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgresPool(t)
	if err := shareddb.Migrate(ctx, db, migrationsThrough("0018_tripadvisor_subratings_phone_reviews.sql")); err != nil {
		t.Fatalf("running migrations through 0018: %v", err)
	}

	repo := New(db)
	details, err := json.Marshal(map[string]any{"tripadvisor": map[string]any{"price_level": "Mid Range"}})
	if err != nil {
		t.Fatalf("marshaling details: %v", err)
	}
	// Same venue, same external_id/source_url, two categories — exactly
	// what the pre-fix per-due-category upsert loop produced for a venue
	// due for both Restaurants and Bars.
	for _, cat := range []activitiessvc.Category{activitiessvc.CategoryRestaurants, activitiessvc.CategoryBars} {
		if _, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
			Title: "Gradska Pivnica Terazije", Category: cat,
			Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.3, Status: activitiessvc.StatusPublished,
			Source: "tripadvisor", SourceURL: "https://www.tripadvisor.com/Restaurant_Review-g1-d1-Reviews-dup1.html", ExternalID: "dup-1", Details: details,
		}); err != nil {
			t.Fatalf("seeding duplicate row (category=%s): %v", cat, err)
		}
	}

	if err := shareddb.Migrate(ctx, db, Migrations()); err != nil {
		t.Fatalf("running 0019-0021 against a seeded duplicate pair: %v", err)
	}

	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM activities WHERE external_id = 'dup-1' AND source = 'tripadvisor'`).Scan(&count); err != nil {
		t.Fatalf("counting rows: %v", err)
	}
	if count != 1 {
		t.Errorf("rows for external_id=dup-1 = %d, want exactly 1", count)
	}

	var category string
	if err := db.QueryRow(ctx, `SELECT category FROM activities WHERE external_id = 'dup-1' AND source = 'tripadvisor'`).Scan(&category); err != nil {
		t.Fatalf("reading surviving row's category: %v", err)
	}
	if category != "bars" {
		t.Errorf("category = %q, want bars ('Gradska Pivnica Terazije' matches the pivnica keyword)", category)
	}

	// Idempotency: re-running 0021's own SQL against the now-deduped table
	// (the migration runner never does this itself — filename already
	// recorded in schema_migrations — but a fixed-up deploy that re-applies
	// the file by hand must not error or resurrect a second row).
	raw, err := fs.ReadFile(Migrations(), "0021_dedupe_tripadvisor_venues.sql")
	if err != nil {
		t.Fatalf("reading 0021's SQL: %v", err)
	}
	if _, err := db.Exec(ctx, string(raw)); err != nil {
		t.Fatalf("re-running 0021 against an already-deduped table: %v", err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM activities WHERE external_id = 'dup-1' AND source = 'tripadvisor'`).Scan(&count); err != nil {
		t.Fatalf("counting rows after re-run: %v", err)
	}
	if count != 1 {
		t.Errorf("rows for external_id=dup-1 after re-running 0021 = %d, want still exactly 1", count)
	}
}

// TestMigrationChain0019Through0022_EndToEnd exercises the real 0019-0022
// files together against a realistic pre-fix snapshot: the nine legitimate
// venues named in the classification task (mis-filed under Restaurants, as
// the old sync would do for every result Terra's non-filtering
// nearby-search returned), the four junk venues that must be gone
// (Disney Store, Spa in Hotel Moskva, Hotel Zelos, citizenM San Francisco
// Union Square), a legacy Google-sourced café row that 0022 must remove,
// and a legacy Google-sourced row in an unrelated category that must
// survive untouched.
func TestMigrationChain0019Through0022_EndToEnd(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgresPool(t)
	if err := shareddb.Migrate(ctx, db, migrationsThrough("0018_tripadvisor_subratings_phone_reviews.sql")); err != nil {
		t.Fatalf("running migrations through 0018: %v", err)
	}
	repo := New(db)

	// Every seeded row carries a review_count >= 10 in its details JSON so it
	// survives 0019's still-shipped, unmodified rule (price_level/
	// subratings/review-count-floor) unchanged — exactly the real-world
	// state the coordinator found (0019 already ran on deployed databases
	// and left these rows behind); 0020's web_url-based Restaurant_Review
	// gate is what actually separates legit venues from junk here.
	seedDetails, err := json.Marshal(map[string]any{"tripadvisor": map[string]any{"review_count": 50}})
	if err != nil {
		t.Fatalf("marshaling seed details: %v", err)
	}
	seedTA := func(t *testing.T, title, externalID, webURL string) activitiessvc.Activity {
		t.Helper()
		got, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
			Title: title, Category: activitiessvc.CategoryRestaurants, // pre-fix: everything landed here first
			Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.3, Status: activitiessvc.StatusPublished,
			Source: "tripadvisor", SourceURL: webURL, ExternalID: externalID, Details: seedDetails,
		})
		if err != nil {
			t.Fatalf("seeding %q: %v", title, err)
		}
		return got
	}

	legit := map[string]activitiessvc.Activity{}
	for i, v := range []struct{ title, wantCategory string }{
		{"Gradska Pivnica Terazije", "bars"},
		{"Aviator Coffee Explorer", "cafes"},
		{"Inferno Pizza", "restaurants"},
		{"John's Grill", "restaurants"},
		{"Tad's Steakhouse", "restaurants"},
		{"Chips & Love", "restaurants"},
		{"Mashallah Halal Pakistani Food Restaurant", "restaurants"},
		{"O' By Claude Le Tohic", "restaurants"},
		{"Bodega SF", "restaurants"},
	} {
		webURL := fmt.Sprintf("https://www.tripadvisor.com/Restaurant_Review-g1-d%d-Reviews-x.html", i)
		legit[v.title] = seedTA(t, v.title, fmt.Sprintf("legit-%d", i), webURL)
	}

	junk := map[string]activitiessvc.Activity{
		"Disney Store":                        seedTA(t, "Disney Store", "junk-0", "https://www.tripadvisor.com/Attraction_Review-g1-d100-Reviews-Disney_Store.html"),
		"Spa in Hotel Moskva":                 seedTA(t, "Spa in Hotel Moskva", "junk-1", "https://www.tripadvisor.com/Attraction_Review-g1-d101-Reviews-Spa.html"),
		"Hotel Zelos":                         seedTA(t, "Hotel Zelos", "junk-2", "https://www.tripadvisor.com/Hotel_Review-g1-d102-Reviews-Hotel_Zelos.html"),
		"citizenM San Francisco Union Square": seedTA(t, "citizenM San Francisco Union Square", "junk-3", "https://www.tripadvisor.com/Hotel_Review-g1-d103-Reviews-citizenM.html"),
	}

	// ExternalID set on both: this test exercises 0022's category scoping,
	// not 0025's external_id predicate, and real Google-sourced rows always
	// carry a place id — a fixture without one would spuriously trip 0025
	// (which now also runs as part of Migrations()) and mask what this test
	// actually checks.
	legacyGoogleCafe, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "Legacy Google Cafe", Category: activitiessvc.CategoryCafes,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.0, Status: activitiessvc.StatusPending,
		Source: "google_places", SourceURL: "http://google/cafe1", ExternalID: "legacy-google-cafe-1",
	})
	if err != nil {
		t.Fatalf("seeding legacy google cafe: %v", err)
	}
	legacyGoogleOther, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "Legacy Google Park", Category: activitiessvc.CategoryNature,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.0, Status: activitiessvc.StatusPending,
		Source: "google_places", SourceURL: "http://google/park1", ExternalID: "legacy-google-park-1",
	})
	if err != nil {
		t.Fatalf("seeding legacy google other-category row: %v", err)
	}

	// The pre-existing schema seed data (0002/0008) already has its own
	// demo Google-sourced cafés — 0022 removes those too, same as 0016
	// already does for demo restaurants/bars, so the count only drops. The
	// specific-row checks below (legacyGoogleCafe gone, Aviator Coffee
	// Explorer present as cafes) are what actually proves 0022 is scoped
	// correctly, not this count.
	var cafesBefore int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM activities WHERE category = 'cafes'`).Scan(&cafesBefore); err != nil {
		t.Fatalf("counting cafes before: %v", err)
	}

	if err := shareddb.Migrate(ctx, db, Migrations()); err != nil {
		t.Fatalf("running 0019-0022: %v", err)
	}

	var cafesAfter int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM activities WHERE category = 'cafes'`).Scan(&cafesAfter); err != nil {
		t.Fatalf("counting cafes after: %v", err)
	}
	t.Logf("cafés before migrating: %d, after: %d", cafesBefore, cafesAfter)
	if cafesAfter >= cafesBefore {
		t.Errorf("cafes after migrating = %d, want fewer than before (%d) — 0022 must have removed at least the legacy Google row", cafesAfter, cafesBefore)
	}

	if _, err := repo.GetByID(ctx, legacyGoogleCafe.ID); !errors.Is(err, sharederrors.ErrNotFound) {
		t.Errorf("Legacy Google Cafe: GetByID() error = %v, want ErrNotFound (0022)", err)
	}
	if _, err := repo.GetByID(ctx, legacyGoogleOther.ID); err != nil {
		t.Errorf("Legacy Google Park: GetByID() error = %v, want it to survive (0022 only scopes category=cafes)", err)
	} else {
		t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, legacyGoogleOther.ID) })
	}

	for name, row := range junk {
		if _, err := repo.GetByID(ctx, row.ID); !errors.Is(err, sharederrors.ErrNotFound) {
			t.Errorf("junk venue %q: GetByID() error = %v, want ErrNotFound (0020)", name, err)
		}
	}

	wantCategory := map[string]string{
		"Gradska Pivnica Terazije": "bars", "Aviator Coffee Explorer": "cafes",
		"Inferno Pizza": "restaurants", "John's Grill": "restaurants", "Tad's Steakhouse": "restaurants",
		"Chips & Love": "restaurants", "Mashallah Halal Pakistani Food Restaurant": "restaurants",
		"O' By Claude Le Tohic": "restaurants", "Bodega SF": "restaurants",
	}
	for title, row := range legit {
		got, err := repo.GetByID(ctx, row.ID)
		if err != nil {
			t.Errorf("legit venue %q: GetByID() error = %v, want it to survive", title, err)
			continue
		}
		t.Cleanup(func(id string) func() {
			return func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, id) }
		}(row.ID))
		if string(got.Category) != wantCategory[title] {
			t.Errorf("legit venue %q: Category = %q, want %q", title, got.Category, wantCategory[title])
		}
	}
}

// TestMigration0023ClearsGooglePlacesDetailsOnly proves T4's compliance fix:
// only source='google_places' rows get their details wiped to '{}'. A
// Tripadvisor-sourced row (Cafes/Restaurants/Bars can legitimately carry
// that source, per 0016/0022) and an admin-created row (Create never sets
// source, so it's NULL) must both keep their stored details untouched — the
// positive predicate, not IS DISTINCT FROM 'tripadvisor'.
func TestMigration0023ClearsGooglePlacesDetailsOnly(t *testing.T) {
	ctx := context.Background()
	db := startTestPostgresPool(t)
	if err := shareddb.Migrate(ctx, db, migrationsThrough("0022_delete_legacy_cafes.sql")); err != nil {
		t.Fatalf("running migrations through 0022: %v", err)
	}
	repo := New(db)

	// ExternalID set: this test exercises 0023's source scoping, not 0025's
	// external_id predicate, and real Google-sourced rows always carry a
	// place id — a fixture without one would spuriously trip 0025 (which now
	// also runs as part of Migrations()) before 0023 gets a chance to act.
	googleRow, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "Ada Ciganlija Beach", Category: activitiessvc.CategoryNature,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.5, Status: activitiessvc.StatusPublished,
		Source: "google_places", SourceURL: "http://google/ada-ciganlija", ExternalID: "ada-ciganlija-beach",
		Details: json.RawMessage(`{"hours":"9-5","amenities":["parking"]}`),
	})
	if err != nil {
		t.Fatalf("seeding google_places row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, googleRow.ID) })

	tripadvisorRow, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title: "Koffein Tripadvisor Cafe", Category: activitiessvc.CategoryCafes,
		Lat: 44.8, Lng: 20.4, Country: "Serbia", Rating: 4.5, Status: activitiessvc.StatusPublished,
		Source: "tripadvisor", SourceURL: "https://www.tripadvisor.com/Restaurant_Review-g1-d999-Reviews-x.html",
		Details: json.RawMessage(`{"tripadvisor":{"price_level":"Mid Range"}}`),
	})
	if err != nil {
		t.Fatalf("seeding tripadvisor row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, tripadvisorRow.ID) })

	adminRow, err := repo.Create(ctx, activitiessvc.NewActivity{
		Title: "Admin Hand-Created Sport Venue", Category: activitiessvc.CategorySport, Status: activitiessvc.StatusDraft,
		Details: json.RawMessage(`{"difficulty":3}`),
	})
	if err != nil {
		t.Fatalf("seeding admin (empty-source) row: %v", err)
	}
	t.Cleanup(func() { db.Exec(context.Background(), `DELETE FROM activities WHERE id = $1`, adminRow.ID) })

	if err := shareddb.Migrate(ctx, db, Migrations()); err != nil {
		t.Fatalf("running 0023: %v", err)
	}

	got, err := repo.GetByID(ctx, googleRow.ID)
	if err != nil {
		t.Fatalf("GetByID(google_places row): %v", err)
	}
	if string(got.Details) != "{}" {
		t.Errorf("google_places row details = %s, want cleared to {}", got.Details)
	}

	got, err = repo.GetByID(ctx, tripadvisorRow.ID)
	if err != nil {
		t.Fatalf("GetByID(tripadvisor row): %v", err)
	}
	if string(got.Details) == "{}" {
		t.Errorf("tripadvisor row details = %s, want untouched (0023 must not clear non-google_places rows)", got.Details)
	}

	got, err = repo.GetByID(ctx, adminRow.ID)
	if err != nil {
		t.Fatalf("GetByID(admin row): %v", err)
	}
	if string(got.Details) == "{}" {
		t.Errorf("admin (empty-source) row details = %s, want untouched", got.Details)
	}
}
