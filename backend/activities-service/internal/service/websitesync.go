package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
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

// entertainmentRefreshFreshness bounds how often an Entertainment row gets
// re-scraped — complete or not. Entertainment is the one category whose
// scraper-owned content (upcoming_shows) genuinely goes stale over time, so
// unlike every other category it keeps a periodic re-scan indefinitely
// rather than giving up after one incomplete attempt (see SyncWebsiteContent).
// Every other category is skipped permanently once complete (isComplete),
// because static content like a spa's treatment menu or a museum's current
// exhibit description doesn't need repeat scraping once it's been captured.
const entertainmentRefreshFreshness = 30 * 24 * time.Hour

// nightlifeRefreshFreshness is Nightlife's own, much shorter window. Its
// `lineup` renders under a "Tonight" heading, so a value even a few days
// old is not merely stale but wrong — it names last weekend's act as
// tonight's. Daily is the longest cadence that keeps that heading honest,
// and it is the reason Nightlife is the most expensive category in this job
// by an order of magnitude: 865 published rows re-scraped daily, against
// Entertainment's 551 monthly.
const nightlifeRefreshFreshness = 24 * time.Hour

// websiteResolveTimeout bounds the one live Places call this job makes per
// venue to resolve the website URL — same reasoning as detailResolveTimeout,
// just not on a request path so it can afford to be a little longer.
const websiteResolveTimeout = 8 * time.Second

// firecrawlTimeout bounds the scrape+extract call itself.
const firecrawlTimeout = 45 * time.Second

// extraction pairs one category's LLM prompt with the JSON schema Firecrawl
// extracts against — extractionConfig below is the one place every
// supported category's extraction target lives.
type extraction struct {
	prompt string
	schema map[string]any
}

// ponytail: the spec's language rule has two halves. The render-language
// half is trivial here — app/src has zero i18n (no i18n/intl/locale dep in
// app/package.json, zero locale/Localization/i18n hits), every label is a
// hardcoded English literal, so the target language is the fixed constant
// "English", not per-venue infra that needs building — both prompts below
// now instruct the model to answer in English. What's still NOT implemented
// is the *validator*-side half: T1's contentkind package has no
// confidently-wrong-language check, so a value that ignores the prompt's
// instruction and answers in another language isn't rejected server-side.
// That check is a real language-detection dependency this task's scope (a
// prompt-wording fix) doesn't justify adding — add it if this class of
// failure recurs after the prompt fix ships. Recorded as a follow-up in
// engineering-notes.md.

// wellnessPrompt (T2, activity-detail-system, rewritten again in T1 of
// detail-price-duration-purge): originally asked for treatment duration,
// treatment price, typical_visit, and price_from too — all four were LLM
// extractions of a scraped page with no way to verify them against the
// venue's own site (the same extraction surface once produced a wrong
// massage duration), so this task stops asking for and collecting them
// entirely. Only the treatment name and good_to_know survive; good_to_know
// stays explicitly venue-specific (never generic category boilerplate, the
// original spec's other reported failure: sport-equipment text on a spa
// page). T1's contentkind.MatchesDenylist guard on the write path still
// catches whatever slips past this wording — this is the generation-time
// half of the defense-in-depth, not a replacement for it.
var wellnessPrompt = "Extract this wellness/spa venue's treatments menu (name only). Answer in English throughout, regardless of the page's own language. " +
	"For good_to_know, list only practical facts specific to this venue, drawn from its own page — never generic advice about this category of venue in general (for example, do not mention typical spa/wellness equipment unless this page specifically describes it). Each item must be a short phrase of 80 characters or fewer with no trailing period."

var wellnessSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"treatments": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item": map[string]any{"type": "string"},
				},
			},
		},
		"good_to_know": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
	},
}

