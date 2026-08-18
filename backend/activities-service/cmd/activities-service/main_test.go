package main

import (
	"testing"

	"activities-service/internal/service"
)

func TestMaxResolvedPhotosFromEnv(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want int
	}{
		{"unset falls back to default", "", service.DefaultMaxResolvedPhotos},
		{"non-numeric falls back to default", "not-a-number", service.DefaultMaxResolvedPhotos},
		{"zero falls back to default", "0", service.DefaultMaxResolvedPhotos},
		{"negative falls back to default", "-3", service.DefaultMaxResolvedPhotos},
		{"valid positive value passes through", "3", 3},
		{"valid value outside 3-5 still passes through — operator's call", "10", 10},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := maxResolvedPhotosFromEnv(tt.raw); got != tt.want {
				t.Errorf("maxResolvedPhotosFromEnv(%q) = %v, want %v", tt.raw, got, tt.want)
			}
		})
	}
}
