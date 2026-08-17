package service

import "testing"

// TestScraperOwnedFieldsAreClassified is the other half of the drift guard
// in renderable_drift_test.go. That guard proves mapper-emitted keys ⊆
// KnownDetailKeys (a key placesmap.BuildLiveDetails emits is never
// unclassified); this asserts the reverse direction for websitesync's own
// output — every key in scraperOwnedFields (websitesync.go, same package, so
// no export needed) is classified by KnownDetailKeys. Without this, a
// websitesync run can silently fill a key (e.g. sport's what_to_bring) the
// scorer doesn't know how to credit, scoring the row 0 and drafting it
// despite rendering fine — exactly the failure finding 1 describes.
func TestScraperOwnedFieldsAreClassified(t *testing.T) {
	known := map[string]bool{}
	for _, k := range KnownDetailKeys() {
		known[k] = true
	}
	for _, fields := range scraperOwnedFields {
		for _, k := range fields {
			if !known[k] {
				t.Errorf("scraperOwnedFields carries details key %q, but service.KnownDetailKeys() does not classify it — add it to bodyBlockKeys or presentationalKeys in renderable.go", k)
			}
		}
	}
}
