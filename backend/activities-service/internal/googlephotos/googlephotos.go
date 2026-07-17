// Package googlephotos resolves the first Google Places photo for a text
// query into a key-free, stored-safe URL plus attribution. It wraps the two
// live Places API (New) calls: Text Search for the place + its first photo's
// resource name and attribution, then the photo media endpoint with
// skipHttpRedirect=true to get the final, key-free photoUri (never the keyed
// media URL itself — see activitiessvc.Photo's doc comment on why the key
// must not end up in a stored URL).
//
// This is a build-time/seed-time helper (see resolvephotos and the future
// per-city ingestion backfill), never called at request time.
package googlephotos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"backend/shared/models/activitiessvc"
)

// ErrNoPhoto is returned when the Places Text Search result has no place or
// no photo to resolve.
var ErrNoPhoto = errors.New("no place/photo found")

// FirstPhoto resolves the first Google Places photo for query into a
// key-free, stored-safe URL plus attribution. Returns ErrNoPhoto when the
// place has no photo.
func FirstPhoto(ctx context.Context, client *http.Client, apiKey, query string) (activitiessvc.Photo, error) {
	return FirstPhotoWithBase(ctx, client, apiKey, query, "https://places.googleapis.com")
}

// FirstPhotoWithBase is FirstPhoto with the Places API base URL
// parameterized, so tests can point it at a local httptest server.
func FirstPhotoWithBase(ctx context.Context, client *http.Client, apiKey, query, base string) (activitiessvc.Photo, error) {
	name, author, authorLink, err := searchFirstPhoto(ctx, client, apiKey, query, base)
	if err != nil {
		return activitiessvc.Photo{}, err
	}
	uri, err := mediaURI(ctx, client, apiKey, name, base)
	if err != nil {
		return activitiessvc.Photo{}, err
	}
	return activitiessvc.Photo{URL: uri, Author: author, AuthorLink: authorLink}, nil
}

type searchTextResponse struct {
	Places []struct {
		Photos []struct {
			Name               string `json:"name"`
			AuthorAttributions []struct {
				DisplayName string `json:"displayName"`
				URI         string `json:"uri"`
			} `json:"authorAttributions"`
		} `json:"photos"`
	} `json:"places"`
}

func searchFirstPhoto(ctx context.Context, client *http.Client, key, query, base string) (name, author, authorLink string, err error) {
	body, err := json.Marshal(map[string]string{"textQuery": query})
	if err != nil {
		return "", "", "", fmt.Errorf("encoding request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/places:searchText", bytes.NewReader(body))
	if err != nil {
		return "", "", "", fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", key)
	req.Header.Set("X-Goog-FieldMask", "places.photos")

	var parsed searchTextResponse
	if err := doJSON(client, req, &parsed); err != nil {
		return "", "", "", err
	}
	if len(parsed.Places) == 0 || len(parsed.Places[0].Photos) == 0 {
		return "", "", "", ErrNoPhoto
	}
	photo := parsed.Places[0].Photos[0]
	if len(photo.AuthorAttributions) > 0 {
		author = photo.AuthorAttributions[0].DisplayName
		authorLink = photo.AuthorAttributions[0].URI
	}
	return photo.Name, author, authorLink, nil
}

type mediaResponse struct {
	PhotoURI string `json:"photoUri"`
}

func mediaURI(ctx context.Context, client *http.Client, key, photoName, base string) (string, error) {
	url := fmt.Sprintf("%s/v1/%s/media?maxWidthPx=800&skipHttpRedirect=true&key=%s", base, photoName, key)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("building request: %w", err)
	}

	var parsed mediaResponse
	if err := doJSON(client, req, &parsed); err != nil {
		return "", err
	}
	if parsed.PhotoURI == "" {
		return "", fmt.Errorf("media response missing photoUri")
	}
	return parsed.PhotoURI, nil
}

// doJSON runs req and JSON-decodes a 200 response body into out; a non-200
// status becomes an error carrying the response body (Google's error
// responses are JSON error objects, useful as-is in the log line callers
// wrap this with).
func doJSON(client *http.Client, req *http.Request, out any) error {
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("calling %s: %w", req.URL.Path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s status %d: %s", req.URL.Path, resp.StatusCode, raw)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	return nil
}
