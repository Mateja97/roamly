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
	"strings"
	"time"

	"activities-service/internal/googlephotos"
	"activities-service/internal/photo"
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

// rowStatus is the lifecycle status plus any flag tags an imported row
// should carry, keyed only off how many photos it ended up with.
type rowStatus struct {
	status activitiessvc.Status
	tags   []string
}

// statusAndTags: everything lands pending; <3 photos gets the needs-photos
// flag so a maintainer can find and backfill it later.
func statusAndTags(photoCount int) rowStatus {
	rs := rowStatus{status: activitiessvc.StatusPending}
	if photoCount < minPhotos {
		rs.tags = append(rs.tags, "needs-photos")
	}
	return rs
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
		Source:      "firecrawl",
		SourceURL:   r.SourceURL,
		Raw:         r.Raw,
	})
	if err != nil {
		return "", fmt.Errorf("upserting %q: %w", r.SourceURL, err)
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
// the existing row already has enough (cheap re-runs), else downloads
// r.PhotoURLs, backfills a single Google Places photo when still short, and
// persists whatever was collected.
//
// googlephotos.FirstPhoto resolves the single best photo for a text query —
// calling it again for the same query would just return the same photo, not
// a new one — so backfill is a single best-effort attempt, not a loop; a row
// still short after that stays flagged needs-photos rather than padded with
// duplicate photos.
func ensurePhotos(ctx context.Context, repo *repository.Activities, store *photo.Store, client *http.Client, googleKey, id string, r inputRow) (rowStatus, error) {
	existing, err := repo.GetByID(ctx, id)
	if err != nil {
		return rowStatus{}, fmt.Errorf("loading activity %s: %w", id, err)
	}
	if len(existing.Photos) >= minPhotos {
		return statusAndTags(len(existing.Photos)), nil
	}

	photos := existing.Photos
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
		photos = append(photos, activitiessvc.Photo{URL: url, ThumbURL: thumbURL})
	}

	if len(photos) < minPhotos && googleKey != "" {
		query := r.Title + ", " + r.City + ", " + r.Country
		if p, err := googlephotos.FirstPhoto(ctx, client, googleKey, query); err != nil {
			slog.Warn("google photo backfill found nothing", "title", r.Title, "error", err)
		} else {
			photos = append(photos, p)
		}
	}

	rs := statusAndTags(len(photos))
	if _, err := repo.Update(ctx, id, activitiessvc.UpdatePatch{Photos: &photos, Status: &rs.status}); err != nil {
		return rowStatus{}, fmt.Errorf("updating photos for %s: %w", id, err)
	}
	return rs, nil
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
	googleKey := os.Getenv("GOOGLE_MAPS_API_KEY")

	imported := 0
	flaggedNeedsPhotos := 0
	for _, r := range valid {
		id, err := importRow(ctx, repo, r)
		if err != nil {
			logger.Warn("skipping row on import failure", "title", r.Title, "error", err)
			skippedInvalid++
			continue
		}
		imported++

		rs, err := ensurePhotos(ctx, repo, store, httpClient, googleKey, id, r)
		if err != nil {
			logger.Warn("photo pipeline failed", "title", r.Title, "id", id, "error", err)
			continue
		}
		if len(rs.tags) > 0 {
			flaggedNeedsPhotos++
			// rs.tags is not persisted: UpdatePatch has no Tags field (see
			// task-5-report.md) — logging is the only durable record today.
			logger.Warn("activity flagged needs-photos", "title", r.Title, "id", id, "tags", rs.tags)
		}
	}

	logger.Info("import complete", "imported", imported, "skipped_invalid", skippedInvalid, "flagged_needs_photos", flaggedNeedsPhotos)
}
