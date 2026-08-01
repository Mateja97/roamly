package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"backend/shared/models/activitiessvc"
)

// websiteSyncProvider is this job's key into the shared sync_regions
// freshness table (see repository.SyncedAt/MarkSynced) — cell_key is the
// activity's own ID rather than a geographic cell, subtype unused ("").
// sync_regions' own migration (0024_sync_regions.sql) exists exactly for
// this: "the provider column is the seam a tours provider drops into
// later... no schema change."
const websiteSyncProvider = "website"

// websiteSyncFreshness bounds how often a venue's website gets re-scraped —
// weekly, per the design spec's cadence decision (show listings go stale
// fastest; treatments/good-to-know rarely change).
const websiteSyncFreshness = 7 * 24 * time.Hour

// websiteResolveTimeout bounds the one live Places call this job makes per
// venue to resolve the website URL — same reasoning as detailResolveTimeout,
// just not on a request path so it can afford to be a little longer.
const websiteResolveTimeout = 8 * time.Second

// firecrawlTimeout bounds the scrape+extract call itself.
const firecrawlTimeout = 45 * time.Second

// extractionPrompt/extractionSchema differ per category — wellnessSchema and
// entertainmentSchema below, chosen by the row's own Category.
var wellnessPrompt = "Extract this wellness/spa venue's treatments menu (name, duration, price), a short list of practical good-to-know notes for visitors, the typical length of a visit, and the starting price of its cheapest offering."

var wellnessSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"treatments": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item":     map[string]any{"type": "string"},
					"duration": map[string]any{"type": "string"},
					"price":    map[string]any{"type": "string"},
				},
			},
		},
		"good_to_know":  map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"typical_visit": map[string]any{"type": "string"},
		"price_from":    map[string]any{"type": "string"},
	},
}

var entertainmentPrompt = "Extract this venue's upcoming shows/events (date, title, time or price), a short list of practical good-to-know notes for visitors, the typical length of a show, and the starting ticket price."

var entertainmentSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"upcoming_shows": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"date":          map[string]any{"type": "string"},
					"title":         map[string]any{"type": "string"},
					"time_or_price": map[string]any{"type": "string"},
				},
			},
		},
		"good_to_know":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"typical_show_length": map[string]any{"type": "string"},
		"price_from":          map[string]any{"type": "string"},
	},
}

