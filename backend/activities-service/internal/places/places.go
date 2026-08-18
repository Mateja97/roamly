// Package places is the single client for the Google Places API (New),
// consolidating what used to be two copy-pasted HTTP clients
// (internal/googlephotos and cmd/scrapecity's private client). It owns the
// API key, the http.Client, the base URL, and the retry/backoff policy, so a
// change to any of those happens once. Mostly build/seed-time ingestion
// tooling; ResolvePhotos is the one deliberate exception — the live,
// per-request call activities-service's GetActivityPhotos RPC makes (T2).
// Callers on that path must wrap ctx with a short, request-scoped timeout of
// their own; this package's http.Client timeout (below) is sized for a batch
// tool, not a live request.
package places

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"time"

	"activities-service/internal/placesmap"

	"backend/shared/config"
	"backend/shared/models/activitiessvc"
)

// ErrNoPhoto is returned by FirstPhoto when the Places Text Search result has
// no place or no photo to resolve.
var ErrNoPhoto = errors.New("no place/photo found")

// defaultBase is the production Places API (New) host.
const defaultBase = "https://places.googleapis.com"

// defaultGeocodeBase is the production Geocoding API host — a different host,
// protocol shape (GET, key as a query param, status field in the body) and
// product from Places (New) above. See ReverseGeocodeCity.
const defaultGeocodeBase = "https://maps.googleapis.com"

// detailFieldMask selects the live atmosphere/review fields PlaceDetails
// needs for BuildLiveDetails (T1, places-live-details) — distinct from
// scrapecity's scrape mask (cmd/scrapecity/main.go's fieldMask), which feeds
// discovery and is unchanged by this. This mask sits in the Enterprise /
// Enterprise+Atmosphere SKU tiers (reviews, editorialSummary, priceLevel,
// amenities) and is never persisted (Places Terms §14.3) — fetched fresh on
// every detail-page open.
const detailFieldMask = "rating,userRatingCount,reviews,reviews.authorAttribution," +
	"editorialSummary,generativeSummary,priceLevel,priceRange,regularOpeningHours," +
	"primaryTypeDisplayName,websiteUri,googleMapsUri,goodForChildren,goodForGroups," +
	"allowsDogs,restroom,outdoorSeating,liveMusic,parkingOptions,accessibilityOptions," +
	"servesCoffee,servesVegetarianFood,menuForChildren,dineIn,takeout,reservable"

// maxAttempts caps retries on transient (429/5xx) failures. Small and fixed:
// this is a seed-time tool, not a service under load.
const maxAttempts = 4

// Client calls the Google Places API (New): text search + photo media
// resolution. Exactly one http.Client, one base URL, one key.
type Client struct {
	http *http.Client
	key  string
	base string
	// geocodeBase is the Geocoding API host ReverseGeocodeCity calls. Set
	// from the same base argument NewWithBase receives, so one httptest
	// server can stand in for both APIs in tests.
	geocodeBase string
}