// entertainmentPrompt (T2, activity-detail-system, rewritten again in T1 of
// detail-price-duration-purge): same reason as wellnessPrompt above —
// time_or_price, typical_show_length, and price_from are dropped entirely
// (unverifiable scraped price/duration), leaving only date/title per show
// plus venue-specific good_to_know.
var entertainmentPrompt = "Extract this venue's upcoming shows/events (date, title). Answer in English throughout, regardless of the page's own language. " +
	"For good_to_know, list only practical facts specific to this venue, drawn from its own page — never generic advice about this category of venue in general. Each item must be a short phrase of 80 characters or fewer with no trailing period."

var entertainmentSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"upcoming_shows": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"date":  map[string]any{"type": "string"},
					"title": map[string]any{"type": "string"},
				},
			},
		},
		"good_to_know": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
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

var sportPrompt = "Extract this sport/activity venue's typical effort level (e.g. Easy, Moderate, Intense), what gear or equipment is provided, a short list of what visitors should bring themselves, and your own best estimate of overall difficulty on a 1-5 scale (1 = beginner-friendly, 5 = expert only) based on how the page describes the activity's intensity or skill requirements — an estimate is expected even if the page never states a number directly."

var sportSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"effort_level":  map[string]any{"type": "string"},
		"gear":          map[string]any{"type": "string"},
		"what_to_bring": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"difficulty":    map[string]any{"type": "integer", "minimum": 1, "maximum": 5},
	},
}

var shoppingPrompt = "Answer in English throughout, regardless of the page's own language. Extract a short list of the kinds of goods, departments, or product categories a visitor will find at this shop or market — for example 'Local honey and preserves', 'Vintage vinyl', 'Handmade ceramics'. Describe what is actually sold, not the venue's marketing copy, and never invent brands or prices."

var shoppingSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"what_youll_find": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
	},
}

var nightlifePrompt = "Answer in English throughout, regardless of the page's own language. Extract this nightlife venue's upcoming lineup as a list of entries, each with the act or event name, its start time if stated, and the room or stage if the venue has more than one. Only include entries the page presents as scheduled events with a date or time — never the venue's general music policy or resident-DJ blurb."

var nightlifeSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"lineup": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"time":  map[string]any{"type": "string"},
					"act":   map[string]any{"type": "string"},
					"stage": map[string]any{"type": "string"},
				},
			},
		},
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
	activitiessvc.CategoryShopping:      {shoppingPrompt, shoppingSchema},
	activitiessvc.CategoryNightlife:     {nightlifePrompt, nightlifeSchema},
}

// perishableFields names, per category, the scraper-owned field whose value
// goes stale on its own — a show listing or a club lineup describes a date,
// not the venue. Membership has three consequences, all of which used to be
// hardcoded `== CategoryEntertainment` checks: the row is never permanently
// skipped once complete, it keeps a periodic re-scan, and the named field is
// overwritten on each pass rather than gap-filled, so a stale value is
// replaced instead of preserved forever.
//
// Nightlife's `lineup` renders under a "Tonight" heading in the app, which
// is a stronger freshness claim than this job can honour on any batch
// cadence — see nightlifeRefreshFreshness.
var perishableFields = map[activitiessvc.Category]string{
	activitiessvc.CategoryEntertainment: "upcoming_shows",
	activitiessvc.CategoryNightlife:     "lineup",
}

// refreshFreshness returns how long a perishable category's stored value
// stays usable before a re-scan. Entertainment's month-out show listings
// tolerate 30 days; a club lineup does not, so Nightlife re-scans daily.
// A non-perishable category never reaches this.
func refreshFreshness(category activitiessvc.Category) time.Duration {
	if category == activitiessvc.CategoryNightlife {
		return nightlifeRefreshFreshness
	}
	return entertainmentRefreshFreshness
}

