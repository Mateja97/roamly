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
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
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
	key := os.Getenv("GOOGLE_MAPS_API_KEY")
	if key == "" {
		logger.Error("startup failed", "error", "GOOGLE_MAPS_API_KEY is required")
		os.Exit(1)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	var resolved []resolvedPhoto
	for _, a := range catalog {
		photo, err := resolveOne(client, key, a)
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

// resolveOne does the two live Places API (New) calls: Text Search for the
// place + its first photo's resource name and attribution, then the photo
// media endpoint with skipHttpRedirect=true to get the final, key-free
// photoUri (never the keyed media URL itself — see activities.proto's
// Photo doc comment on why the key must not end up in a stored URL).
func resolveOne(client *http.Client, key string, a seedActivity) (*resolvedPhoto, error) {
	name, author, authorLink, err := searchFirstPhoto(client, key, a.query)
	if err != nil {
		return nil, fmt.Errorf("searching %q: %w", a.query, err)
	}

	photoURI, err := mediaURI(client, key, name)
	if err != nil {
		return nil, fmt.Errorf("resolving photo media for %q: %w", a.query, err)
	}

	return &resolvedPhoto{title: a.title, url: photoURI, author: author, authorLink: authorLink}, nil
}

type searchTextResponse struct {
	Places []struct {
		Photos []struct {
			Name               string `json:"name"`
			AuthorAttributions []struct {
				DisplayName string `json:"displayName"`
				URI         string `json:"uri"`
			} `json:"authorAttributions"`
		} `json:"photos"`
	} `json:"places"`
}

func searchFirstPhoto(client *http.Client, key, query string) (name, author, authorLink string, err error) {
	body, err := json.Marshal(map[string]string{"textQuery": query})
	if err != nil {
		return "", "", "", fmt.Errorf("encoding request: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, "https://places.googleapis.com/v1/places:searchText", bytes.NewReader(body))
	if err != nil {
		return "", "", "", fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", key)
	req.Header.Set("X-Goog-FieldMask", "places.photos")

	var parsed searchTextResponse
	if err := doJSON(client, req, &parsed); err != nil {
		return "", "", "", err
	}
	if len(parsed.Places) == 0 || len(parsed.Places[0].Photos) == 0 {
		return "", "", "", fmt.Errorf("no place/photo found")
	}
	photo := parsed.Places[0].Photos[0]
	if len(photo.AuthorAttributions) > 0 {
		author = photo.AuthorAttributions[0].DisplayName
		authorLink = photo.AuthorAttributions[0].URI
	}
	return photo.Name, author, authorLink, nil
}

type mediaResponse struct {
	PhotoURI string `json:"photoUri"`
}

func mediaURI(client *http.Client, key, photoName string) (string, error) {
	url := fmt.Sprintf("https://places.googleapis.com/v1/%s/media?maxWidthPx=800&skipHttpRedirect=true&key=%s", photoName, key)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("building request: %w", err)
	}

	var parsed mediaResponse
	if err := doJSON(client, req, &parsed); err != nil {
		return "", err
	}
	if parsed.PhotoURI == "" {
		return "", fmt.Errorf("media response missing photoUri")
	}
	return parsed.PhotoURI, nil
}

// doJSON runs req and JSON-decodes a 200 response body into out; a non-200
// status becomes an error carrying the response body (Google's error
// responses are JSON error objects, useful as-is in the log line callers
// wrap this with).
func doJSON(client *http.Client, req *http.Request, out any) error {
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("calling %s: %w", req.URL.Path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s status %d: %s", req.URL.Path, resp.StatusCode, raw)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	return nil
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
