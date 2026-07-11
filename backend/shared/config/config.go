// Package config provides tiny env-var loading helpers so every service
// fails fast, at boot, with a clear message when required config is missing.
package config

import (
	"fmt"
	"os"
)

// Require returns the env var value or an error naming the missing key.
func Require(key string) (string, error) {
	v := os.Getenv(key)
	if v == "" {
		return "", fmt.Errorf("required env var %s is not set", key)
	}
	return v, nil
}

// OrDefault returns the env var value, or fallback if unset/empty.
func OrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
