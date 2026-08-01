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
	"net/http"
	"time"

	"backend/shared/config"
)

// defaultBase is the production Firecrawl API host.
const defaultBase = "https://api.firecrawl.dev"

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
// weekly sync job's per-category extraction shape). A 60s timeout: scrape +
// LLM extraction is materially slower than a plain page fetch, and this is
// deliberately never called from a request path — see the design spec's
// "Alternatives considered" for why this isn't live on detail-page view.
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
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading firecrawl response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("firecrawl scrape %s status %d: %s", url, resp.StatusCode, truncate(raw, 800))
	}

	var parsed scrapeResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("decoding firecrawl response: %w", err)
	}
	if !parsed.Success {
		return nil, fmt.Errorf("firecrawl scrape %s: %s", url, parsed.Error)
	}
	return parsed.Data.JSON, nil
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}
