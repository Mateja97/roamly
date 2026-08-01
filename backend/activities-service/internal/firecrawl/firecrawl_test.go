package firecrawl

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
