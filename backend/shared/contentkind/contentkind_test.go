package contentkind

import "testing"

func TestMatchesDenylist(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want bool
	}{
		// Every denylist entry, verbatim.
		{"not specified", "not specified", true},
		{"unspecified", "unspecified", true},
		{"not available", "not available", true},
		{"n/a", "n/a", true},
		{"na", "na", true},
		{"unknown", "unknown", true},
		{"none", "none", true},
		{"double dash", "--", true},
		{"single dash", "-", true},
		{"nije navedeno", "nije navedeno", true},
		{"nije poznato", "nije poznato", true},
		{"nema podataka", "nema podataka", true},
		{"nepoznato", "nepoznato", true},

		// Normalization: case, whitespace, trailing punctuation.
		{"uppercase", "NOT SPECIFIED", true},
		{"mixed case", "Not Specified", true},
		{"leading/trailing whitespace", "  unknown  ", true},
		{"collapsed internal whitespace", "not   specified", true},
		{"trailing period", "Not specified.", true},
		{"trailing exclamation", "Nije navedeno!", true},
		{"trailing comma", "n/a,", true},
		{"case + whitespace + punctuation combined", "  NIJE NAVEDENO.  ", true},
		{"space before trailing period", "Not specified .", true},

		// Legitimate values from the spec's exact examples must all pass.
		{"duration range", "60–90 min", false},
		{"price", "from €25", false},
		{"dress code", "Smart casual", false},
		{"duration with unit words", "2 h 30 min", false},
		{"language list", "EN, DE", false},

		// Non-matches that share a substring with a denylist entry but
		// aren't equal to one.
		{"empty string never matches", "", false},
		{"substring of a denylist entry", "not", false},
		{"superstring of a denylist entry", "definitely not specified anywhere", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := MatchesDenylist(tt.in); got != tt.want {
				t.Errorf("MatchesDenylist(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestIsValidScalar(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{"exactly at char limit", "123456789012345678", true},            // 18 chars
		{"one char over limit", "1234567890123456789", false},            // 19 chars
		{"exactly at word limit", "one two three four", true},            // 4 words
		{"one word over limit", "one two three four five", false},        // 5 words, also over char limit
		{"one word over limit but under char limit", "a b c d e", false}, // 5 words, 9 chars — isolates the word-count check from the char-count one
		{"no terminal punctuation", "60-90 min", true},
		{"terminal period rejected", "60-90 min.", false},
		{"terminal exclamation rejected", "Wow!", false},
		{"terminal question mark rejected", "Now?", false},
		{"spec example smart casual", "Smart casual", true},
		{"spec example languages", "EN, DE", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsValidScalar(tt.in); got != tt.want {
				t.Errorf("IsValidScalar(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestIsValidPhrase(t *testing.T) {
	eightyChars := "12345678901234567890123456789012345678901234567890123456789012345678901234567890"
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{"exactly at char limit", eightyChars, true},
		{"one char over limit", eightyChars + "1", false},
		{"terminal period rejected", "Free parking on site.", false},
		{"no terminal punctuation", "Free parking on site", true},
		{"long word count is fine for phrase", "one two three four five six seven eight", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsValidPhrase(tt.in); got != tt.want {
				t.Errorf("IsValidPhrase(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}
