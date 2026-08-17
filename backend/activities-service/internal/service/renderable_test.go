package service_test

import (
	"encoding/json"
	"testing"

	"activities-service/internal/service"

	"backend/shared/models/activitiessvc"
)

// onePhoto is the "has a photo" precondition every content case below needs
// — the photo check runs first, so a fixture without one would short-circuit
// to no_photo and never exercise the scoring at all.
var onePhoto = []activitiessvc.Photo{{URL: "https://example.com/a.jpg"}}

func TestRenderability(t *testing.T) {
	tests := []struct {
		name       string
		activity   activitiessvc.Activity
		wantOK     bool
		wantReason string
		wantScore  int
	}{
		{
			name:       "no photos drafts for no_photo even when the content is rich",
			activity:   activitiessvc.Activity{ExternalID: "place-1", Description: "A fine museum.", Details: json.RawMessage(`{"good_to_know":["Free entry"]}`)},
			wantOK:     false,
			wantReason: service.ReasonNoPhoto,
			wantScore:  4,
		},
		{
			name:      "a description alone clears the bar",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Description: "A fine museum."},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:      "a body block alone clears the bar",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"facilities":["Restroom available"]}`)},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:      "multiple body blocks still score once",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"facilities":["Restroom"],"known_for":["Coffee"],"good_to_know":["Dogs ok"]}`)},
			wantOK:    true,
			wantScore: 2,
		},
		{
			// Reviews are furniture: a carousel under an empty body is not
			// a page worth publishing, however many reviews it carries.
			name:       "quotable Tripadvisor reviews alone do not clear the bar",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "ta-1", Details: json.RawMessage(`{"tripadvisor":{"web_url":"https://ta/x"},"reviews":[{"text":"Great"}]}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  1, // reviews and the tripadvisor chip share one presentational point
		},
		{
			name: "Tripadvisor reviews plus a real body block do clear it",
			activity: activitiessvc.Activity{
				Photos: onePhoto, ExternalID: "ta-1",
				Details: json.RawMessage(`{"tripadvisor":{"web_url":"https://ta/x"},"reviews":[{"text":"Great"}],"popular_dishes":[{"name":"Pljeskavica","price":"800"}]}`),
			},
			wantOK:    true,
			wantScore: 3, // body block 2 + one shared presentational point
		},
		{
			name:       "a review-less Tripadvisor row with no Google reviews drafts for no_content",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "ta-1", GooglePlaceID: "place-9", Details: json.RawMessage(`{"tripadvisor":{"web_url":"https://ta/x"}}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  1,
		},
		{
			// The Google review fallback fills the reviews slot but adds no
			// body — measured 2026-08-17, this is how 51% of a broad sample
			// was passing a bar it should never have cleared.
			name: "the Google review fallback does not rescue a bodyless row",
			activity: activitiessvc.Activity{
				Photos: onePhoto, ExternalID: "ta-1", GooglePlaceID: "place-9",
				Details:       json.RawMessage(`{"tripadvisor":{"web_url":"https://ta/x"}}`),
				GoogleReviews: []activitiessvc.GoogleReview{{Text: "Great"}},
			},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  1, // google reviews and the tripadvisor chip share one point
		},
		{
			name: "a live description plus Google reviews clears it",
			activity: activitiessvc.Activity{
				Photos: onePhoto, ExternalID: "place-1", Description: "A live editorial summary.",
				GoogleReviews: []activitiessvc.GoogleReview{{Text: "Great"}},
			},
			wantOK:    true,
			wantScore: 3, // description 2 + one shared presentational point
		},
		{
			name:       "chips and opening hours together are still not content",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"venue_type":"Museum","website_url":"https://x","hours":"Mon 9-5","opening_hours":{"periods":[{"day":"monday"}]}}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  1,
		},
		{
			name:       "a sport row with a photo and nothing else drafts for no_content",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Category: activitiessvc.CategorySport, Details: json.RawMessage(`{}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			name:       "no place id and no content drafts for no_place_id, the more specific reason",
			activity:   activitiessvc.Activity{Photos: onePhoto, Source: "firecrawl", Details: json.RawMessage(`{}`)},
			wantOK:     false,
			wantReason: service.ReasonNoPlaceID,
			wantScore:  0,
		},
		{
			name:      "no place id but enough stored content passes on its own merits",
			activity:  activitiessvc.Activity{Photos: onePhoto, Source: "firecrawl", Details: json.RawMessage(`{"treatments":[{"name":"Massage","price":"2000"}]}`)},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:       "a google_place_id alone counts as having a place id",
			activity:   activitiessvc.Activity{Photos: onePhoto, GooglePlaceID: "place-9", Details: json.RawMessage(`{}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			name:       "empty and null detail values score nothing",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"good_to_know":[],"facilities":null,"venue_type":"","reviews":[]}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			// The app's classifyPhrases drops blank entries before the
			// section decides whether to omit itself, so a list of empty
			// strings renders an empty section, not content.
			name:       "a body block of only blank strings is not content",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"good_to_know":["","   "]}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			name:      "one non-blank entry among blanks is still content",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"good_to_know":["","Free entry"]}`)},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:      "a list of objects is content, not blank",
			activity:  activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{"treatments":[{"name":"Massage","price":"2000"}]}`)},
			wantOK:    true,
			wantScore: 2,
		},
		{
			name:       "a whitespace-only description is not a description",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Description: "   ", Details: json.RawMessage(`{}`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
		{
			name:       "malformed details JSON scores zero rather than erroring",
			activity:   activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Details: json.RawMessage(`{not json`)},
			wantOK:     false,
			wantReason: service.ReasonNoContent,
			wantScore:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := service.Renderability(tt.activity, service.DefaultMinContentScore)
			if got.OK != tt.wantOK {
				t.Errorf("OK = %v, want %v", got.OK, tt.wantOK)
			}
			if got.Reason != tt.wantReason {
				t.Errorf("Reason = %q, want %q", got.Reason, tt.wantReason)
			}
			if got.Score != tt.wantScore {
				t.Errorf("Score = %d, want %d", got.Score, tt.wantScore)
			}
		})
	}
}

