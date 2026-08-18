package places

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestPlaceDetails_TierFollowsSentMask pins the round-3 review bug: placeDetails
// must derive the recorded SKU tier from the fieldMask parameter actually sent
// on the wire, not the package-level detailFieldMask constant. detailFieldMask
// and AuditFieldMask both happen to price at Enterprise+Atmosphere, so no test
// written against the exported PlaceDetails/PlaceDetailsForAudit pair can tell
// the two apart — this white-box test (package places, not places_test) calls
// the unexported placeDetails directly with a mask that prices lower than
// detailFieldMask, to prove the label tracks the real request rather than the
// constant.
func TestPlaceDetails_TierFollowsSentMask(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{}`)
	}))
	defer srv.Close()

	c := NewWithBase("k", srv.URL)
	ctx := WithCaller(context.Background(), CallerBatchTool)

	// Essentials on Place Details, unlike detailFieldMask (Enterprise+Atmosphere).
	const narrowMask = "places.location,places.types"
	before := Count(endpointPlaceDetails, TierEssentials, CallerBatchTool)
	if _, err := c.placeDetails(ctx, "place-1", narrowMask); err != nil {
		t.Fatalf("placeDetails: %v", err)
	}
	if got := Count(endpointPlaceDetails, TierEssentials, CallerBatchTool); got != before+1 {
		t.Errorf("Essentials count for narrow mask = %d, want %d (tier must come from the sent mask, not detailFieldMask)", got, before+1)
	}
}