// SyncWebsiteContent is cmd/websitesync's one per-row call (T design spec,
// weekly job). It: skips a row synced within websiteSyncFreshness; resolves
// the venue's website live via Places (never stored — §14.3, see
// firecrawl.Client's doc); skips a row with no website; scrapes+extracts via
// Firecrawl; and writes only the fields the row doesn't already have a
// value for (fillGaps below) — an admin's own edit is never overwritten.
func (a *Activities) SyncWebsiteContent(ctx context.Context, id string) error {
	if a.places == nil || a.firecrawl == nil {
		return fmt.Errorf("places and firecrawl clients must both be configured")
	}

	activity, err := a.repo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("getting activity %s: %w", id, err)
	}

	// Mirrors withLiveDetails' guard: an admin-created row (Source == "") or
	// a Tripadvisor-sourced row has no Google place_id, so PlaceDetails below
	// would be called with an empty/foreign ExternalID on every weekly run
	// forever, guaranteed-invalid.
	if activity.Source == "" || activity.Source == "tripadvisor" || activity.ExternalID == "" {
		slog.Info("website sync skipped, no Google place id on file", "activity_id", id, "source", activity.Source)
		return nil
	}

	var prompt string
	var schema map[string]any
	switch activity.Category {
	case activitiessvc.CategoryWellness:
		prompt, schema = wellnessPrompt, wellnessSchema
	case activitiessvc.CategoryEntertainment:
		prompt, schema = entertainmentPrompt, entertainmentSchema
	default:
		// ponytail: cmd/websitesync's own List call only ever queues
		// Wellness/Entertainment ids, but SyncWebsiteContent is exported and
		// takes a bare id — nothing stops any other caller from passing a
		// row of any category directly, which would otherwise silently get
		// the wellness prompt/schema applied to it.
		slog.Info("website sync skipped, unsupported category", "activity_id", id, "category", activity.Category)
		return nil
	}

	syncedAt, ok, err := a.repo.SyncedAt(ctx, websiteSyncProvider, activity.ID, string(activity.Category), "")
	if err != nil {
		return fmt.Errorf("checking website sync freshness for %s: %w", id, err)
	}
	if ok && time.Since(syncedAt) < websiteSyncFreshness {
		slog.Info("website sync skipped, still fresh", "activity_id", id, "synced_at", syncedAt)
		return nil
	}

	resolveCtx, cancel := context.WithTimeout(ctx, websiteResolveTimeout)
	detail, err := a.places.PlaceDetails(resolveCtx, activity.ExternalID)
	cancel()
	if err != nil {
		return fmt.Errorf("resolving website for %s: %w", id, err)
	}
	if detail.WebsiteURI == "" {
		slog.Info("website sync skipped, no website on file", "activity_id", id)
		return nil
	}

	extractCtx, cancel := context.WithTimeout(ctx, firecrawlTimeout)
	extracted, err := a.firecrawl.ExtractJSON(extractCtx, detail.WebsiteURI, prompt, schema)
	cancel()
	if err != nil {
		return fmt.Errorf("extracting website content for %s: %w", id, err)
	}

	merged, err := fillGaps(activity.Details, extracted)
	if err != nil {
		return fmt.Errorf("merging website content for %s: %w", id, err)
	}

	// Firecrawl's LLM extraction is not schema-guaranteed: an unexpected key
	// or a type mismatch must never reach the DB unvalidated, or a
	// subsequent admin edit to this row would fail ValidateDetails' strict
	// decode. Skip and retry next week instead — same "nothing to do this
	// cycle" contract as the freshness/no-website checks above.
	if err := ValidateDetails(activity.Category, merged); err != nil {
		slog.Warn("website sync produced invalid details, skipping write", "activity_id", id, "error", err)
		return nil
	}

	if _, err := a.repo.Update(ctx, id, activitiessvc.UpdatePatch{Details: &merged}); err != nil {
		return fmt.Errorf("saving website content for %s: %w", id, err)
	}
	if err := a.repo.MarkSynced(ctx, websiteSyncProvider, activity.ID, string(activity.Category), ""); err != nil {
		return fmt.Errorf("marking website sync for %s: %w", id, err)
	}
	return nil
}

// fillGaps overlays extracted's keys onto stored, but only for keys stored
// doesn't already have a non-empty value for — the admin/scrape precedence
// rule: an admin edit (or a prior scrape) that already set a field is never
// clobbered by a later scrape. "Non-empty" means: present, and not a
// zero-length string/array/nil. Malformed stored JSON degrades to "nothing
// stored yet" (extracted fills every key) rather than erroring — mirrors
// mergeLiveDetails' error contract in activity.go.
func fillGaps(stored, extracted json.RawMessage) (json.RawMessage, error) {
	merged := map[string]any{}
	_ = json.Unmarshal(stored, &merged)

	var extractedFields map[string]any
	if err := json.Unmarshal(extracted, &extractedFields); err != nil {
		return nil, fmt.Errorf("decoding extracted content: %w", err)
	}

	for k, v := range extractedFields {
		if isEmptyValue(merged[k]) {
			merged[k] = v
		}
	}

	b, err := json.Marshal(merged)
	if err != nil {
		return nil, fmt.Errorf("encoding merged details: %w", err)
	}
	return b, nil
}

func isEmptyValue(v any) bool {
	switch val := v.(type) {
	case nil:
		return true
	case string:
		return val == ""
	case []any:
		return len(val) == 0
	default:
		return false
	}
}