// TestRenderability_MinScoreIsHonoured pins the threshold as a parameter,
// not a hard-coded 2 — the whole point of the dry-run report is that the
// bar can be re-read at several thresholds from one run.
func TestRenderability_MinScoreIsHonoured(t *testing.T) {
	chipsOnly := activitiessvc.Activity{
		Photos: onePhoto, ExternalID: "place-1",
		Details: json.RawMessage(`{"venue_type":"Museum"}`),
	}

	if got := service.Renderability(chipsOnly, 1); !got.OK {
		t.Errorf("at minScore=1 a chips-only row should pass, got %+v", got)
	}
	if got := service.Renderability(chipsOnly, 2); got.OK {
		t.Errorf("at minScore=2 a chips-only row should fail, got %+v", got)
	}

	rich := activitiessvc.Activity{Photos: onePhoto, ExternalID: "place-1", Description: "Words."}
	if got := service.Renderability(rich, 4); got.OK {
		t.Errorf("at minScore=4 a description-only row (score 2) should fail, got %+v", got)
	}
}

// TestRenderability_VerdictReasonIsEmptyWhenOK guards the convention the
// audit's tally depends on: a passing verdict carries no reason string, so
// counting by reason never double-counts a healthy row.
func TestRenderability_VerdictReasonIsEmptyWhenOK(t *testing.T) {
	got := service.Renderability(activitiessvc.Activity{Photos: onePhoto, Description: "Words."}, service.DefaultMinContentScore)
	if !got.OK || got.Reason != "" {
		t.Errorf("Renderability() = %+v, want OK with an empty Reason", got)
	}
}
