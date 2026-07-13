export type PlaceSuggestion = {
  placeId: string;
  primaryText: string;
  secondaryText: string;
};

export type Place = {
  name: string;
  region?: string;
  /** City mode only — country mode has no coordinates to resolve. */
  coordinates?: { lat: number; lng: number };
};

export type PlaceMode = 'city' | 'country';

// Same Google Maps Platform key T7's static map thumbnail reuses (see
// product-tasks.md's cross-cutting constraint for T4/T7) — one key with
// both the Places and Maps Static APIs enabled, read from env, never
// hardcoded. `EXPO_PUBLIC_`-prefixed per APP_STANDARDS.md's API access rule
// (Metro inlines it at build time, same as PROXY_URL in activities.ts).
function apiKey(): string | undefined {
  return process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
}

export function hasPlacesKey(): boolean {
  return Boolean(apiKey());
}

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';
const UNCONFIGURED_MESSAGE = 'Place search is not configured.';
const UNREACHABLE_MESSAGE = 'Could not reach place search. Check your connection and try again.';
const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

export type PlaceSearchResult = { status: 'success'; suggestions: PlaceSuggestion[] } | { status: 'error'; message: string };

type AutocompleteResponse = {
  status: string;
  predictions?: {
    place_id: string;
    description: string;
    structured_formatting?: { main_text: string; secondary_text: string };
  }[];
};

// Google's legacy Places Autocomplete JSON web service — a plain GET with
// the key as a query param. ponytail: picked over
// react-native-google-places-autocomplete / expo-maps' native Places SDK —
// this screen only needs a one-shot text search + one coordinate lookup, not
// a rendered native map or session-token billing; a bare fetch is the
// smaller dependency footprint (see engineering-notes.md).
export async function searchPlaces(query: string, mode: PlaceMode): Promise<PlaceSearchResult> {
  const key = apiKey();
  if (!key) return { status: 'error', message: UNCONFIGURED_MESSAGE };

  const params = new URLSearchParams({ input: query, types: mode === 'city' ? '(cities)' : 'country', key });

  let res: Response;
  try {
    res = await fetch(`${PLACES_BASE}/autocomplete/json?${params}`);
  } catch {
    return { status: 'error', message: UNREACHABLE_MESSAGE };
  }

  let data: AutocompleteResponse;
  try {
    data = (await res.json()) as AutocompleteResponse;
  } catch {
    return { status: 'error', message: GENERIC_MESSAGE };
  }

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    return { status: 'error', message: GENERIC_MESSAGE };
  }

  return {
    status: 'success',
    suggestions: (data.predictions ?? []).map((p) => ({
      placeId: p.place_id,
      primaryText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? '',
    })),
  };
}

export type PlaceDetailsResult = { status: 'success'; place: Place } | { status: 'error'; message: string };

type DetailsResponse = {
  status: string;
  result?: { name?: string; geometry?: { location?: { lat: number; lng: number } } };
};

// City mode only — resolves a picked suggestion to coordinates for
// `home_location`. Country mode never calls this: the autocomplete
// suggestion already carries the country name `home_country` needs.
export async function getPlaceCoordinates(suggestion: PlaceSuggestion): Promise<PlaceDetailsResult> {
  const key = apiKey();
  if (!key) return { status: 'error', message: UNCONFIGURED_MESSAGE };

  const params = new URLSearchParams({ place_id: suggestion.placeId, fields: 'geometry,name', key });

  let res: Response;
  try {
    res = await fetch(`${PLACES_BASE}/details/json?${params}`);
  } catch {
    return { status: 'error', message: UNREACHABLE_MESSAGE };
  }

  let data: DetailsResponse;
  try {
    data = (await res.json()) as DetailsResponse;
  } catch {
    return { status: 'error', message: GENERIC_MESSAGE };
  }

  const location = data.status === 'OK' ? data.result?.geometry?.location : undefined;
  if (!location) return { status: 'error', message: GENERIC_MESSAGE };

  return {
    status: 'success',
    place: {
      name: data.result?.name ?? suggestion.primaryText,
      region: suggestion.secondaryText || undefined,
      coordinates: { lat: location.lat, lng: location.lng },
    },
  };
}

export type CountryResult = { status: 'success'; country: string } | { status: 'error'; message: string };

type GeocodeResponse = {
  status: string;
  results?: { address_components?: { long_name: string; types: string[] }[] }[];
};

const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode';

// Reverse-geocodes a GPS fix to a country name via Google's Geocoding API.
// `result_type=country` narrows the response to the country-level result, so
// the country address component can be read directly off the first result
// instead of picking it out of a full street-address breakdown.
export async function getCountryFromCoordinates(coordinates: { latitude: number; longitude: number }): Promise<CountryResult> {
  const key = apiKey();
  if (!key) return { status: 'error', message: UNCONFIGURED_MESSAGE };

  const params = new URLSearchParams({
    latlng: `${coordinates.latitude},${coordinates.longitude}`,
    result_type: 'country',
    key,
  });

  let res: Response;
  try {
    res = await fetch(`${GEOCODE_BASE}/json?${params}`);
  } catch {
    return { status: 'error', message: UNREACHABLE_MESSAGE };
  }

  let data: GeocodeResponse;
  try {
    data = (await res.json()) as GeocodeResponse;
  } catch {
    return { status: 'error', message: GENERIC_MESSAGE };
  }

  if (data.status !== 'OK') return { status: 'error', message: GENERIC_MESSAGE };

  const countryComponent = data.results?.[0]?.address_components?.find((c) => c.types.includes('country'));
  if (!countryComponent) return { status: 'error', message: GENERIC_MESSAGE };

  return { status: 'success', country: countryComponent.long_name };
}
