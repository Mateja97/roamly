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
	"strings"
	"unicode/utf8"
)

// Denylist is the canonical set of placeholder/"not specified"-style strings
// no generated field may ever be stored with, copied verbatim from the
// spec's "Placeholder denylist" section.
var Denylist = []string{
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

// MatchesDenylist reports whether s, once normalized (case-folded,
// whitespace-normalized, trailing sentence punctuation stripped), equals a
// Denylist entry. An empty s never matches — emptiness is a separate check
// in the spec's Absence rule, not a denylist concern.
func MatchesDenylist(s string) bool {
	n := normalize(s)
	if n == "" {
		return false
	}
	for _, d := range Denylist {
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
// here would normalize both to "" and make them unmatchable.
func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.Join(strings.Fields(s), " ")
	return strings.TrimRight(s, ".,;:!?")
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
// at most PhraseMaxChars characters and no terminal ".", "!", or "?".
func IsValidPhrase(s string) bool {
	return utf8.RuneCountInString(s) <= PhraseMaxChars && !hasTerminalPunctuation(s)
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