// scraperOwnedFields lists, per category, the `details` keys this job is
// responsible for — the completeness check (isComplete) walks exactly this
// list. Deliberately excludes anything Places-sourced (venue_type,
// website_url, opening_hours) or admin-only (Art's artwork/year) — those
// aren't this job's concern either way.
var scraperOwnedFields = map[activitiessvc.Category][]string{
	activitiessvc.CategoryWellness:      {"treatments", "good_to_know"},
	activitiessvc.CategoryEntertainment: {"upcoming_shows", "good_to_know"},
	activitiessvc.CategoryCulture:       {"now_showing"},
	activitiessvc.CategoryArt:           {"current_exhibition"},
	activitiessvc.CategorySport:         {"what_to_bring", "effort_level", "gear", "difficulty"},
	activitiessvc.CategoryShopping:      {"what_youll_find"},
	activitiessvc.CategoryNightlife:     {"lineup"},
}

// isComplete reports whether every one of category's scraper-owned fields
// already has a value on details — the permanent-skip signal for every
// category except Entertainment (see SyncWebsiteContent). false for a
// category with no entry in scraperOwnedFields (never complete, matches
// "unsupported category" falling through to the extractionConfig guard
// before this is ever consulted for such a category in practice). Uses
// isFieldEmpty (below), not isEmptyValue directly — a stored blank banner
// must not count as filled either.
func isComplete(category activitiessvc.Category, details json.RawMessage) bool {
	fields := scraperOwnedFields[category]
	if len(fields) == 0 {
		return false
	}
	var m map[string]any
	_ = json.Unmarshal(details, &m)
	for _, f := range fields {
		if isFieldEmpty(m[f]) {
			return false
		}
	}
	return true
}

