package config

import "testing"

func TestRequire(t *testing.T) {
	t.Setenv("FOO_TEST_KEY", "bar")
	v, err := Require("FOO_TEST_KEY")
	if err != nil || v != "bar" {
		t.Fatalf("Require() = %q, %v, want %q, nil", v, err, "bar")
	}

	t.Setenv("MISSING_TEST_KEY", "")
	if _, err := Require("MISSING_TEST_KEY"); err == nil {
		t.Fatal("Require() error = nil, want error for missing key")
	}
}

func TestOrDefault(t *testing.T) {
	t.Setenv("SET_TEST_KEY", "value")
	if got := OrDefault("SET_TEST_KEY", "fallback"); got != "value" {
		t.Errorf("OrDefault() = %q, want %q", got, "value")
	}
	t.Setenv("UNSET_TEST_KEY", "")
	if got := OrDefault("UNSET_TEST_KEY", "fallback"); got != "fallback" {
		t.Errorf("OrDefault() = %q, want %q", got, "fallback")
	}
}
