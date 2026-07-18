// Command importcity loads a Stage-A <city>.json into the live activities DB
// as status=pending, guaranteeing >=3 photos per activity (downloaded to the
// photo volume, Google-backfilled when short). Build/seed-time maintenance
// tool; not wired into service startup. Requires DATABASE_URL, PHOTOS_DIR,
// and (for backfill) GOOGLE_MAPS_API_KEY.
//
// Usage: go run ./cmd/importcity [-dry-run] path/to/city.json
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"activities-service/internal/photo"
	"activities-service/internal/places"
	"activities-service/internal/repository"

	"backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/models/activitiessvc"
)

const minPhotos = 3

// inputRow is one Stage-A row: a scraped/geocoded activity, ready for
// validation and ingestion (see cmd/importcity's Stage-A contract, Task 6).
type inputRow struct {
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	Lat         float64         `json:"lat"`
	Lng         float64         `json:"lng"`
	Country     string          `json:"country"`
	City        string          `json:"city"`
	Address     string          `json:"address"`
	Rating      float64         `json:"rating"`
	Details     json.RawMessage `json:"details"`
	PhotoURLs   []string        `json:"photo_urls"`
	SourceURL   string          `json:"source_url"`
	PlaceID     string          `json:"place_id"`
	Raw         json.RawMessage `json:"raw"`
}

// validateRow enforces the Stage-A contract's required fields.
func validateRow(r inputRow) error {
	if strings.TrimSpace(r.Title) == "" {
		return fmt.Errorf("missing title")
	}
	if !activitiessvc.Category(r.Category).Valid() {
		return fmt.Errorf("invalid category %q", r.Category)
	}
	if r.Lat == 0 && r.Lng == 0 {
		return fmt.Errorf("missing coordinates")
	}
	if strings.TrimSpace(r.SourceURL) == "" {
		return fmt.Errorf("missing source_url")
	}
	return nil
}

// statusAndTags: <3 photos gets the needs-photos flag so a maintainer can
// find and backfill it later.
func statusAndTags(photoCount int) []string {
	var tags []string
	if photoCount < minPhotos {
		tags = append(tags, "needs-photos")
	}
	return tags
}

// importRow maps r onto an IngestActivity and upserts it (keyed on
// source_url, so re-running the same city.json is idempotent), returning
// the row's id.
func importRow(ctx context.Context, repo *repository.Activities, r inputRow) (string, error) {
	a, err := repo.Upsert(ctx, activitiessvc.IngestActivity{
		Title:       r.Title,
		Description: r.Description,
		Category:    activitiessvc.Category(r.Category),
		Lat:         r.Lat,
		Lng:         r.Lng,
		Country:     r.Country,
		City:        r.City,
		Address:     r.Address,
		Rating:      r.Rating,
		Status:      activitiessvc.StatusPending,
		Details:     r.Details,
		Source:      "google_places",
		SourceURL:   r.SourceURL,
		ExternalID:  r.PlaceID,
		Raw:         r.Raw,
	})
	if err != nil {
		return "", fmt.Errorf("importing row %q: %w", r.SourceURL, err)
	}
	return a.ID, nil
}

