// Package namemap classifies a venue from its name alone: into one of
// Roamly's Restaurants/Cafés/Bars categories (see Category), and into a
// subtype within its category (see Subtype). The name is the only signal
// Tripadvisor's Content API entitlement actually provides, and it is also
// the only signal left for the ~36% of venues Google Places cannot resolve
// at all. Google-type-driven subtype classification lives in placesmap;
// this package is what fills the gaps that leaves.
package namemap

import (
	"regexp"
	"strings"

	"backend/shared/models/activitiessvc"
)

// cafeRe / barRe hold the curated, English + Serbian/Latin-script keywords
// that decide Category below, matched as whole words (\b-bounded) so a
// keyword like "bar" doesn't false-positive inside an unrelated name that
// merely contains it as a substring (e.g. real Belgrade restaurant "Ambar
// Beograd"). Restaurants, Cafés and Bars are all sourced from Tripadvisor
// with each venue filed under exactly one of them (see
// service.syncTripadvisorAnchor), but Terra's categories[] field -- the one
// real signal that would separate them -- is documented but never returned
// on our API entitlement (verified live), and neither subratings (every
// food venue gets a Food subrating, cafes and bars included) nor
// price_level ("Cheap Eats"/"Mid Range"/"Fine Dining", same three buckets
// regardless of venue type) separate the three either. The venue name is
// the only signal left, so this is a keyword heuristic on name, done
// honestly rather than dressed up as something smarter. Replace with real
// category data if Tripadvisor ever grants the categories[] entitlement.
var (
	cafeRe = regexp.MustCompile(`\b(coffee|cafe|kafe|espresso|roastery|poslasticarnica|tea|tearoom)\b`)
	barRe  = regexp.MustCompile(`\b(bar|pub|pivnica|brewery|tavern|kafana|cocktail|wine)\b`)
)

// diacriticFold maps the accented letters actually seen in real Tripadvisor
// venue names -- Serbian Latin script (š, đ, č, ć, ž) plus "café" -- to
// their plain-ASCII form, so the keyword patterns above don't need an
// accented spelling of every keyword. Extend only when a real venue name
// needs another accented letter, not speculatively.
var diacriticFold = strings.NewReplacer(
	"š", "s", "đ", "dj", "č", "c", "ć", "c", "ž", "z", "é", "e",
)

// Category classifies a Tripadvisor venue into Restaurants/Cafés/Bars from
// its name alone (see the keyword doc above) -- case- and
// diacritic-insensitive whole-word match, Cafés checked before Bars.
// Restaurants is the explicit default when nothing matches: an honest
// documented fallback, never a guess beyond the curated lists.
func Category(name string) activitiessvc.Category {
	folded := diacriticFold.Replace(strings.ToLower(name))
	switch {
	case cafeRe.MatchString(folded):
		return activitiessvc.CategoryCafes
	case barRe.MatchString(folded):
		return activitiessvc.CategoryBars
	default:
		return activitiessvc.CategoryRestaurants
	}
}

// subtypeRule is one name-keyword rule: the pattern, the slug it yields per
// category, and whether a match outranks a Google answer.
//
// byCategory doubles as the validity gate — a category absent from the map
// simply has no slug for this rule, so a venue named "Stara Mehana" filed
// under Culture yields "" rather than a slug Culture would reject anyway.
type subtypeRule struct {
	re         *regexp.Regexp
	byCategory map[activitiessvc.Category]string
	// override marks a local venue-type keyword whose match beats Google's
	// own classification. See subtypeRules' doc for why only two rules
	// carry it.
	override bool
}

