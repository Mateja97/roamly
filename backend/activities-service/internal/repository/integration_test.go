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
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"activities-service/internal/service"
	shareddb "backend/shared/db"
	sharederrors "backend/shared/errors"
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
