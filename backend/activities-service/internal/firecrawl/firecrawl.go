// Package firecrawl is the single client for the Firecrawl scrape+extract
// API, used by internal/service's weekly website-sync job (see
// docs/superpowers/specs/2026-08-01-wellness-entertainment-detail-page-design.md)
// to pull Treatments/Upcoming shows/Good-to-know content off a venue's own
// website. No official Go SDK exists (Node/Python/Rust/Java/Elixir only,
// per Firecrawl's docs) — this is a plain REST client, same shape as
// internal/tripadvisor.
package firecrawl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"backend/shared/config"
)

// defaultBase is the production Firecrawl API host.
const defaultBase = "https://api.firecrawl.dev"

// maxAttempts caps retries on a rate-limited (429) or transient (5xx) scrape
// call — same contract as internal/places' and internal/tripadvisor's own
// doJSON retry loops, sized up from their maxAttempts=4 because a per-minute
// rate limit needs tens of seconds to clear, not a few hundred milliseconds.
const maxAttempts = 5

// rateLimitBackoffCap bounds how long a single 429 wait may run — Firecrawl's
// free/low tiers reset in well under a minute, so this is a safety ceiling,
// not the expected wait.
const rateLimitBackoffCap = 65 * time.Second

// Client calls Firecrawl's /v2/scrape endpoint with a JSON-format request —
// scrape and structured extraction in one call. Exactly one http.Client,
// one base URL, one key.
type Client struct {
	http *http.Client
	key  string
	base string
}

// New builds a Client against the production Firecrawl API.
func New(apiKey string) *Client {
	return NewWithBase(apiKey, defaultBase)
}

// NewFromEnv builds a Client reading FIRECRAWL_API_KEY via config.Require,
// the single fail-fast point every call site should use instead of its own
// os.Getenv.
func NewFromEnv() (*Client, error) {
	key, err := config.Require("FIRECRAWL_API_KEY")
	if err != nil {
		return nil, err
	}
	return New(key), nil
}

// NewWithBase is New with the API base URL parameterized, so tests can
// point it at a local httptest server.
func NewWithBase(apiKey, base string) *Client {
	return &Client{http: &http.Client{Timeout: 60 * time.Second}, key: apiKey, base: base}
}

type scrapeRequest struct {
	URL     string   `json:"url"`
	Formats []format `json:"formats"`
}

type format struct {
	Type   string         `json:"type"`
	Prompt string         `json:"prompt,omitempty"`
	Schema map[string]any `json:"schema,omitempty"`
}

type scrapeResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
	Data    struct {
		JSON json.RawMessage `json:"json"`
	} `json:"data"`
}

// ExtractJSON scrapes url and extracts structured content matching schema,
// guided by prompt, in one Firecrawl call. Returns the raw extracted JSON
// object — the caller decodes it into whichever shape it expects (the
// weekly sync job's per-category extraction shape). A 60s per-attempt
// timeout: scrape + LLM extraction is materially slower than a plain page
// fetch, and this is deliberately never called from a request path — see
// the design spec's "Alternatives considered" for why this isn't live on
// detail-page view.
//
// Retries on 429 (rate limit) and 5xx, up to maxAttempts: a full weekly
// batch run fires far more than Firecrawl's per-minute cap in a burst
// (observed live: ~92% of a first unthrottled run's failures were plain 429s
// that a second run mostly recovered on its own, just by re-attempting after
// the window reset) — retrying inline is strictly better than requiring a
// second full CLI pass. A 429 waits for the response's Retry-After header
// when present (that's Firecrawl's own authoritative reset time), falling
// back to jittered exponential backoff sized for a per-minute window when
// it's absent. A 5xx uses the same shorter backoff internal/places' doJSON
// already uses, since a 5xx is usually transient and short-lived, not a
// rate-limit window. Every other status fails immediately, no retry —
// matches internal/places'/internal/tripadvisor's own non-transient
// contract.
func (c *Client) ExtractJSON(ctx context.Context, url, prompt string, schema map[string]any) (json.RawMessage, error) {
	reqBody, err := json.Marshal(scrapeRequest{
		URL: url,
		Formats: []format{
			{Type: "json", Prompt: prompt, Schema: schema},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("building firecrawl request: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(lastErr.(*retryableError).wait):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/v2/scrape", bytes.NewReader(reqBody))
		if err != nil {
			return nil, fmt.Errorf("building firecrawl request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.key)
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.http.Do(req)
		if err != nil {
			return nil, fmt.Errorf("calling firecrawl scrape: %w", err)
		}
		raw, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("reading firecrawl response: %w", err)
		}

		if resp.StatusCode == http.StatusOK {
			var parsed scrapeResponse
			if err := json.Unmarshal(raw, &parsed); err != nil {
				return nil, fmt.Errorf("decoding firecrawl response: %w", err)
			}
			if !parsed.Success {
				return nil, fmt.Errorf("firecrawl scrape %s: %s", url, parsed.Error)
			}
			return parsed.Data.JSON, nil
		}

		statusErr := fmt.Errorf("firecrawl scrape %s status %d: %s", url, resp.StatusCode, truncate(raw, 800))
		if resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < 500 {
			return nil, statusErr // non-transient: fail without retrying
		}
		lastErr = &retryableError{err: statusErr, wait: backoffFor(resp.StatusCode, resp.Header, attempt)}
	}
	return nil, fmt.Errorf("giving up after %d attempts: %w", maxAttempts, lastErr.(*retryableError).err)
}

// retryableError pairs a transient failure with how long to wait before the
// next attempt, computed once (at the point the response is seen) so the
// retry loop's sleep above doesn't need the response/headers in scope.
type retryableError struct {
	err  error
	wait time.Duration
}

func (e *retryableError) Error() string { return e.err.Error() }

// backoffFor picks the wait before the next attempt. A 429 prefers the
// server's own Retry-After header — Firecrawl's authoritative reset time —
// over any guess; absent that, jittered backoff scaled for a per-minute
// window (a plain doubling from places.go's 100ms base would still be under
// a second by attempt 4, nowhere near long enough to clear a per-minute
// cap). A 5xx keeps places.go's original short backoff, since a 5xx is
// usually transient and short-lived, not a rate-limit window.
func backoffFor(status int, headers http.Header, attempt int) time.Duration {
	if status == http.StatusTooManyRequests {
		if wait, ok := retryAfter(headers); ok {
			if wait > rateLimitBackoffCap {
				return rateLimitBackoffCap
			}
			return wait
		}
		base := time.Duration(1<<attempt) * 3 * time.Second
		if base > rateLimitBackoffCap {
			base = rateLimitBackoffCap
		}
		return time.Duration(rand.Int63n(int64(base)))
	}
	// ponytail: fixed base + full jitter, no need for a backoff library at this call volume.
	base := time.Duration(1<<attempt) * 100 * time.Millisecond
	return time.Duration(rand.Int63n(int64(base)))
}

// retryAfter parses the standard Retry-After header (seconds form only —
// Firecrawl's own errors are always a plain integer, never the HTTP-date
// form the RFC also allows). false when absent or unparseable, so the
// caller falls back to backoff instead of trusting a zero-value wait.
func retryAfter(headers http.Header) (time.Duration, bool) {
	raw := headers.Get("Retry-After")
	if raw == "" {
		return 0, false
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 0 {
		return 0, false
	}
	return time.Duration(seconds) * time.Second, true
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}
