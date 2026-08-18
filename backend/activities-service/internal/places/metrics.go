package places

import (
	"context"
	"log/slog"
	"strings"
	"sync"
)

// SKUTier is the Google Places/Geocoding billing tier a call is priced under
// (T1, places-api-cost-reduction) — the same names Google's own pricing page
// uses, so a log line or test failure reads directly against the bill.
type SKUTier string

const (
	TierIDsOnly              SKUTier = "IDs-Only"
	TierEssentials           SKUTier = "Essentials"
	TierPro                  SKUTier = "Pro"
	TierEnterprise           SKUTier = "Enterprise"
	TierEnterpriseAtmosphere SKUTier = "Enterprise+Atmosphere"
	TierPhotos               SKUTier = "Photos"
)

// CallerPath identifies which product flow triggered a Places/Geocoding
// call. Set on ctx via WithCaller before calling a Client method; every
// instrumented method reads it back when recording the call.
type CallerPath string

const (
	CallerDiscovery    CallerPath = "discovery"
	CallerDetailOpen   CallerPath = "detail-open"
	CallerPhotoResolve CallerPath = "photo-resolve"
	CallerBatchTool    CallerPath = "batch-tool"
	// callerUnset marks a call whose ctx was never tagged with WithCaller —
	// still counted (never dropped), just visibly wrong instead of silently
	// mislabeled as one of the four real paths.
	callerUnset CallerPath = "unset"
)

type callerCtxKey struct{}

// WithCaller tags ctx with the product flow about to issue a Places or
// Geocoding call, so the client's metrics recording can label the call
// without every method taking an extra parameter.
func WithCaller(ctx context.Context, caller CallerPath) context.Context {
	return context.WithValue(ctx, callerCtxKey{}, caller)
}

func callerFrom(ctx context.Context) CallerPath {
	if c, ok := ctx.Value(callerCtxKey{}).(CallerPath); ok {
		return c
	}
	return callerUnset
}

// tierRank orders SKU tiers cheapest to priciest. SKUTierForMask reports the
// most expensive tier any requested field forces, since that's the tier
// Google actually bills the whole call at.
var tierRank = map[SKUTier]int{
	TierIDsOnly:              0,
	TierEssentials:           1,
	TierPro:                  2,
	TierEnterprise:           3,
	TierEnterpriseAtmosphere: 4,
}

// fieldTiers maps each Places API (New) field name to the SKU tier it forces
// a Place Details call into, per Google's data-fields-by-SKU table
// (https://developers.google.com/maps/documentation/places/web-service/data-fields,
// cross-checked live against the page's rendered table — see research.md). A
// field missing here falls back to Essentials in SKUTierForMask rather than
// erroring — the label can lag a brand-new Google field for a release, it
// must never crash a caller over a lookup miss. Extend this table, not
// SKUTierForMask, when Google ships a new field.
var fieldTiers = map[string]SKUTier{
	"id":     TierIDsOnly,
	"name":   TierIDsOnly,
	"photos": TierIDsOnly,

	"formattedAddress":      TierEssentials,
	"location":              TierEssentials,
	"addressComponents":     TierEssentials,
	"shortFormattedAddress": TierEssentials,
	"plusCode":              TierEssentials,
	"postalAddress":         TierEssentials,
	"viewport":              TierEssentials,
	"adrFormatAddress":      TierEssentials,
	"types":                 TierEssentials,

	"displayName":             TierPro,
	"googleMapsUri":           TierPro,
	"primaryType":             TierPro,
	"primaryTypeDisplayName":  TierPro,
	"businessStatus":          TierPro,
	"utcOffsetMinutes":        TierPro,
	"iconMaskBaseUri":         TierPro,
	"iconBackgroundColor":     TierPro,
	"subDestinations":         TierPro,
	"containingPlaces":        TierPro,
	"pureServiceAreaBusiness": TierPro,
	"googleMapsLinks":         TierPro,
	"accessibilityOptions":    TierPro,

	"rating":                       TierEnterprise,
	"userRatingCount":              TierEnterprise,
	"priceRange":                   TierEnterprise,
	"priceLevel":                   TierEnterprise,
	"regularOpeningHours":          TierEnterprise,
	"regularSecondaryOpeningHours": TierEnterprise,
	"currentOpeningHours":          TierEnterprise,
	"currentSecondaryOpeningHours": TierEnterprise,
	"internationalPhoneNumber":     TierEnterprise,
	"nationalPhoneNumber":          TierEnterprise,
	"websiteUri":                   TierEnterprise,

	"reviews":               TierEnterpriseAtmosphere,
	"editorialSummary":      TierEnterpriseAtmosphere,
	"generativeSummary":     TierEnterpriseAtmosphere,
	"goodForChildren":       TierEnterpriseAtmosphere,
	"goodForGroups":         TierEnterpriseAtmosphere,
	"goodForWatchingSports": TierEnterpriseAtmosphere,
	"allowsDogs":            TierEnterpriseAtmosphere,
	"restroom":              TierEnterpriseAtmosphere,
	"outdoorSeating":        TierEnterpriseAtmosphere,
	"liveMusic":             TierEnterpriseAtmosphere,
	"parkingOptions":        TierEnterpriseAtmosphere,
	"servesCoffee":          TierEnterpriseAtmosphere,
	"servesVegetarianFood":  TierEnterpriseAtmosphere,
	"servesBeer":            TierEnterpriseAtmosphere,
	"servesBreakfast":       TierEnterpriseAtmosphere,
	"servesBrunch":          TierEnterpriseAtmosphere,
	"servesCocktails":       TierEnterpriseAtmosphere,
	"servesDessert":         TierEnterpriseAtmosphere,
	"servesDinner":          TierEnterpriseAtmosphere,
	"servesLunch":           TierEnterpriseAtmosphere,
	"servesWine":            TierEnterpriseAtmosphere,
	"menuForChildren":       TierEnterpriseAtmosphere,
	"dineIn":                TierEnterpriseAtmosphere,
	"takeout":               TierEnterpriseAtmosphere,
	"reservable":            TierEnterpriseAtmosphere,
	"curbsidePickup":        TierEnterpriseAtmosphere,
	"delivery":              TierEnterpriseAtmosphere,
	"evChargeOptions":       TierEnterpriseAtmosphere,
	"fuelOptions":           TierEnterpriseAtmosphere,
	"paymentOptions":        TierEnterpriseAtmosphere,
	"routingSummaries":      TierEnterpriseAtmosphere,
}

