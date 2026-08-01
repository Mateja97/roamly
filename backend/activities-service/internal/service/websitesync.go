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

// retryFreshness bounds how soon a row that hasn't yet succeeded (no
// website on file, extraction failed, validation failed, not yet
// attempted) gets tried again — short, since these are transient failure
// states worth retrying often. Applies to every category alike.
const retryFreshness = 7 * 24 * time.Hour

// entertainmentRefreshFreshness bounds how often an already-complete
// Entertainment row gets re-scraped anyway. Entertainment is the one
// category whose scraper-owned content (upcoming_shows) genuinely goes
// stale over time — every other category is skipped permanently once
// complete (see isComplete/SyncWebsiteContent), because static content
// like a spa's treatment menu or a museum's current exhibit description
// doesn't need repeat scraping once it's been captured.
const entertainmentRefreshFreshness = 30 * 24 * time.Hour

// websiteResolveTimeout bounds the one live Places call this job makes per
// venue to resolve the website URL — same reasoning as detailResolveTimeout,
// just not on a request path so it can afford to be a little longer.
const websiteResolveTimeout = 8 * time.Second

// firecrawlTimeout bounds the scrape+extract call itself.
const firecrawlTimeout = 45 * time.Second

// extraction pairs one category's LLM prompt with the JSON schema Firecrawl
// extracts against — extractionConfig below is the one place all five
// categories' extraction targets live.
type extraction struct {
	prompt string
	schema map[string]any
}

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

var culturePrompt = "Extract this culture/heritage venue's current or upcoming exhibit, show, or program as a short title and one-paragraph description — what's showing right now, not the venue's general description."

var cultureSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"now_showing": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"title":       map[string]any{"type": "string"},
				"description": map[string]any{"type": "string"},
			},
		},
	},
}

var artPrompt = "Extract this art venue's current exhibition as a short title and one-paragraph description — what's on display right now, not the venue's general description. Do not attempt to identify a specific artist, artwork, or medium."

var artSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"current_exhibition": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"title":       map[string]any{"type": "string"},
				"description": map[string]any{"type": "string"},
			},
		},
	},
}

var sportPrompt = "Extract this sport/activity venue's typical effort level (e.g. Easy, Moderate, Intense), typical session duration, what gear or equipment is provided, a short list of what visitors should bring themselves, and your own best estimate of overall difficulty on a 1-5 scale (1 = beginner-friendly, 5 = expert only) based on how the page describes the activity's intensity or skill requirements — an estimate is expected even if the page never states a number directly."

var sportSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"effort_level":  map[string]any{"type": "string"},
		"duration":      map[string]any{"type": "string"},
		"gear":          map[string]any{"type": "string"},
		"what_to_bring": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"difficulty":    map[string]any{"type": "number"},
	},
}

// extractionConfig is the one place a category's scrape target is defined —
// adding a category is a new map entry here (plus scraperOwnedFields below),
// not a new switch branch.
var extractionConfig = map[activitiessvc.Category]extraction{
	activitiessvc.CategoryWellness:      {wellnessPrompt, wellnessSchema},
	activitiessvc.CategoryEntertainment: {entertainmentPrompt, entertainmentSchema},
	activitiessvc.CategoryCulture:       {culturePrompt, cultureSchema},
	activitiessvc.CategoryArt:           {artPrompt, artSchema},
	activitiessvc.CategorySport:         {sportPrompt, sportSchema},
}

// scraperOwnedFields lists, per category, the `details` keys this job is
// responsible for — the completeness check (isComplete) walks exactly this
// list. Deliberately excludes anything Places-sourced (venue_type,
// action_url, opening_hours) or admin-only (Art's artwork/year) — those
// aren't this job's concern either way.
var scraperOwnedFields = map[activitiessvc.Category][]string{
	activitiessvc.CategoryWellness:      {"treatments", "good_to_know", "typical_visit", "price_from"},
	activitiessvc.CategoryEntertainment: {"upcoming_shows", "good_to_know", "typical_show_length", "price_from"},
	activitiessvc.CategoryCulture:       {"now_showing"},
	activitiessvc.CategoryArt:           {"current_exhibition"},
	activitiessvc.CategorySport:         {"what_to_bring", "effort_level", "duration", "gear", "difficulty"},
}