// isFieldEmpty applies isEmptyValue's rule, plus one addition scoped to
// isComplete only: a banner object (now_showing/current_exhibition) with a
// blank title counts as empty too — the same "found nothing" treatment
// dropBlankBanner already gives a fresh extraction, extended here to also
// cover a row that already has a blank banner stored from before that fix
// existed. isEmptyValue itself is deliberately untouched — fillGaps and
// markDifficultyInferred both rely on its current, narrower behavior.
func isFieldEmpty(v any) bool {
	if isEmptyValue(v) {
		return true
	}
	banner, ok := v.(map[string]any)
	if !ok {
		return false
	}
	title, _ := banner["title"].(string)
	return strings.TrimSpace(title) == ""
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
//
// A non-Entertainment row that stays incomplete gets exactly one automatic
// attempt from the batch job, ever — a second failure means the venue's
// site is missing that field for good (or is unscrapable), so retrying it
// every cycle would burn Firecrawl credits with no ceiling (the design
// spec's credit-cost review flagged this: an indefinitely-retried row was
// never accounted for in the cost estimate). force skips that
// already-attempted gate (and Entertainment's freshness window) for a
// single explicitly-requested row — see cmd/websitesync's -retry-id flag.
//
// "Attempt" is recorded (markAttempt below) once Firecrawl has actually been
// called and the outcome is a content problem — an extraction error
// (Firecrawl already exhausted its own internal retries by then, see
// internal/firecrawl), malformed JSON, or a validation rejection all
// reproduce identically on a retry, so recording those as the one spent
// attempt is what keeps the credit ceiling real. A repo.Update failure is
// deliberately NOT recorded: that's an infra blip on content that already
// passed validation, not a reason to give up on the row, so it still
// retries next cycle exactly as it did before this policy existed.
func (a *Activities) SyncWebsiteContent(ctx context.Context, id string, force bool) error {
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

	_, perishable := perishableFields[activity.Category]
	complete := isComplete(activity.Category, activity.Details)
	if complete && !perishable {
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

	// minRadiusKM 0: this provider's cell_key is an activity ID, not a
	// geographic cell (see websiteSyncProvider's doc) — radius_km (T1,
	// rating-and-anywhere-radius) doesn't apply here, and 0 is always
	// satisfied by whatever's stored, so it never affects this freshness
	// check.
	syncedAt, attemptedBefore, err := a.repo.SyncedAt(ctx, websiteSyncProvider, activity.ID, string(activity.Category), "", 0)
	if err != nil {
		return fmt.Errorf("checking website sync freshness for %s: %w", id, err)
	}
	if !force {
		switch {
		case perishable:
			// Reachable here whether complete or not — a perishable field's
			// value goes stale regardless of completeness, so unlike every
			// other category these keep a periodic re-scan instead of
			// giving up. See perishableFields.
			if attemptedBefore && time.Since(syncedAt) < refreshFreshness(activity.Category) {
				slog.Info("website sync skipped, still fresh", "activity_id", id, "synced_at", syncedAt)
				return nil
			}
		case attemptedBefore:
			// Every other category: one automatic attempt, ever. See the
			// SyncWebsiteContent doc comment for why.
			slog.Info("website sync skipped, already attempted and still incomplete", "activity_id", id)
			return nil
		}
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

	// markAttempt records the attempt the moment Firecrawl was actually
	// called, for every outcome that means "this row's content is the
	// problem" — an extraction error, malformed JSON, or a validation
	// failure will produce the exact same result next cycle, so retrying
	// spends another Firecrawl call for nothing (see the doc comment
	// above). Deliberately NOT called on a repo.Update failure below: that's
	// an infra blip on already-good, already-validated content, unrelated
	// to the venue's site — the row should still retry next cycle, same as
	// before this attempt-tracking existed.
	markAttempt := func() error {
		// radiusKM 0: not geographic (see the SyncedAt call above).
		if err := a.repo.MarkSynced(ctx, websiteSyncProvider, activity.ID, string(activity.Category), "", 0); err != nil {
			return fmt.Errorf("marking website sync for %s: %w", id, err)
		}
		return nil
	}

	extractCtx, cancel := context.WithTimeout(ctx, firecrawlTimeout)
	extracted, err := a.firecrawl.ExtractJSON(extractCtx, detail.WebsiteURI, extract.prompt, extract.schema)
	cancel()
	if err != nil {
		if markErr := markAttempt(); markErr != nil {
			return markErr
		}
		return fmt.Errorf("extracting website content for %s: %w", id, err)
	}
	extracted = dropBlankBanner(activity.Category, extracted)

	merged, err := fillGaps(activity.Details, extracted)
	if err != nil {
		if markErr := markAttempt(); markErr != nil {
			return markErr
		}
		return fmt.Errorf("merging website content for %s: %w", id, err)
	}
	if field, ok := perishableFields[activity.Category]; ok {
		merged = overwriteField(merged, extracted, field)
	}
	if activity.Category == activitiessvc.CategorySport {
		merged = markDifficultyInferred(activity.Details, merged)
	}

	// Firecrawl's LLM extraction is not schema-guaranteed: an unexpected key
	// or a type mismatch must never reach the DB unvalidated, or a
	// subsequent admin edit to this row would fail ValidateDetails' strict
	// decode. Skip the write, but still mark the attempt — recovering needs
	// an explicit -retry-id run (or, for Entertainment, the next 30-day
	// window), not another automatic try that would reproduce the same
	// invalid output.
	cleaned, err := ValidateDetails(activity.Category, merged)
	if err != nil {
		slog.Warn("website sync produced invalid details, skipping write", "activity_id", id, "error", err)
		return markAttempt()
	}

	if _, err := a.repo.Update(ctx, id, activitiessvc.UpdatePatch{Details: &cleaned}); err != nil {
		return fmt.Errorf("saving website content for %s: %w", id, err)
	}
	return markAttempt()
}

// overwriteField replaces key on merged with its value from extracted, when
// extracted actually has a non-empty one — used only for Entertainment (see
// SyncWebsiteContent), where upcoming_shows must actually update on every
// sync, complete or not, even though fillGaps' fill-only-if-empty rule would
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
	if strings.TrimSpace(title) != "" {
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
