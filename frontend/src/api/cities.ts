const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:8080';

interface SuggestCitiesResponse {
  suggestions: { city: string }[];
}

/**
 * Public, ungated endpoint (`GET /cities/suggest`) — reused here to
 * populate the admin activities filter's city dropdown.
 *
 * ponytail: there is no admin-scoped "list distinct cities" endpoint (T2's
 * admin API only filters by an already-known city string), so this reuses
 * the existing public typeahead with an empty query, which the backend
 * matches as an every-city prefix. Known gap: that endpoint is
 * published-only, so a city whose activities are all draft/pending won't
 * appear as a filter option until it has a published one. Add a real
 * admin cities-list endpoint if that gap matters in practice.
 */
export async function suggestCities(query = ''): Promise<string[]> {
  const url = new URL('/cities/suggest', PROXY_URL);
  if (query) url.searchParams.set('q', query);

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as SuggestCitiesResponse;
    return body.suggestions.map((s) => s.city);
  } catch {
    // Best-effort dropdown population (see the class doc above) — a
    // network failure here just means "no city options", not a page-level
    // error; the activities list's own error banner is the source of truth
    // for connectivity problems.
    return [];
  }
}
