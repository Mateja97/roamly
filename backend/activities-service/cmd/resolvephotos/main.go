// Command resolvephotos is a build-time-only maintenance tool: given a
// Places API (New) key with the Places API enabled, it resolves each
// seeded activity's title to a Google Place, takes its first photo, and
// prints a SQL UPDATE a maintainer reviews and applies as a follow-up
// migration. It is never run at request time (see 0004_photos.sql /
// GO_STANDARDS.md's "seed/build time, not live" rule) and is not wired
// into activities-service's own startup path.
//
// Usage: GOOGLE_MAPS_API_KEY=... go run ./cmd/resolvephotos
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"activities-service/internal/places"
)

// seedActivity is the subset of 0002_seed.sql's catalog this tool needs: a
// search query specific enough to find the right place, and the title used
// as the UPDATE statement's WHERE key.
type seedActivity struct {
	title string
	query string // Places Text Search query, e.g. "Colosseum, Rome, Italy"
}

// catalog mirrors 0002_seed.sql's titles. Kept in sync by hand — this is a
// fixed, hand-seeded catalog (see engineering-notes.md), not a generic
// place-resolution service.
var catalog = []seedActivity{
	{"Skadarlija Food Walk", "Skadarlija, Belgrade, Serbia"},
	{"Belgrade Fortress & Kalemegdan Park", "Belgrade Fortress, Serbia"},
	{"Ada Ciganlija Lake Walk", "Ada Ciganlija, Belgrade, Serbia"},
	{"Street Art Tour Savamala", "Savamala, Belgrade, Serbia"},
	{"Kayaking on the Sava", "Sava river, Belgrade, Serbia"},
	{"Belgrade Spa & Wellness Day", "Belgrade Serbia spa"},
	{"Zemun Riverside Cycling", "Zemun, Belgrade, Serbia"},
	{"Colosseum Guided Tour", "Colosseum, Rome, Italy"},
	{"Eiffel Tower Sunset Picnic", "Eiffel Tower, Paris, France"},
	{"Shibuya Street Food Crawl", "Shibuya, Tokyo, Japan"},
	{"Central Park Bike Tour", "Central Park, New York, United States"},
	{"Sagrada Familia Art Walk", "Sagrada Familia, Barcelona, Spain"},
}

type resolvedPhoto struct {
	title      string
	url        string
	author     string
	authorLink string
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	client, err := places.NewFromEnv()
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}

	var resolved []resolvedPhoto
	for _, a := range catalog {
		photo, err := resolveOne(client, a)
		if err != nil {
			// An activity whose photo can't be resolved is skipped, not
			// faked with a placeholder — same fallback rule the client
			// applies for an unresolved photo.
			logger.Warn("skipping unresolved activity", "title", a.title, "error", err)
			continue
		}
		resolved = append(resolved, *photo)
	}

	fmt.Print(formatUpdateSQL(resolved))
}

// resolveOne does the two live Places API (New) calls via the places client:
// Text Search for the place + its first photo's resource name and
// attribution, then the photo media endpoint with skipHttpRedirect=true to
// get the final, key-free photoUri (never the keyed media URL itself — see
// activities.proto's Photo doc comment on why the key must not end up in a
// stored URL).
func resolveOne(client *places.Client, a seedActivity) (*resolvedPhoto, error) {
	photo, err := client.FirstPhoto(context.Background(), a.query)
	if err != nil {
		return nil, fmt.Errorf("resolving photo for %q: %w", a.query, err)
	}
	return &resolvedPhoto{title: a.title, url: photo.URL, author: photo.Author, authorLink: photo.AuthorLink}, nil
}

// formatUpdateSQL is the pure part of this tool: given resolved photos,
// build the SQL a maintainer reviews and saves as a new migration file.
// Each activity gets a single-photo array; escaping only needs to handle
// the single quotes JSON/URLs can carry.
func formatUpdateSQL(photos []resolvedPhoto) string {
	var b strings.Builder
	for _, p := range photos {
		photoJSON, _ := json.Marshal([]map[string]string{{"url": p.url, "author": p.author, "author_link": p.authorLink}})
		fmt.Fprintf(&b, "UPDATE activities SET photos = %s WHERE title = %s;\n",
			sqlQuote(string(photoJSON))+"::jsonb", sqlQuote(p.title))
	}
	return b.String()
}

func sqlQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