// download GETs url and returns its body bytes. Any transport error or
// non-2xx status is returned for the caller to skip and move on — one bad
// photo URL must never abort the batch.
func download(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("fetching %s: status %d", url, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// ensurePhotos guarantees id has >=minPhotos photos: it skips entirely when
// the existing row already has enough (cheap re-runs, but still clears a
// stale needs-photos tag if one was left over from a prior short run), else
// backfills a single Google Places photo when still short, and persists
// whatever was collected.
//
// The scraped-URL download loop only runs when the row has zero existing
// photos. store.Save mints a fresh filename on every call, so re-running it
// against a row that already has 1-2 photos (the needs-photos population an
// operator re-imports to fix) would re-download and re-append every
// r.PhotoURLs on top of what's already stored, duplicating them.
//
// Every append (scraped download or Google backfill) goes through
// appendPhoto, which is a no-op if the URL is already present. That makes
// the backfill path idempotent too: places.Client.FirstPhoto deterministically
// resolves the same photo for the same query, and `photos` starts seeded
// from existing.Photos, so without the dedupe a re-run would re-append the
// prior run's backfilled URL every time. The Google backfill still runs on
// every re-run while the row is short — an operator who adds
// GOOGLE_MAPS_API_KEY after the fact and re-imports a 1-2-photo row still
// gets topped up, just never with a duplicate.
func ensurePhotos(ctx context.Context, repo *repository.Activities, store *photo.Store, client *http.Client, backfill func(context.Context, string) (activitiessvc.Photo, error), id string, r inputRow) ([]string, error) {
	existing, err := repo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("loading activity %s: %w", id, err)
	}
	if len(existing.Photos) >= minPhotos {
		tags := statusAndTags(len(existing.Photos))
		if slices.Contains(existing.Tags, "needs-photos") {
			if _, err := repo.Update(ctx, id, activitiessvc.UpdatePatch{Tags: &tags}); err != nil {
				return nil, fmt.Errorf("clearing stale needs-photos tag for %s: %w", id, err)
			}
		}
		return tags, nil
	}

	photos := existing.Photos
	seen := make(map[string]bool, len(photos))
	for _, p := range photos {
		seen[p.URL] = true
	}
	appendPhoto := func(p activitiessvc.Photo) {
		if seen[p.URL] {
			return
		}
		seen[p.URL] = true
		photos = append(photos, p)
	}

	if len(existing.Photos) == 0 {
		for _, u := range r.PhotoURLs {
			data, err := download(ctx, client, u)
			if err != nil {
				slog.Warn("skipping photo download failure", "url", u, "error", err)
				continue
			}
			url, thumbURL, err := store.Save(id, data)
			if err != nil {
				slog.Warn("skipping unsaveable photo", "url", u, "error", err)
				continue
			}
			appendPhoto(activitiessvc.Photo{URL: url, ThumbURL: thumbURL})
		}
	}

	if len(photos) < minPhotos && backfill != nil {
		query := r.Title + ", " + r.City + ", " + r.Country
		if p, err := backfill(ctx, query); err != nil {
			slog.Warn("google photo backfill found nothing", "title", r.Title, "error", err)
		} else {
			appendPhoto(p)
		}
	}

	// Status is deliberately excluded from this patch: it's set correctly at
	// insert time by Upsert and must never be overwritten by a re-import,
	// same reasoning as Upsert's DO UPDATE excluding status (an admin may
	// have since published this row).
	tags := statusAndTags(len(photos))
	if _, err := repo.Update(ctx, id, activitiessvc.UpdatePatch{Photos: &photos, Tags: &tags}); err != nil {
		return nil, fmt.Errorf("updating photos for %s: %w", id, err)
	}
	return tags, nil
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	dryRun := flag.Bool("dry-run", false, "parse and validate only; no DB or photo writes")
	flag.Parse()
	if flag.NArg() < 1 {
		logger.Error("usage: importcity [-dry-run] path/to/city.json")
		os.Exit(1)
	}

	b, err := os.ReadFile(flag.Arg(0))
	if err != nil {
		logger.Error("reading input file", "error", err)
		os.Exit(1)
	}
	var rows []inputRow
	if err := json.Unmarshal(b, &rows); err != nil {
		logger.Error("parsing input json", "error", err)
		os.Exit(1)
	}

	var valid []inputRow
	skippedInvalid := 0
	for _, r := range rows {
		if err := validateRow(r); err != nil {
			logger.Warn("skipping invalid row", "title", r.Title, "error", err)
			skippedInvalid++
			continue
		}
		valid = append(valid, r)
	}

	if *dryRun {
		logger.Info("dry run complete", "total", len(rows), "valid", len(valid), "skipped_invalid", skippedInvalid)
		return
	}

	ctx := context.Background()
	dsn, err := config.Require("DATABASE_URL")
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	pool, err := shareddb.Connect(ctx, dsn)
	if err != nil {
		logger.Error("connecting to db", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	repo := repository.New(pool)
	store := photo.NewStore(config.OrDefault("PHOTOS_DIR", "/data/photos"))
	httpClient := &http.Client{Timeout: 15 * time.Second}
	var backfill func(context.Context, string) (activitiessvc.Photo, error)
	// ponytail: backfill is opt-in (no GOOGLE_MAPS_API_KEY means no backfill,
	// not a startup failure), so NewFromEnv's error is logged and swallowed
	// rather than exiting like resolvephotos does.
	if placesClient, err := places.NewFromEnv(); err != nil {
		logger.Warn("google photo backfill disabled", "error", err)
	} else {
		backfill = placesClient.FirstPhoto
	}

	imported := 0
	failedImport := 0
	flaggedNeedsPhotos := 0
	for _, r := range valid {
		id, err := importRow(ctx, repo, r)
		if err != nil {
			logger.Warn("skipping row on import failure", "title", r.Title, "error", err)
			failedImport++
			continue
		}
		imported++

		tags, err := ensurePhotos(ctx, repo, store, httpClient, backfill, id, r)
		if err != nil {
			logger.Warn("photo pipeline failed", "title", r.Title, "id", id, "error", err)
			continue
		}
		if len(tags) > 0 {
			flaggedNeedsPhotos++
			logger.Warn("activity flagged needs-photos", "title", r.Title, "id", id, "tags", tags)
		}
	}

	logger.Info("import complete", "imported", imported, "skipped_invalid", skippedInvalid, "failed_import", failedImport, "flagged_needs_photos", flaggedNeedsPhotos)
}
