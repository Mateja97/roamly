package service

import (
	"encoding/json"
	"strings"

	"backend/shared/models/activitiessvc"
)

// Reason values recorded in the activities.draft_reason column
// (migration 0033). Stored verbatim, so these strings are a persisted
// vocabulary — renaming one needs a data migration, not just a constant
// edit.
const (
	// ReasonNoPhoto (T5, places-api-cost-reduction): Google sync no longer
	// resolves photos at ingest time, so every Google row that has not yet
	// had its detail page requested has zero photos until then. This reason
	// now means "no photo yet resolved", not "venue has no photo" —
	// cmd/auditcontent's report legend carries the same caveat.
	ReasonNoPhoto   = "no_photo"
	ReasonNoPlaceID = "no_place_id"
	ReasonNoContent = "no_content"
)

// DefaultMinContentScore is the publish bar: "one real body block or a
// description; furniture is not enough". Presentational signals share a
// single point (see contentScore), so no combination of chips and opening
// hours can reach it — which is the whole reason the bar is 2 and not 1.
const DefaultMinContentScore = 2

// Verdict is one activity's renderability judgement. Reason is "" exactly
// when OK is true. Score is always populated, including on a no_photo
// verdict, so cmd/auditcontent can report the score distribution across the
// whole catalog rather than only across the rows that got as far as the
// content check.
type Verdict struct {
	OK     bool
	Reason string
	Score  int
	// Signals names each scoring signal that fired, in the fixed order
	// below. A bare Score hides the thing the audit most needs to show:
	// SignalDescription and SignalGoogleReviews both score 2, but one is a
	// real "About" block and the other is a reviews carousel under an
	// otherwise empty body. Nil when nothing scored.
	Signals []string
}

// Scoring signal names, reported per row by cmd/auditcontent so a passing
// row's reason for passing is visible rather than collapsed into a number.
const (
	SignalDescription        = "description"
	SignalBodyBlock          = "body_block"
	SignalTripadvisorReviews = "tripadvisor_reviews"
	SignalGoogleReviews      = "google_reviews"
	SignalPresentational     = "presentational"
	// SignalInferredDifficulty fires instead of SignalBodyBlock when
	// difficulty is the ONLY bodyBlockKey carrying a row and websitesync's
	// markDifficultyInferred flagged it as its own estimate rather than the
	// venue's own stated content — see contentScore. Same score as
	// SignalBodyBlock (this is about visibility, not scoring): a Sport row
	// passing on an inferred meter alone must not read identically to one
	// with real prose in the report, since Sport is the category the
	// enforce-versus-extend decision turns on.
	SignalInferredDifficulty = "inferred_difficulty"
)

// bodyBlockKeys are the details keys that render a labelled section in the
// detail page's body. Any one of them is real content. Matched 1:1 against
// app/src/features/activity-list/activityDetailConfig.ts's uniqueSection —
// every key that switch renders as a pills/checklist/icongrid/banner/
// schedule section belongs here, or a row carrying only that key scores 0
// despite rendering a full section on the detail page.
var bodyBlockKeys = []string{
	"good_to_know", "facilities", "known_for",
	"treatments", "upcoming_shows", "popular_dishes",
	"what_to_bring", "now_showing", "current_exhibition",
	"on_the_bar", "signature_pours", "what_youll_find", "lineup",
	// difficulty is Sport's own body section: DetailBody renders it as the
	// DifficultyMeter, promoted above the stat grid rather than sitting in
	// it. websitesync fills it, so a scraped Sport row whose only content
	// is a difficulty rating renders a labelled meter — scoring it as a
	// chip would tally that row no_content and overstate the gap in the
	// one category the enforce-versus-extend decision turns on.
	difficultyKey,
}

// presentationalKeys are the details keys that render a chip, a meter, an
// hours row, or an attribution plate — page furniture, not something a user
// came to read. They share one point between them (see contentScore).
// effort_level/gear render as Sport's fact-strip chips — genuinely chips,
// unlike difficulty beside them, which is a body section and lives in
// bodyBlockKeys.
var presentationalKeys = []string{
	"opening_hours", "venue_type", "hours", "website_url", "tripadvisor",
	"effort_level", "gear",
}