// New builds a Client against the production Places API and the production
// Geocoding API. NewWithBase points geocodeBase at the same base as Places
// (so a single httptest server can serve both in tests); production needs
// the two on separate hosts, so New corrects geocodeBase after the fact.
func New(apiKey string) *Client {
	c := NewWithBase(apiKey, defaultBase)
	c.geocodeBase = defaultGeocodeBase
	return c
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
	return &Client{http: &http.Client{Timeout: 20 * time.Second}, key: apiKey, base: base, geocodeBase: base}
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

// NearbyFieldMask selects the place fields type-driven discovery needs.
// Deliberately narrow: hours, price and venue type are not storable under
// Places Terms §14.3 and are fetched live on detail view instead, so paying
// for them here would be a no-op (the same trim scrapecity's fieldMask got).
// addressComponents is in the same SKU tier as the rest of this mask (no
// extra cost); City/Country are no longer derived from it (see
// placesmap.Place.AddressComponents' doc — that's ReverseGeocodeCity's job
// now), but it costs nothing to keep requesting.
const NearbyFieldMask = "places.id,places.displayName,places.location," +
	"places.formattedAddress,places.rating,places.userRatingCount," +
	"places.googleMapsUri,places.photos,places.primaryType,places.types," +
	"places.addressComponents"

// TripadvisorSubtypeFieldMask selects only the fields
// Activities.ResolveTripadvisorSubtype reads off its SearchTextInArea match:
// id, displayName (identity check), primaryType/types (subtype
// classification) and location. Deliberately excludes rating/userRatingCount
// — the fields that push Text Search into the Enterprise tier — since the
// resolve never reads either (T2, places-api-cost-reduction).
const TripadvisorSubtypeFieldMask = "places.id,places.displayName,places.location," +
	"places.primaryType,places.types"

// NearbyRequest is one searchNearby call's inputs. RadiusM must be <= 50000
// (the API's documented ceiling); MaxResults is clamped to 1..20 by the API,
// which returns no pagination token — 20 per call is the hard ceiling, which
// is why discovery issues one call per subtype rather than one per category.
type NearbyRequest struct {
	Lat, Lng      float64
	RadiusM       float64
	IncludedTypes []string
	MaxResults    int
}

// SearchNearby runs one Places Nearby Search restricted to a circle and to
// includedTypes. Unlike SearchText, the circle is a hard restriction rather
// than a bias, so results cannot drift outside the requested area.
func (c *Client) SearchNearby(ctx context.Context, req NearbyRequest, fieldMask string) ([]placesmap.Place, error) {
	body, err := json.Marshal(map[string]any{
		"includedTypes":  req.IncludedTypes,
		"maxResultCount": req.MaxResults,
		"rankPreference": "POPULARITY",
		"locationRestriction": map[string]any{
			"circle": map[string]any{
				"center": map[string]any{"latitude": req.Lat, "longitude": req.Lng},
				"radius": req.RadiusM,
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("encoding nearby search body: %w", err)
	}

	var parsed struct {
		Places []placesmap.Place `json:"places"`
	}
	err = c.doJSON(ctx, http.MethodPost, c.base+"/v1/places:searchNearby", body, map[string]string{
		"Content-Type":     "application/json",
		"X-Goog-Api-Key":   c.key,
		"X-Goog-FieldMask": fieldMask,
	}, &parsed)
	if err != nil {
		return nil, fmt.Errorf("nearby search for %v: %w", req.IncludedTypes, err)
	}
	return parsed.Places, nil
}

// SearchTextInArea runs a Text Search bounded to a rectangle around
// (lat, lng). It exists for the handful of discovery rows whose subtype has
// no Table A type and must fall back to a phrase.
//
// A rectangle rather than a circle because Text Search's locationRestriction
// accepts only rectangles — its circle form is locationBias, a soft hint that
// results routinely escape. That softness is exactly how "Tara National
// Park", 200 km away, ended up in Belgrade's nature rows, so the phrase
// fallback gets the hardest bound the endpoint offers.
func (c *Client) SearchTextInArea(ctx context.Context, query string, lat, lng, radiusKM float64, fieldMask string) ([]placesmap.Place, error) {
	// Degrees per km: latitude is ~111 km/deg everywhere; longitude shrinks
	// by cos(latitude).
	const kmPerDegreeLat = 111.0
	dLat := radiusKM / kmPerDegreeLat
	dLng := radiusKM / (kmPerDegreeLat * math.Cos(lat*math.Pi/180))

	body, err := json.Marshal(map[string]any{
		"textQuery":           query,
		"pageSize":            20,
		"strictTypeFiltering": true,
		"locationRestriction": map[string]any{
			"rectangle": map[string]any{
				"low":  map[string]any{"latitude": lat - dLat, "longitude": lng - dLng},
				"high": map[string]any{"latitude": lat + dLat, "longitude": lng + dLng},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("encoding area text search body: %w", err)
	}

	var parsed SearchResult
	err = c.doJSON(ctx, http.MethodPost, c.base+"/v1/places:searchText", body, map[string]string{
		"Content-Type":     "application/json",
		"X-Goog-Api-Key":   c.key,
		"X-Goog-FieldMask": fieldMask,
	}, &parsed)
	if err != nil {
		return nil, fmt.Errorf("area text search for %q: %w", query, err)
	}
	return parsed.Places, nil
}

// ReverseGeocodeCity resolves a coordinate to an English city and country via
// the Geocoding API.
//
// Called once per sync cell, never per venue. Deriving city per venue from
// Places' own addressComponents fragmented one city into eight strings in a
// live Belgrade sweep (Beograd 225, Belgrade 80, Београд 4, Novi Beograd 3,
// …), because `locality` carries the local name and sometimes a
// sub-municipality. Places ignores languageCode for that component; Geocoding
// honours language=en, so this is the only call that yields a stable name.
//
// A ZERO_RESULTS answer (mid-ocean, unnamed area) is an empty result, not an
// error: the caller falls back to per-venue extraction.
func (c *Client) ReverseGeocodeCity(ctx context.Context, lat, lng float64) (string, string, error) {
	url := fmt.Sprintf("%s/maps/api/geocode/json?latlng=%f,%f&result_type=locality&language=en&key=%s",
		c.geocodeBase, lat, lng, c.key)

	var parsed struct {
		Status       string `json:"status"`
		ErrorMessage string `json:"error_message"`
		Results      []struct {
			AddressComponents []struct {
				LongName string   `json:"long_name"`
				Types    []string `json:"types"`
			} `json:"address_components"`
		} `json:"results"`
	}
	if err := c.doJSON(ctx, http.MethodGet, url, nil, nil, &parsed); err != nil {
		return "", "", fmt.Errorf("reverse geocoding %f,%f: %w", lat, lng, err)
	}
	switch parsed.Status {
	case "OK":
	case "ZERO_RESULTS":
		slog.Info("reverse geocode zero results", "lat", lat, "lng", lng)
		return "", "", nil
	default:
		return "", "", fmt.Errorf("reverse geocoding %f,%f: %s: %s", lat, lng, parsed.Status, parsed.ErrorMessage)
	}
	if len(parsed.Results) == 0 {
		return "", "", nil
	}

	var city, country string
	for _, comp := range parsed.Results[0].AddressComponents {
		for _, t := range comp.Types {
			switch t {
			case "locality":
				city = comp.LongName
			case "country":
				country = comp.LongName
			}
		}
	}
	return city, country, nil
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

// FirstPhoto resolves the first Google Places photo for query into a
// key-free, stored-safe URL plus attribution. Returns ErrNoPhoto when the
// place has no photo.
func (c *Client) FirstPhoto(ctx context.Context, query string) (activitiessvc.Photo, error) {
	res, err := c.SearchText(ctx, query, "", "places.photos")
	if err != nil {
		return activitiessvc.Photo{}, err
	}
	if len(res.Places) == 0 || len(res.Places[0].Photos) == 0 {
		return activitiessvc.Photo{}, ErrNoPhoto
	}
	photo := res.Places[0].Photos[0]
	var author, authorLink string
	if len(photo.AuthorAttributions) > 0 {
		author = photo.AuthorAttributions[0].DisplayName
		authorLink = photo.AuthorAttributions[0].URI
	}
	uri, err := c.PhotoMediaURL(ctx, photo.Name)
	if err != nil {
		return activitiessvc.Photo{}, err
	}
	return activitiessvc.Photo{URL: uri, Author: author, AuthorLink: authorLink, Provider: activitiessvc.ProviderGoogle}, nil
}

// placePhotoRef is the subset of a Place Details response's photos[] entry
// ResolvePhotos needs — same shape as placesmap.Place's inline Photos field,
// duplicated here rather than imported to keep places' only dependency on
// placesmap (photoURIs' domain-mapping package) one-directional and small.
type placePhotoRef struct {
	Name               string `json:"name"`
	AuthorAttributions []struct {
		DisplayName string `json:"displayName"`
		URI         string `json:"uri"`
	} `json:"authorAttributions"`
}

// ResolvePhotos resolves up to limit photos for a place already known by its
// stable place_id: one Place Details call (fieldMask=photos, free) lists the
// place's photo resource names, then one metered PhotoMediaURL call per
// photo up to limit. Unlike FirstPhoto, this needs no Text Search — the
// caller already has place_id from a prior scrape.
func (c *Client) ResolvePhotos(ctx context.Context, placeID string, limit int) ([]activitiessvc.Photo, error) {
	url := fmt.Sprintf("%s/v1/places/%s", c.base, placeID)
	var parsed struct {
		Photos []placePhotoRef `json:"photos"`
	}
	if err := c.doJSON(ctx, http.MethodGet, url, nil, map[string]string{
		"X-Goog-Api-Key":   c.key,
		"X-Goog-FieldMask": "photos",
	}, &parsed); err != nil {
		return nil, fmt.Errorf("fetching place %s photos: %w", placeID, err)
	}

	out := make([]activitiessvc.Photo, 0, min(len(parsed.Photos), limit))
	for _, ph := range parsed.Photos {
		if len(out) >= limit {
			break
		}
		uri, err := c.PhotoMediaURL(ctx, ph.Name)
		if err != nil || uri == "" {
			continue // one bad photo doesn't sink the rest, same rule as scrapecity's photoURIs
		}
		var author, authorLink string
		if len(ph.AuthorAttributions) > 0 {
			author = ph.AuthorAttributions[0].DisplayName
			authorLink = ph.AuthorAttributions[0].URI
		}
		out = append(out, activitiessvc.Photo{URL: uri, Author: author, AuthorLink: authorLink, Provider: activitiessvc.ProviderGoogle})
	}
	return out, nil
}

// PlaceDetails fetches the live, on-view-only fields for placeID (rating,
// reviews, editorial summary, price, hours, amenities) via one Place Details
// call — the T2 live-merge caller's data source for BuildLiveDetails. Per the
// package doc comment, this is a live, per-request call: the caller must wrap
// ctx with its own short, request-scoped timeout; PlaceDetails itself just
// takes ctx and respects it. Never cached, never persisted downstream
// (Places Terms §14.3).
func (c *Client) PlaceDetails(ctx context.Context, placeID string) (placesmap.PlaceDetail, error) {
	url := fmt.Sprintf("%s/v1/places/%s", c.base, placeID)
	var parsed placesmap.PlaceDetail
	if err := c.doJSON(ctx, http.MethodGet, url, nil, map[string]string{
		"X-Goog-Api-Key":   c.key,
		"X-Goog-FieldMask": detailFieldMask,
	}, &parsed); err != nil {
		return placesmap.PlaceDetail{}, fmt.Errorf("fetching place %s details: %w", placeID, err)
	}
	return parsed, nil
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
