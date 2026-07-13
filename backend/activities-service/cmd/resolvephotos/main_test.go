package main

import (
	"strings"
	"testing"
)

func TestFormatUpdateSQL(t *testing.T) {
	tests := []struct {
		name   string
		photos []resolvedPhoto
		want   []string // substrings the output must contain
	}{
		{
			name: "resolved photo with attribution",
			photos: []resolvedPhoto{
				{title: "Colosseum Guided Tour", url: "https://lh3.googleusercontent.com/photo1", author: "Jane Doe", authorLink: "https://maps.google.com/contrib/1"},
			},
			want: []string{
				`UPDATE activities SET photos =`,
				`"url":"https://lh3.googleusercontent.com/photo1"`,
				`"author":"Jane Doe"`,
				`WHERE title = 'Colosseum Guided Tour';`,
			},
		},
		{
			name: "title with an embedded single quote is escaped",
			photos: []resolvedPhoto{
				{title: "Gaudi's Barcelona Walk", url: "https://example.com/x", author: "A"},
			},
			want: []string{`WHERE title = 'Gaudi''s Barcelona Walk';`},
		},
		{
			name:   "no resolved photos produces empty output",
			photos: nil,
			want:   nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatUpdateSQL(tt.photos)
			if tt.want == nil {
				if got != "" {
					t.Errorf("formatUpdateSQL() = %q, want empty", got)
				}
				return
			}
			for _, want := range tt.want {
				if !strings.Contains(got, want) {
					t.Errorf("formatUpdateSQL() = %q, want substring %q", got, want)
				}
			}
		})
	}
}