// reviewsKey is the Tripadvisor quoted-review array. Scored like a body
// block, not like the `tripadvisor` attribution key beside it: the reviews
// carousel is content a user reads, the attribution plate is furniture.
const reviewsKey = "reviews"

// difficultyKey and difficultyInferredKey name the two details keys
// SignalInferredDifficulty distinguishes between — see markDifficultyInferred
// in websitesync.go, the only writer of difficultyInferredKey.
const (
	difficultyKey         = "difficulty"
	difficultyInferredKey = "difficulty_inferred"
)

// SourceTripadvisor is the Activity.Source value marking a row whose
// content comes from Tripadvisor rather than Google — the same string
// internal/service switches on to route a row's photo and detail resolves.
const SourceTripadvisor = "tripadvisor"

const (
	scoreContent        = 2
	scorePresentational = 1
)

// Renderability judges whether activity has enough to be worth publishing:
// a photo, and content scoring at least minScore. It is pure — no I/O, no
// clients — and expects an activity that has already been through the live
// merge (see Activities.WithLiveDetails), so the judgement is made against
// exactly what a detail-page request would render, not against the sparser
// stored row.
//
// Reasons are ordered most-specific-first. A row with no place id and no
// content reports no_place_id rather than no_content, because the two need
// different remedies: no_content might resolve on Google's next update,
// while no_place_id never resolves until something matches the venue.
//
// Nothing here writes. Persisting a verdict is the caller's decision, and
// deliberately a separate one.
func Renderability(a activitiessvc.Activity, minScore int) Verdict {
	score, signals := contentScore(a)
	switch {
	case len(a.Photos) == 0:
		return Verdict{Reason: ReasonNoPhoto, Score: score, Signals: signals}
	case score >= minScore:
		return Verdict{OK: true, Score: score, Signals: signals}
	case a.ExternalID == "" && a.GooglePlaceID == "":
		return Verdict{Reason: ReasonNoPlaceID, Score: score, Signals: signals}
	default:
		return Verdict{Reason: ReasonNoContent, Score: score, Signals: signals}
	}
}

// contentScore counts what renders a block on the detail page, not what is
// merely present in the JSON. Each signal scores once however many of its
// keys are present — three chips are still one chip row, and two body
// blocks are still one screenful of substance rather than two.
//
// Malformed stored details score zero for every details-derived signal
// rather than erroring, the same best-effort decode hasTripadvisorReviews
// and mergeLiveDetails already use: a stored-data problem this function
// cannot repair must not become a demotion it can't justify either — and it
// won't, since a row scoring zero on a corrupt blob still needs the photo
// and place-id checks to fall its way before any reason is reported.
func contentScore(a activitiessvc.Activity) (int, []string) {
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(a.Details, &fields) // best-effort; nil map on failure

	score := 0
	var signals []string
	fired := func(points int, name string) {
		score += points
		signals = append(signals, name)
	}

	if strings.TrimSpace(a.Description) != "" {
		fired(scoreContent, SignalDescription)
	}
	if matched := matchedBodyBlockKeys(fields); len(matched) > 0 {
		// A row carried by difficulty alone, and only when websitesync
		// inferred that value rather than reading it off the venue's own
		// page, gets its own signal name — see SignalInferredDifficulty.
		// Every other combination (including an admin-set difficulty, which
		// is real curated content like any other body block) still reports
		// plain SignalBodyBlock. The score is identical either way.
		if len(matched) == 1 && matched[0] == difficultyKey && boolValue(fields[difficultyInferredKey]) {
			fired(scoreContent, SignalInferredDifficulty)
		} else {
			fired(scoreContent, SignalBodyBlock)
		}
	}

	// Reviews are furniture for a Google-sourced row, and content for a
	// Tripadvisor-sourced one. That asymmetry is measured, not assumed, and
	// it is the only place this scorer looks at where a row came from.
	//
	// For a Google-sourced row, scoring reviews as content made a bar of 2
	// nearly unconditional: Google returns reviews for very nearly every
	// venue, and the first audit runs found 92% of Sport and 51% of a broad
	// sample clearing the bar on reviews alone while rendering a carousel
	// under an otherwise empty body — the exact bare page the audit exists
	// to find.
	//
	// For a Tripadvisor-sourced row the same carousel IS the page's
	// proposition, and no body content is reachable for it: Tripadvisor
	// supplies a description for about a third of venues, `attributes` came
	// back empty for all 83 venues sampled, and only ~37% carry a
	// google_place_id, so websitesync cannot resolve their website either.
	// Holding them to a body-content bar drafted 76% of restaurants for
	// lacking something they can never source. See the spec's "Follow-up 4".
	//
	// Each member is still named in Signals even where they share a point,
	// because which kind of evidence a row has is the thing the report has
	// to stay able to show.
	reviewsAreContent := a.Source == SourceTripadvisor

	var reviewSignals []string
	if hasValue(fields[reviewsKey]) {
		reviewSignals = append(reviewSignals, SignalTripadvisorReviews)
	}
	if len(a.GoogleReviews) > 0 {
		reviewSignals = append(reviewSignals, SignalGoogleReviews)
	}

	if reviewsAreContent && len(reviewSignals) > 0 {
		fired(scoreContent, reviewSignals[0])
		signals = append(signals, reviewSignals[1:]...)
		reviewSignals = nil
	}

	var presentational []string
	if anyKeyHasValue(fields, presentationalKeys) {
		presentational = append(presentational, SignalPresentational)
	}
	presentational = append(presentational, reviewSignals...)
	if len(presentational) > 0 {
		score += scorePresentational
		signals = append(signals, presentational...)
	}
	return score, signals
}

