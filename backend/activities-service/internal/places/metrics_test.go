package places_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"activities-service/internal/places"
)

// TestSKUTierForMask pins T1 (places-api-cost-reduction)'s tier derivation:
// the label comes from the fields actually present in the mask, not from
// which call site sent it.
func TestSKUTierForMask(t *testing.T) {
	tests := []struct {
		name string
		mask string
		want places.SKUTier
	}{
		{"essentials-only mask", "places.id,places.displayName,places.location,places.types", places.TierEssentials},
		{"enterprise mask (rating present)", "places.id,places.displayName,places.rating,places.userRatingCount", places.TierEnterprise},
		{"enterprise+atmosphere mask (reviews present)", "rating,userRatingCount,reviews,editorialSummary", places.TierEnterpriseAtmosphere},
		{"pro mask (websiteUri, no enterprise fields)", "places.displayName,places.websiteUri,places.priceRange", places.TierPro},
		{"ids-only mask", "id,name", places.TierIDsOnly},
		{"unrecognized field defaults to essentials", "someBrandNewGoogleField", places.TierEssentials},
		{"dotted subfield bills as its parent", "reviews.authorAttribution", places.TierEnterpriseAtmosphere},
		{"empty mask is ids-only", "", places.TierIDsOnly},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := places.SKUTierForMask(tt.mask); got != tt.want {
				t.Errorf("SKUTierForMask(%q) = %q, want %q", tt.mask, got, tt.want)
			}
		})
	}
}

// TestClient_RecordsCallsByEndpointTierAndCaller pins T1's counting
// contract: every one of the six instrumented methods increments a counter
// keyed by (endpoint, SKU tier, caller path), an Enterprise-mask call is
// labelled Enterprise and an Essentials-only call is not, and a call whose
// every attempt fails is never counted.
func TestClient_RecordsCallsByEndpointTierAndCaller(t *testing.T) {
	fail := false
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/places:searchNearby", func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, `{"places":[]}`)
	})
	mux.HandleFunc("/v1/places:searchText", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"places":[]}`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	ctx := places.WithCaller(context.Background(), places.CallerDiscovery)

	before := places.Count("SearchNearby", places.TierEnterprise, places.CallerDiscovery)
	if _, err := c.SearchNearby(ctx, places.NearbyRequest{IncludedTypes: []string{"beach"}, MaxResults: 20}, places.NearbyFieldMask); err != nil {
		t.Fatalf("SearchNearby: %v", err)
	}
	if got := places.Count("SearchNearby", places.TierEnterprise, places.CallerDiscovery); got != before+1 {
		t.Errorf("SearchNearby Enterprise/discovery count = %d, want %d (NearbyFieldMask carries rating)", got, before+1)
	}

	essentialsBefore := places.Count("SearchText", places.TierEssentials, places.CallerBatchTool)
	batchCtx := places.WithCaller(context.Background(), places.CallerBatchTool)
	if _, err := c.SearchText(batchCtx, "q", "", "places.id,places.displayName"); err != nil {
		t.Fatalf("SearchText: %v", err)
	}
	if got := places.Count("SearchText", places.TierEssentials, places.CallerBatchTool); got != essentialsBefore+1 {
		t.Errorf("SearchText Essentials/batch-tool count = %d, want %d", got, essentialsBefore+1)
	}
	// The Essentials-only call must not have also been tallied as Enterprise.
	if got := places.Count("SearchText", places.TierEnterprise, places.CallerBatchTool); got != 0 {
		t.Errorf("SearchText wrongly counted as Enterprise: %d", got)
	}

	// A call that fails on every attempt (no 429/5xx retry path here — a
	// plain 400 fails immediately) must not be counted.
	fail = true
	failBefore := places.Count("SearchNearby", places.TierEnterprise, places.CallerDiscovery)
	if _, err := c.SearchNearby(ctx, places.NearbyRequest{IncludedTypes: []string{"beach"}, MaxResults: 20}, places.NearbyFieldMask); err == nil {
		t.Fatal("expected error")
	}
	if got := places.Count("SearchNearby", places.TierEnterprise, places.CallerDiscovery); got != failBefore {
		t.Errorf("failed call was counted: got %d, want unchanged %d", got, failBefore)
	}
}

// TestClient_RetriedThenSuccessfulCallCountsOnce pins the "a retry doesn't
// double-count" half of T1's counting contract, using the same 429-then-200
// sequence TestSearchText_RetriesOn429ThenSucceeds already exercises.
func TestClient_RetriedThenSuccessfulCallCountsOnce(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = io.WriteString(w, `{"error":"rate limited"}`)
			return
		}
		_, _ = io.WriteString(w, `{"places":[]}`)
	}))
	defer srv.Close()

	c := places.NewWithBase("k", srv.URL)
	ctx := places.WithCaller(context.Background(), places.CallerBatchTool)
	before := places.Count("SearchText", places.TierIDsOnly, places.CallerBatchTool)

	if _, err := c.SearchText(ctx, "q", "", "id"); err != nil {
		t.Fatalf("SearchText: %v", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 (one retry)", calls)
	}
	if got := places.Count("SearchText", places.TierIDsOnly, places.CallerBatchTool); got != before+1 {
		t.Errorf("count after retry-then-success = %d, want %d (counted once, not per attempt)", got, before+1)
	}
}
