package main

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// TestGoogleSyncTTLFromEnv covers T4 (places-api-cost-reduction)'s config
// acceptance criterion: GOOGLE_SYNC_TTL_DAYS is readable from configuration,
// defaulting to 30 days, and a malformed value falls back to that default
// rather than panicking or producing a zero/negative TTL. It also covers the
// operator-visibility requirement: a set-but-invalid value logs a warning
// naming the bad value, while an unset value logs nothing.
func TestGoogleSyncTTLFromEnv(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    time.Duration
		wantLog bool
	}{
		{"unset falls back to default silently", "", 30 * 24 * time.Hour, false},
		{"explicit override", "45", 45 * 24 * time.Hour, false},
		{"non-numeric falls back to default and logs", "banana", 30 * 24 * time.Hour, true},
		{"zero falls back to default and logs", "0", 30 * 24 * time.Hour, true},
		{"negative falls back to default and logs", "-5", 30 * 24 * time.Hour, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			logger := slog.New(slog.NewTextHandler(&buf, nil))

			if got := googleSyncTTLFromEnv(logger, tt.raw); got != tt.want {
				t.Errorf("googleSyncTTLFromEnv(%q) = %v, want %v", tt.raw, got, tt.want)
			}

			gotLog := strings.Contains(buf.String(), "invalid GOOGLE_SYNC_TTL_DAYS")
			if gotLog != tt.wantLog {
				t.Errorf("googleSyncTTLFromEnv(%q) logged = %v, want %v (log: %q)", tt.raw, gotLog, tt.wantLog, buf.String())
			}
		})
	}
}