func anyKeyHasValue(fields map[string]json.RawMessage, keys []string) bool {
	for _, k := range keys {
		if hasValue(fields[k]) {
			return true
		}
	}
	return false
}

// matchedBodyBlockKeys returns which of bodyBlockKeys actually carry a
// renderable value on fields — contentScore needs to know which key(s), not
// just whether any did, to tell an inferred-difficulty-only row apart from
// one with a real body block (see SignalInferredDifficulty).
func matchedBodyBlockKeys(fields map[string]json.RawMessage) []string {
	var matched []string
	for _, k := range bodyBlockKeys {
		if hasValue(fields[k]) {
			matched = append(matched, k)
		}
	}
	return matched
}

// boolValue decodes raw as a JSON bool, false for anything absent or
// unparseable — used only for difficultyInferredKey, a flag websitesync
// itself writes as a literal `true`/`false`, never anything else shaped.
func boolValue(raw json.RawMessage) bool {
	var b bool
	_ = json.Unmarshal(raw, &b)
	return b
}

// hasValue reports whether a decoded details value is worth rendering.
// Absent, null, [] and {} all read as absent, as does a blank or
// whitespace-only string — the app's own slots omit themselves for every one
// of these, so scoring them would credit a row for a section the user never
// sees.
//
// An array counts only if at least one element does: the app's
// classifyPhrases drops blank entries before a section decides whether to
// omit itself, so ["", " "] renders an empty section, not content. Recursing
// per element is what makes that true here too.
//
// An undecodable value is credited rather than dropped. It is non-empty
// bytes that this function cannot parse, and the failure direction that
// matters is the one that drafts a row — better to keep a row published on
// a value we cannot read than to delete catalog over a parse we got wrong.
func hasValue(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	switch trimmed {
	case "", "null", "[]", "{}":
		return false
	}

	switch trimmed[0] {
	case '"':
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return true
		}
		return strings.TrimSpace(s) != ""
	case '[':
		var items []json.RawMessage
		if err := json.Unmarshal(raw, &items); err != nil {
			return true
		}
		for _, item := range items {
			if hasValue(item) {
				return true
			}
		}
		return false
	}
	return true
}

// KnownDetailKeys returns every details key the scorer classifies, in no
// particular order. Exported for the drift guard in
// renderable_drift_test.go, which asserts placesmap.BuildLiveDetails cannot
// emit a key this list is missing — an unclassified key scores nothing and
// would draft rows that render perfectly well.
func KnownDetailKeys() []string {
	out := make([]string, 0, len(bodyBlockKeys)+len(presentationalKeys)+1)
	out = append(out, bodyBlockKeys...)
	out = append(out, presentationalKeys...)
	return append(out, reviewsKey)
}
