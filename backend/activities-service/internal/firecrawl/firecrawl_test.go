package firecrawl

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestClient_ExtractJSON_ParsesResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/scrape" {
			t.Errorf("path = %s, want /v2/scrape", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("Authorization = %q, want %q", got, "Bearer test-key")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"success": true,
			"data": {
				"json": {"treatments": [{"item": "Aroma massage", "price": "€39"}]}
			}
		}`))
	}))
	defer srv.Close()

	c := NewWithBase("test-key", srv.URL)
	got, err := c.ExtractJSON(context.Background(), "https://example-spa.rs", "Extract the treatments menu.", map[string]any{
		"type": "object",
		"properties": map[string]any{
			"treatments": map[string]any{"type": "array"},
		},
	})
	if err != nil {
		t.Fatalf("ExtractJSON() error: %v", err)
	}
	var parsed struct {
		Treatments []struct {
			Item  string `json:"item"`
			Price string `json:"price"`
		} `json:"treatments"`
	}
	if err := json.Unmarshal(got, &parsed); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if len(parsed.Treatments) != 1 || parsed.Treatments[0].Item != "Aroma massage" {
		t.Errorf("parsed = %+v, want one treatment \"Aroma massage\"", parsed)
	}
}

func TestClient_ExtractJSON_SuccessFalse_Errors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success": false, "error": "unable to scrape URL"}`))
	}))
	defer srv.Close()

	c := NewWithBase("test-key", srv.URL)
	_, err := c.ExtractJSON(context.Background(), "https://dead-site.example", "Extract treatments.", map[string]any{"type": "object"})
	if err == nil {
		t.Fatal("ExtractJSON() error = nil, want an error on success:false")
	}
}

// TestClient_ExtractJSON_RetriesOn429WithRetryAfter_ThenSucceeds proves the
// live-observed failure mode (a full weekly batch fires well past Firecrawl's
// per-minute cap) actually recovers inline instead of requiring a second CLI
// run. Retry-After: 0 keeps the test fast while still exercising the
// header-parsing path — a real 429 would carry a real wait.
func TestClient_ExtractJSON_RetriesOn429WithRetryAfter_ThenSucceeds(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) <= 2 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"success": false, "error": "Rate limit exceeded"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success": true, "data": {"json": {"good_to_know": ["Open weekends"]}}}`))
	}))
	defer srv.Close()

	c := NewWithBase("test-key", srv.URL)
	got, err := c.ExtractJSON(context.Background(), "https://example-spa.rs", "Extract good-to-know notes.", map[string]any{"type": "object"})
	if err != nil {
		t.Fatalf("ExtractJSON() error: %v", err)
	}
	if calls.Load() != 3 {
		t.Errorf("calls = %d, want 3 (two 429s then success)", calls.Load())
	}
	if !strings.Contains(string(got), "Open weekends") {
		t.Errorf("got = %s, want the successful third response", got)
	}
}

// TestClient_ExtractJSON_NonTransientStatus_NoRetry proves a real client
// error (bad request, invalid schema, etc.) fails immediately rather than
// burning through maxAttempts of nothing — matches internal/places' and
// internal/tripadvisor's own non-transient contract.
func TestClient_ExtractJSON_NonTransientStatus_NoRetry(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"success": false, "error": "invalid schema"}`))
	}))
	defer srv.Close()

	c := NewWithBase("test-key", srv.URL)
	_, err := c.ExtractJSON(context.Background(), "https://example-spa.rs", "Extract treatments.", map[string]any{"type": "object"})
	if err == nil {
		t.Fatal("ExtractJSON() error = nil, want an error on 400")
	}
	if calls.Load() != 1 {
		t.Errorf("calls = %d, want 1 (400 is non-transient, no retry)", calls.Load())
	}
}

// TestClient_ExtractJSON_ExhaustsRetries_GivesUp proves a persistently
// rate-limited call gives up after maxAttempts rather than retrying forever.
func TestClient_ExtractJSON_ExhaustsRetries_GivesUp(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "0")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"success": false, "error": "Rate limit exceeded"}`))
	}))
	defer srv.Close()

	c := NewWithBase("test-key", srv.URL)
	_, err := c.ExtractJSON(context.Background(), "https://example-spa.rs", "Extract treatments.", map[string]any{"type": "object"})
	if err == nil {
		t.Fatal("ExtractJSON() error = nil, want an error after exhausting retries")
	}
	if calls.Load() != maxAttempts {
		t.Errorf("calls = %d, want maxAttempts (%d)", calls.Load(), maxAttempts)
	}
	if !strings.Contains(err.Error(), "giving up after") {
		t.Errorf("error = %v, want it to mention giving up after exhausting retries", err)
	}
}
