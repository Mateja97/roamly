package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"activities-service/internal/places"

	"backend/shared/models/activitiessvc"
)

// TestPrewarmGoogle_MergedCallsDropAtLeast30Percent is T8's headline
// acceptance criterion, measured rather than estimated: it runs a full
// PrewarmGoogle sweep through the *real* places.Client (not fakeGooglePlaces,
// which never touches T1's metrics) against an httptest server, then reads
// the actual call count back off T1's own counters (places.Count,
// internal/places/metrics.go) — the same signal an operator reads off
// production logs — rather than trusting the grouping logic's own tally.
//
// Before T8, one call was billed per DiscoveryRow reachable from Google
// (googleDiscoveryRowCount()); after merging, it's one call per
// DiscoveryGroup. The task requires at least a 30% drop.
func TestPrewarmGoogle_MergedCallsDropAtLeast30Percent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/places:searchNearby", "/v1/places:searchText":
			io.WriteString(w, `{"places":[]}`) //nolint:errcheck
		default: // geocode
			io.WriteString(w, `{"status":"ZERO_RESULTS"}`) //nolint:errcheck
		}
	}))
	defer srv.Close()

	client := places.NewWithBase("test-key", srv.URL)
	svc := New(&fakeRepo{syncedAtOut: map[string]time.Time{}}).WithPlaces(client)

	ctx := places.WithCaller(context.Background(), places.CallerDiscovery)
	summary := svc.PrewarmGoogle(ctx, activitiessvc.Point{Lat: 44.81, Lng: 20.46}, 1000)
	if summary.Partial {
		t.Fatalf("summary.Partial = true, want a full sweep (budget must exceed the group count)")
	}

	rowsPreMerge := googleDiscoveryRowCount()
	callsPostMerge := summary.CallsMade

	// Cross-check summary.CallsMade against T1's own counters — the
	// acceptance criterion's "measured from T1's counters, not estimated".
	tier := places.SKUTierForMask(places.NearbyFieldMask, "SearchNearby")
	counted := places.Count("SearchNearby", tier, places.CallerDiscovery) +
		places.Count("SearchTextInArea", tier, places.CallerDiscovery)
	if counted != int64(callsPostMerge) {
		t.Errorf("places.Count() = %d, want summary.CallsMade (%d) — the tally and T1's counters must agree", counted, callsPostMerge)
	}

	if callsPostMerge >= rowsPreMerge {
		t.Fatalf("callsPostMerge = %d, want fewer than the %d pre-merge calls (one per row)", callsPostMerge, rowsPreMerge)
	}
	drop := 1 - float64(callsPostMerge)/float64(rowsPreMerge)
	if drop < 0.30 {
		t.Errorf("calls-per-sweep drop = %.0f%% (from %d rows to %d calls), want at least 30%%", drop*100, rowsPreMerge, callsPostMerge)
	}
	t.Logf("T8 result: %d pre-merge calls -> %d post-merge calls (%.0f%% drop), measured via places.Count", rowsPreMerge, callsPostMerge, drop*100)
}
