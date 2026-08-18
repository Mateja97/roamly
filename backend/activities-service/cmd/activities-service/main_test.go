package main

import (
	"testing"
	"time"
)

// TestGoogleSyncTTLFromEnv covers T4 (places-api-cost-reduction)'s config
// acceptance criterion: GOOGLE_SYNC_TTL_DAYS is readable from configuration,
// defaulting to 30 days, and a malformed value falls back to that default
// rather than panicking or producing a zero/negative TTL.
func TestGoogleSyncTTLFromEnv(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want time.Duration
	}{
		{"default (unset resolves via sharedconfig.OrDefault before this is called)", "30", 30 * 24 * time.Hour},
		{"explicit override", "45", 45 * 24 * time.Hour},
		{"non-numeric falls back to default", "banana", 30 * 24 * time.Hour},
		{"zero falls back to default", "0", 30 * 24 * time.Hour},
		{"negative falls back to default", "-5", 30 * 24 * time.Hour},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := googleSyncTTLFromEnv(tt.raw); got != tt.want {
				t.Errorf("googleSyncTTLFromEnv(%q) = %v, want %v", tt.raw, got, tt.want)
			}
		})
	}
}