// subtypeRules is the name -> subtype table, evaluated in order, so the two
// override rules are consulted before any generic one ("VIBE LOUNGE shisha &
// cocktail bar" is a shisha venue, not a cocktail bar).
//
// Only shisha and kafana override a Google answer. Both are Serbian venue
// types Google systematically mislabels — it returns cafe/lounge/nightclub
// for them — and both are named unambiguously: a venue with "nargila" or
// "kafana" in its name is that thing. Every other keyword here is a fallback
// for when Google resolves to nothing at all, and must never outrank a real
// Google type.
//
// Spellings are those attested in venue NAMES in the live database when this
// rule was written — 12 titles containing "shisha", 6 "nargila", 3 "hookah".
// Those are name counts, not counts of rows this rule classifies; don't read
// them as coverage. Bare "šiša"/"sisa" is deliberately absent: diacriticFold
// maps š->s and "šišanje" is Serbian for haircut, so that keyword would
// eventually match barbershops. Do not add it.
//
// The shisha keywords match as a PREFIX — leading \b, no trailing one — so a
// fused compound resolves: real venues "HookahPlace Kraljevo" and "Shisharka
// Bar Zlatibor" run the keyword straight into the next syllable and were
// missed while this group shared a trailing \b. The same shape also absorbs
// Serbian declension without enumerating cases ("nargila/nargile/nargilu/
// nargilom" are all just "nargil"), which is why "nargil" lost its [ae]?
// suffix rather than growing more alternatives.
//
// Dropping the trailing \b does NOT reopen the barbershop false positive
// above: folded "šišanje" is "sisanje", which starts "sisa", while the
// keywords here are "shisha"/"sisha" — the fourth letter differs, so neither
// can match it at any anchoring. TestSubtype pins that with both the folded
// and the diacritic spelling; do not delete those two cases.
//
// The leading \b is still load-bearing and must stay: it is what keeps
// "shisha" from matching inside "Bakshisha", also pinned by a test.
var subtypeRules = []subtypeRule{
	{
		re: regexp.MustCompile(`\b(shisha|sisha|nargil|hookah)`),
		byCategory: map[activitiessvc.Category]string{
			activitiessvc.CategoryBars:      "shisha",
			activitiessvc.CategoryNightlife: "shisha_lounge",
		},
		override: true,
	},
	{
		re: regexp.MustCompile(`\b(kafana|kafane|kafanica|mehana)\b`),
		byCategory: map[activitiessvc.Category]string{
			activitiessvc.CategoryBars:      "kafana",
			activitiessvc.CategoryNightlife: "kafana_live",
		},
		override: true,
	},
	{
		re:         regexp.MustCompile(`\b(pivnica|pivnice|pivara|brewery|brewpub)\b`),
		byCategory: map[activitiessvc.Category]string{activitiessvc.CategoryBars: "brewery"},
	},
	{
		re:         regexp.MustCompile(`\b(pub)\b`),
		byCategory: map[activitiessvc.Category]string{activitiessvc.CategoryBars: "pub"},
	},
	{
		re:         regexp.MustCompile(`\b(cocktail|koktel)\b`),
		byCategory: map[activitiessvc.Category]string{activitiessvc.CategoryBars: "cocktail_bar"},
	},
	{
		re:         regexp.MustCompile(`\b(wine|vinski|vinoteka)\b`),
		byCategory: map[activitiessvc.Category]string{activitiessvc.CategoryBars: "wine_bar"},
	},
}

// Subtype derives a subcategory slug for cat from a venue's name, and reports
// whether the match is a local venue-type keyword that should outrank a
// Google-derived answer (see subtypeRules).
//
// Returns ("", false) when no rule matches, or when the matching rule has no
// slug for cat — never a guess, matching placesmap.Subtype's contract that ""
// is always a valid subcategory. Case- and diacritic-insensitive, same
// folding as Category.
func Subtype(cat activitiessvc.Category, name string) (string, bool) {
	folded := diacriticFold.Replace(strings.ToLower(name))
	for _, r := range subtypeRules {
		slug, ok := r.byCategory[cat]
		if !ok {
			continue
		}
		if r.re.MatchString(folded) {
			return slug, r.override
		}
	}
	return "", false
}
