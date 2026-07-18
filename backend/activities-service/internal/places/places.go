// Package places is the single client for the Google Places API (New),
// consolidating what used to be two copy-pasted HTTP clients
// (internal/googlephotos and cmd/scrapecity's private client). It owns the
// API key, the http.Client, the base URL, and the retry/backoff policy, so a
// change to any of those happens once. Build/seed-time ingestion tooling
// only — never called on the live gRPC path.
package places

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"

	"activities-service/internal/placesmap"

	"backend/shared/config"
)

// defaultBase is the production Places API (New) host.
const defaultBase = "https://places.googleapis.com"

// maxAttempts caps retries on transient (429/5xx) failures. Small and fixed:
// this is a seed-time tool, not a service under load.
const maxAttempts = 4

// Client calls the Google Places API (New): text search + photo media
// resolution. Exactly one http.Client, one base URL, one key.
type Client struct {
	http *http.Client
	key  string
	base string
}

// New builds a Client against the production Places API.
func New(apiKey string) *Client {
	return NewWithBase(apiKey, defaultBase)
}

// NewFromEnv builds a Client reading GOOGLE_MAPS_API_KEY via config.Require,
// the single fail-fast point every call site should use instead of its own
// os.Getenv.
func NewFromEnv() (*Client, error) {
	key, err := config.Require("GOOGLE_MAPS_API_KEY")
	if err != nil {
		return nil, err
	}
	return New(key), nil
}

// NewWithBase is New with the Places API base URL parameterized, so tests can
// point it at a local httptest server (matches the prior
// googlephotos.FirstPhotoWithBase seam).
func NewWithBase(apiKey, base string) *Client {
	return &Client{http: &http.Client{Timeout: 20 * time.Second}, key: apiKey, base: base}
}

// SearchResult is one page of a Places Text Search.
type SearchResult struct {
	Places        []placesmap.Place `json:"places"`
	NextPageToken string            `json:"nextPageToken"`
}

// SearchText runs one page of a Places Text Search for query, using
// fieldMask to select which place fields come back (callers vary: a photo
// lookup only needs "places.photos", scrapecity needs the full set). pageToken
// is "" for the first page; SearchResult.NextPageToken (if non-empty) fetches
// the next page.
func (c *Client) SearchText(ctx context.Context, query, pageToken, fieldMask string) (SearchResult, error) {
	reqBody := map[string]any{"textQuery": query, "pageSize": 20}
	if pageToken != "" {
		reqBody["pageToken"] = pageToken
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return SearchResult{}, fmt.Errorf("encoding search body: %w", err)
	}

	var parsed SearchResult
	err = c.doJSON(ctx, http.MethodPost, c.base+"/v1/places:searchText", body, map[string]string{
		"Content-Type":     "application/json",
		"X-Goog-Api-Key":   c.key,
		"X-Goog-FieldMask": fieldMask,
	}, &parsed)
	if err != nil {
		return SearchResult{}, err
	}
	return parsed, nil
}

// PhotoMediaURL resolves a Places photo resource name (e.g.
// "places/X/photos/Y") into the final, key-free photoUri. skipHttpRedirect=true
// makes Places return the URL in the JSON body instead of a redirect, so the
// key never ends up in a stored URL.
func (c *Client) PhotoMediaURL(ctx context.Context, photoName string) (string, error) {
	url := fmt.Sprintf("%s/v1/%s/media?maxWidthPx=800&skipHttpRedirect=true&key=%s", c.base, photoName, c.key)
	var parsed struct {
		PhotoURI string `json:"photoUri"`
	}
	if err := c.doJSON(ctx, http.MethodGet, url, nil, nil, &parsed); err != nil {
		return "", err
	}
	if parsed.PhotoURI == "" {
		return "", fmt.Errorf("media response missing photoUri")
	}
	return parsed.PhotoURI, nil
}

// doJSON sends one request, retrying on 429/5xx with capped, jittered
// backoff (non-transient errors, including other 4xx, return immediately),
// and JSON-decodes a 2xx body into out.
func (c *Client) doJSON(ctx context.Context, method, url string, body []byte, headers map[string]string, out any) error {
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			// ponytail: fixed base + full jitter, no need for a backoff library at this call volume.
			backoff := time.Duration(1<<attempt) * 100 * time.Millisecond
			select {
			case <-time.After(time.Duration(rand.Int63n(int64(backoff)))):
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		var reqBody io.Reader
		if body != nil {
			reqBody = bytes.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
		if err != nil {
			return fmt.Errorf("building request: %w", err)
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := c.http.Do(req)
		if err != nil {
			return fmt.Errorf("calling %s: %w", req.URL.Path, err)
		}
		raw, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return fmt.Errorf("reading response: %w", err)
		}

		if resp.StatusCode == http.StatusOK {
			if err := json.Unmarshal(raw, out); err != nil {
				return fmt.Errorf("decoding response: %w", err)
			}
			return nil
		}

		lastErr = fmt.Errorf("%s status %d: %s", req.URL.Path, resp.StatusCode, truncate(raw, 800))
		if resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < 500 {
			return lastErr // non-transient: fail without retrying
		}
	}
	return fmt.Errorf("giving up after %d attempts: %w", maxAttempts, lastErr)
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n])
}