// isComplete reports whether every one of category's scraper-owned fields
// already has a value on details — the permanent-skip signal for every
// category except Entertainment (see SyncWebsiteContent). false for a
// category with no entry in scraperOwnedFields (never complete, matches
// "unsupported category" falling through to the extractionConfig guard
// before this is ever consulted for such a category in practice). Reuses
// isEmptyValue, the same emptiness rule fillGaps itself applies.
func isComplete(category activitiessvc.Category, details json.RawMessage) bool {
	fields := scraperOwnedFields[category]
	if len(fields) == 0 {
		return false
	}
	var m map[string]any
	_ = json.Unmarshal(details, &m)
	for _, f := range fields {
		if isEmptyValue(m[f]) {
			return false
		}
	}
	return true
}

// SyncWebsiteContent is cmd/websitesync's one per-row call. For every
// category in extractionConfig: resolves the venue's website live via
// Places (never stored — §14.3, see firecrawl.Client's doc); scrapes+
// extracts via Firecrawl; and writes only the fields the row doesn't
// already have a value for (fillGaps below) — an admin's own edit is never
// overwritten. A row whose scraper-owned fields (scraperOwnedFields) are
// all already filled is skipped permanently, except Entertainment, which
// still re-checks every entertainmentRefreshFreshness because
// upcoming_shows genuinely goes stale over time.
func (a *Activities) SyncWebsiteContent(ctx context.Context, id string) error {
	if a.places == nil || a.firecrawl == nil {
		return fmt.Errorf("places and firecrawl clients must both be configured")
	}

	activity, err := a.repo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("getting activity %s: %w", id, err)
	}

	extract, supported := extractionConfig[activity.Category]
	if !supported {
		// ponytail: cmd/websitesync's own List call only ever queues rows
		// from categories present in extractionConfig, but SyncWebsiteContent
		// is exported and takes a bare id — nothing stops any other caller
		// from passing a row of any category directly.
		slog.Info("website sync skipped, unsupported category", "activity_id", id, "category", activity.Category)
		return nil
	}

	complete := isComplete(activity.Category, activity.Details)
	if complete && activity.Category != activitiessvc.CategoryEntertainment {
		// Permanently done: this category's content doesn't go stale the way
		// Entertainment's upcoming_shows does, so once every scraper-owned
		// field is filled there's nothing left to gain from ever
		// re-scraping this row — no Places call, no Firecrawl call, no
		// sync_regions bookkeeping.
		slog.Info("website sync skipped, category complete", "activity_id", id, "category", activity.Category)
		return nil
	}

	// Mirrors withLiveDetails' guard: an admin-created row (Source == "") or
	// a Tripadvisor-sourced row has no Google place_id, so PlaceDetails below
	// would be called with an empty/foreign ExternalID on every run forever,
	// guaranteed-invalid.
	if activity.Source == "" || activity.Source == "tripadvisor" || activity.ExternalID == "" {
		slog.Info("website sync skipped, no Google place id on file", "activity_id", id, "source", activity.Source)
		return nil
	}

	freshness := retryFreshness
	if complete {
		// Only reachable for Entertainment here — the permanent-skip branch
		// above already returned for every other complete category. A
		// complete show list still needs periodic refreshing, just far less
		// often than a row that hasn't succeeded at all yet.
		freshness = entertainmentRefreshFreshness
	}
	syncedAt, ok, err := a.repo.SyncedAt(ctx, websiteSyncProvider, activity.ID, string(activity.Category), "")
	if err != nil {
		return fmt.Errorf("checking website sync freshness for %s: %w", id, err)
	}
	if ok && time.Since(syncedAt) < freshness {
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
	extracted, err := a.firecrawl.ExtractJSON(extractCtx, detail.WebsiteURI, extract.prompt, extract.schema)
	cancel()
	if err != nil {
		return fmt.Errorf("extracting website content for %s: %w", id, err)
	}
	extracted = dropBlankBanner(activity.Category, extracted)

	merged, err := fillGaps(activity.Details, extracted)
	if err != nil {
		return fmt.Errorf("merging website content for %s: %w", id, err)
	}
	if complete && activity.Category == activitiessvc.CategoryEntertainment {
		merged = overwriteField(merged, extracted, "upcoming_shows")
	}
	if activity.Category == activitiessvc.CategorySport {
		merged = markDifficultyInferred(activity.Details, merged)
	}

	// Firecrawl's LLM extraction is not schema-guaranteed: an unexpected key
	// or a type mismatch must never reach the DB unvalidated, or a
	// subsequent admin edit to this row would fail ValidateDetails' strict
	// decode. Skip and retry next cycle instead — same "nothing to do this
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

// overwriteField replaces key on merged with its value from extracted, when
// extracted actually has a non-empty one — used only for Entertainment's
// periodic refresh (see SyncWebsiteContent), where upcoming_shows must
// actually update even though fillGaps' fill-only-if-empty rule would
// otherwise leave the old (already non-empty) list in place forever. Every
// other scraper-owned field keeps fillGaps' normal admin-precedence rule.
func overwriteField(merged, extracted json.RawMessage, key string) json.RawMessage {
	var extractedFields map[string]any
	if err := json.Unmarshal(extracted, &extractedFields); err != nil {
		return merged
	}
	newVal, ok := extractedFields[key]
	if !ok || isEmptyValue(newVal) {
		return merged // nothing fresh to overwrite with
	}
	var m map[string]any
	if err := json.Unmarshal(merged, &m); err != nil {
		return merged
	}
	m[key] = newVal
	b, err := json.Marshal(m)
	if err != nil {
		return merged
	}
	return b
}

// dropBlankBanner strips now_showing/current_exhibition from extracted when
// Firecrawl returned a blank title — an empty banner is indistinguishable
// from "found nothing" and must not count as a filled value, or a single
// bad extraction would permanently lock the row via isComplete (Culture/Art
// each have exactly one scraper-owned field). No-op for every other
// category. isEmptyValue itself is deliberately not changed to handle this
// — filtering happens here, before the merge, not by teaching isEmptyValue
// a new case.
func dropBlankBanner(category activitiessvc.Category, extracted json.RawMessage) json.RawMessage {
	var key string
	switch category {
	case activitiessvc.CategoryCulture:
		key = "now_showing"
	case activitiessvc.CategoryArt:
		key = "current_exhibition"
	default:
		return extracted
	}
	var m map[string]any
	if err := json.Unmarshal(extracted, &m); err != nil {
		return extracted
	}
	banner, ok := m[key].(map[string]any)
	if !ok {
		return extracted
	}
	title, _ := banner["title"].(string)
	if title != "" {
		return extracted
	}
	delete(m, key)
	b, err := json.Marshal(m)
	if err != nil {
		return extracted
	}
	return b
}

// markDifficultyInferred sets difficulty_inferred:true on merged when this
// sync is what filled a previously-empty difficulty — our own merge knows
// authoritatively that any value it just wrote came from a scrape, which is
// more reliable than trusting Firecrawl's schema to self-report confidence.
// A previously non-empty (admin-set, or already-scraped) difficulty is left
// completely untouched by fillGaps' own precedence rule before this ever
// runs — this only marks a fresh fill, never re-marks or clears an existing
// value or flag.
func markDifficultyInferred(stored, merged json.RawMessage) json.RawMessage {
	var before map[string]any
	_ = json.Unmarshal(stored, &before)
	if !isEmptyValue(before["difficulty"]) {
		return merged
	}
	var after map[string]any
	if err := json.Unmarshal(merged, &after); err != nil {
		return merged
	}
	if isEmptyValue(after["difficulty"]) {
		return merged
	}
	after["difficulty_inferred"] = true
	b, err := json.Marshal(after)
	if err != nil {
		return merged
	}
	return b
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
