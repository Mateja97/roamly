package main

import (
	"testing"

	"backend/shared/models/activitiessvc"
)

func TestMapCategory(t *testing.T) {
	tests := []struct {
		in   string
		want activitiessvc.Category
	}{
		{"restaurants", activitiessvc.CategoryRestaurants},
		{"restaurants-bakery-dessert", activitiessvc.CategoryRestaurants},
		{"cafes-coffee-shop", activitiessvc.CategoryCafes},
		{"culture-religious-site", activitiessvc.CategoryCulture},
		{"nightlife", activitiessvc.CategoryNightlife},
		{"totally-unknown-thing", activitiessvc.CategoryEntertainment},
		{"", activitiessvc.CategoryEntertainment},
	}
	for _, tt := range tests {
		if got := mapCategory(tt.in); got != tt.want {
			t.Errorf("mapCategory(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestParseRating(t *testing.T) {
	tests := []struct {
		in   string
		want float64
	}{
		{"4.6", 4.6},
		{"", 0},
		{"not-a-number", 0},
	}
	for _, tt := range tests {
		if got := parseRating(tt.in); got != tt.want {
			t.Errorf("parseRating(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestNeedsReview(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"0.4", true},
		{"0.49", true},
		{"0.5", false},
		{"0.6", false},
		{"", false},
		{"bad", false},
	}
	for _, tt := range tests {
		if got := needsReview(tt.in); got != tt.want {
			t.Errorf("needsReview(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}
