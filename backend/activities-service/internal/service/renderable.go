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
	ReasonNoPhoto   = "no_photo"
	ReasonNoPlaceID = "no_place_id"
	ReasonNoContent = "no_content"
)

// DefaultMinContentScore is the publish bar: "one real body block, or a
// description, or quotable reviews". Presentational signals share a single
// point (see contentScore), so no combination of chips and opening hours
// can reach it — which is the whole reason the bar is 2 and not 1.
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
	"difficulty",
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
	if anyKeyHasValue(fields, bodyBlockKeys) {
		fired(scoreContent, SignalBodyBlock)
	}

	// Reviews are furniture, not something to read. They score with the
	// chips and the hours row, sharing that group's single point, so no
	// row can clear a bar of 2 on reviews alone.
	//
	// This was measured, not assumed. Scoring reviews as content (2 points)
	// made a bar of 2 nearly unconditional: Google returns reviews for very
	// nearly every Google-sourced venue, and the first audit runs found 92%
	// of Sport and 51% of a broad sample clearing the bar on reviews alone,
	// while rendering a carousel under an otherwise empty body — the exact
	// bare page the audit exists to find. See the spec's "Measured outcome".
	//
	// Each member is still named in Signals even though they share one
	// point, because which kind of furniture a row has is the thing the
	// report has to stay able to show.
	var presentational []string
	if anyKeyHasValue(fields, presentationalKeys) {
		presentational = append(presentational, SignalPresentational)
	}
	if hasValue(fields[reviewsKey]) {
		presentational = append(presentational, SignalTripadvisorReviews)
	}
	if len(a.GoogleReviews) > 0 {
		presentational = append(presentational, SignalGoogleReviews)
	}
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
