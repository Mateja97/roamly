// Package logging provides the default slog setup every service uses:
// structured JSON to stdout, level from an env var.
package logging

import (
	"log/slog"
	"os"
)

// New returns a JSON slog.Logger. level is parsed with slog.Level.UnmarshalText;
// an empty or invalid value defaults to Info.
func New(level string) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}
