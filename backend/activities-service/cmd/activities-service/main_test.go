package main

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"activities-service/internal/service"
)

func TestMaxResolvedPhotosFromEnv(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int
		wantLog bool
	}{
		{"unset falls back to default silently", "", service.DefaultMaxResolvedPhotos, false},
		{"non-numeric falls back to default and logs", "not-a-number", service.DefaultMaxResolvedPhotos, true},
		{"zero falls back to default and logs", "0", service.DefaultMaxResolvedPhotos, true},
		{"negative falls back to default and logs", "-3", service.DefaultMaxResolvedPhotos, true},
		{"valid positive value passes through", "3", 3, false},
		{"valid value outside 3-5 still passes through — operator's call", "10", 10, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			logger := slog.New(slog.NewTextHandler(&buf, nil))

			if got := maxResolvedPhotosFromEnv(tt.raw, logger); got != tt.want {
				t.Errorf("maxResolvedPhotosFromEnv(%q) = %v, want %v", tt.raw, got, tt.want)
			}

			gotLog := strings.Contains(buf.String(), "invalid MAX_RESOLVED_PHOTOS")
			if gotLog != tt.wantLog {
				t.Errorf("maxResolvedPhotosFromEnv(%q) logged = %v, want %v (log: %q)", tt.raw, gotLog, tt.wantLog, buf.String())
			}
		})
	}
}