// searchTierOverrides lists the fields Nearby/Text Search bills one tier
// higher than Place Details does for the identical field name (confirmed
// against Google's live data-fields-by-SKU table, see research.md) — these
// nine location/address/type fields and "photos" are Essentials(-ish) on
// Place Details but Pro on Search. Every other field (including
// "displayName"/"primaryType", which read as basic but are Pro everywhere,
// and every Enterprise/Enterprise+Atmosphere field) prices the same on both,
// so this table only needs the deltas rather than a second full copy of
// fieldTiers — that duplication is exactly what mislabeled T2's narrowed
// mask as Essentials in T1's original review (fixed here). "id"/"name" are
// omitted: Nearby Search bills them Pro while Text Search bills them
// Essentials(IDs Only), but no mask in this codebase isolates id/name
// without a Pro-or-above field alongside them, so the fieldTiers base value
// (IDs Only) already produces the right derived tier for every real call —
// ponytail: split id/name out with its own override if a future mask
// changes that.
var searchTierOverrides = map[string]SKUTier{
	"photos":                TierPro,
	"formattedAddress":      TierPro,
	"location":              TierPro,
	"types":                 TierPro,
	"addressComponents":     TierPro,
	"shortFormattedAddress": TierPro,
	"plusCode":              TierPro,
	"viewport":              TierPro,
	"adrFormatAddress":      TierPro,
	"postalAddress":         TierPro,
}

// SKUTierForMask derives the SKU tier a Places call bills at from the actual
// X-Goog-FieldMask sent and which wire endpoint it was sent to, not a
// per-call-site label — a mask edit moves the label with it automatically
// (T1, places-api-cost-reduction). endpoint must be one of the endpoint*
// constants in places.go; only endpointPlaceDetails skips searchTierOverrides
// (the two Search endpoints, places:searchText and places:searchNearby, both
// use it).
func SKUTierForMask(fieldMask, endpoint string) SKUTier {
	overrides := searchTierOverrides
	if endpoint == endpointPlaceDetails {
		overrides = nil
	}
	tier := TierIDsOnly
	for _, raw := range strings.Split(fieldMask, ",") {
		field := strings.TrimPrefix(strings.TrimSpace(raw), "places.")
		if field == "" {
			continue
		}
		if idx := strings.Index(field, "."); idx >= 0 {
			field = field[:idx] // "reviews.authorAttribution" bills as "reviews"
		}
		t, ok := overrides[field]
		if !ok {
			t, ok = fieldTiers[field]
		}
		if !ok {
			t = TierEssentials
		}
		if tierRank[t] > tierRank[tier] {
			tier = t
		}
	}
	return tier
}

// callKey identifies one (endpoint, tier, caller) combination counters are
// kept per, matching this task's minimum labelling requirement.
type callKey struct {
	Endpoint string
	Tier     SKUTier
	Caller   CallerPath
}

// callMetrics counts billable Places/Geocoding calls in-process. Exported at
// increment time via slog — this service's existing operational-signal
// channel (GO_STANDARDS.md) — rather than a new metrics-server dependency;
// activities-service has no HTTP surface to hang a /metrics endpoint off
// today (see internal/api/server.go's health-service ponytail note). Add a
// scrape endpoint when something needs to poll rather than tail logs.
type callMetrics struct {
	mu     sync.Mutex
	counts map[callKey]int64
}

var metrics = &callMetrics{counts: make(map[callKey]int64)}

// record counts one successful, billable call. Callers must only invoke this
// after a confirmed 2xx — doJSON is the single choke point that does so, so
// a failed call is never counted and a retried-then-successful call counts
// once.
func (m *callMetrics) record(endpoint string, tier SKUTier, caller CallerPath) {
	key := callKey{Endpoint: endpoint, Tier: tier, Caller: caller}
	m.mu.Lock()
	m.counts[key]++
	n := m.counts[key]
	m.mu.Unlock()
	slog.Info("places api call", "endpoint", endpoint, "sku_tier", string(tier), "caller_path", string(caller), "count", n)
}

// Count returns how many times endpoint has been billed at tier for caller
// since process start. Test-only surface — production reads this signal off
// the slog line record emits, not this map.
func Count(endpoint string, tier SKUTier, caller CallerPath) int64 {
	metrics.mu.Lock()
	defer metrics.mu.Unlock()
	return metrics.counts[callKey{Endpoint: endpoint, Tier: tier, Caller: caller}]
}
