// Package contentkind holds the shared placeholder denylist and the
// scalar/phrase/prose length-and-shape limits every generated activity field
// is declared against. Canonical source of truth:
// docs/superpowers/specs/2026-08-02-activity-detail-system-design.md, "The
// data contract" section — Denylist below is copied verbatim from its
// "Placeholder denylist" subsection. The app (app/src/features/activity-list/
// fieldKind.ts) hand-copies the same list independently, since it's a
// different language/repo; keep both in sync when the spec's list changes
// (a parity test in T11 asserts they match).
package contentkind

import (
	"slices"
	"strings"
	"unicode/utf8"
)

// denylist is the canonical set of placeholder/"not specified"-style strings
// no generated field may ever be stored with, copied verbatim from the
// spec's "Placeholder denylist" section. Unexported so no importer can
// mutate the canonical list in place — Denylist() below hands out a copy.
var denylist = []string{
	"not specified",
	"unspecified",
	"not available",
	"n/a",
	"na",
	"unknown",
	"none",
	"--",
	"-",
	"nije navedeno",
	"nije poznato",
	"nema podataka",
	"nepoznato",
}

// Denylist returns a copy of the canonical placeholder denylist, e.g. for a
// test that wants to iterate every entry — mutating the returned slice
// never affects MatchesDenylist.
func Denylist() []string {
	return slices.Clone(denylist)
}

// MatchesDenylist reports whether s, once normalized (case-folded,
// whitespace-normalized, trailing sentence punctuation stripped), equals a
// Denylist entry. An empty s never matches — emptiness is a separate check
// in the spec's Absence rule, not a denylist concern.
func MatchesDenylist(s string) bool {
	n := normalize(s)
	if n == "" {
		return false
	}
	for _, d := range denylist {
		if n == normalize(d) {
			return true
		}
	}
	return false
}

// normalize case-folds s, collapses internal whitespace runs to a single
// space, trims surrounding whitespace, and strips trailing sentence
// punctuation (. ! ? , ; :). It deliberately does not strip "-" itself —
// two Denylist entries ("-" and "--") are pure dashes, and stripping them
// here would normalize both to "" and make them unmatchable. Re-trims after
// the punctuation strip: stripping "." from "not specified ." leaves a
// trailing space that Fields+Join already collapsed but didn't remove —
// matches the app's fieldKind.ts normalize, which does the same re-trim.
func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.Join(strings.Fields(s), " ")
	return strings.TrimSpace(strings.TrimRight(s, ".,;:!?"))
}

// The data contract's three kinds (spec's "The data contract" table): each
// generated field is declared as exactly one, and the kind decides which
// slots may render it. Not wired to specific fields in this package — T2
// adds the per-field kind map on the Go structs.
const (
	// ScalarMaxChars/ScalarMaxWords bound the `scalar` kind: a stat-grid
	// cell, meta-line item, or chip value.
	ScalarMaxChars = 18
	ScalarMaxWords = 4
	// PhraseMaxChars bounds the `phrase` kind: a checklist item, pill, or
	// list-row name.
	PhraseMaxChars = 80
	// ProseMaxChars is the `prose` kind's UI clamp threshold, not a
	// rejection limit — prose has no length-based rejection (over-length
	// prose clamps to 3 lines client-side instead of being omitted), so
	// there is no IsValidProse: the constant exists for that client-side
	// use and for symmetry with the other two kinds.
	ProseMaxChars = 280
)

// IsValidScalar reports whether s satisfies the `scalar` kind's shape rules:
// at most ScalarMaxChars characters, at most ScalarMaxWords words, and no
// terminal ".", "!", or "?". It does not check the Absence rule's other two
// legs (emptiness, denylist) — callers combine this with MatchesDenylist.
func IsValidScalar(s string) bool {
	return utf8.RuneCountInString(s) <= ScalarMaxChars &&
		len(strings.Fields(s)) <= ScalarMaxWords &&
		!hasTerminalPunctuation(s)
}

// IsValidPhrase reports whether s satisfies the `phrase` kind's shape rules:
// at most PhraseMaxChars characters, once one trailing terminal-punctuation
// char is stripped for the *measurement only* — the phrase itself is not
// rejected for carrying that punctuation.
//
// T11: brought in line with the app's `fieldKind.ts` (T9 round 3) — a real
// short phrase legitimately ending in a period ("Reservations required.")
// was being destructively rejected outright by this package's old rule,
// which this package's own doc comment names as the app's canonical source
// of truth; that fix landed client-side only (T9), silently diverging from
// here and from the Tours & Experiences write path (`dropInvalidPhrases` in
// activities-service, the only live caller of this function), which kept
// clearing the identical content the client would now render. One trailing
// ".", "!", or "?" is stripped before the length check only; a genuinely
// sentence-shaped value still exceeds PhraseMaxChars after the strip, so the
// rule's real target (multi-clause sentences) is unaffected. A value that's
// nothing but terminal punctuation once trimmed (".", "...") has no content
// at all and is rejected outright — mirrors `fieldKind.ts`'s T9-round-3
// punctuation-only guard.
func IsValidPhrase(s string) bool {
	s = strings.TrimSpace(s)
	if isAllTerminalPunctuation(s) {
		return false
	}
	if hasTerminalPunctuation(s) {
		s = s[:len(s)-1] // terminal punctuation is always a single ASCII byte
	}
	return utf8.RuneCountInString(s) <= PhraseMaxChars
}

func hasTerminalPunctuation(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	switch s[len(s)-1] {
	case '.', '!', '?':
		return true
	default:
		return false
	}
}

// isAllTerminalPunctuation reports whether s (once trimmed) is non-empty and
// made up entirely of ".", "!", "?" — content-free even though it has no
// terminal-punctuation *char count* long enough to fail the length check.
func isAllTerminalPunctuation(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r != '.' && r != '!' && r != '?' {
			return false
		}
	}
	return true
}
