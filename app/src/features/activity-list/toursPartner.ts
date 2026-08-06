import type { CitySuggestion } from '../../api/cities';
import type { Activity } from '../../api/types';

// GetYourGuide affiliate referral, Phase 1 (deep link only).
//
// Tours & Experiences has no provider (BUSINESS_STANDARDS.md) and cannot get
// one: GYG's Partner T&Cs §4.2.2(iii) forbid copying, storing, caching or
// building a database of their content, and §4.2.2(v) forbids intermixing it
// with other sources. So this module builds an outbound link and nothing
// else — no GYG content ever enters the app or this repo.

const GYG_ORIGIN = 'https://www.getyourguide.com';

// Partner/tracking ID from the GYG partner portal, appended as `partner_id`
// per their Deep links 101 manual-setup instructions. EXPO_PUBLIC_-prefixed
// per APP_STANDARDS.md's API access rule, same pattern as staticMap.ts's
// maps key.
export function hasPartnerId(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_GYG_PARTNER_ID);
}

// Which city the tour link should land on. Both scopes are served by data
// already on the client — no reverse-geocode call, no extra permission.
//
// Anywhere: the first selected city. Nearby: any loaded activity's `city`,
// because proxy-service resolves city once per synced map cell by reverse
// geocoding the search anchor (BUSINESS_STANDARDS.md), so every row in one
// Nearby search carries the same value.
//
// null is a normal outcome (unanchored Anywhere with no results yet), not an
// error — callers fall back to GYG's own landing page.
export function resolveTourCity(cities: CitySuggestion[], activities: Activity[]): string | null {
  const selected = cities[0]?.city?.trim();
  if (selected) return selected;
  for (const activity of activities) {
    const city = activity.city?.trim();
    if (city) return city;
  }
  return null;
}

// ponytail: the search page, not a per-city landing URL — GYG's city URLs are
// slugged per city ("/belgrade-l1688/") and we have no slug table and no
// licence to build one. `/s/?q=` resolves the same city server-side from the
// plain name we already hold. A null city drops `q` and lands on the GYG home
// page rather than searching for nothing.
//
// Returns null with no partner id rather than emitting `partner_id=`. The
// caller already guards on hasPartnerId(), but an untracked referral is the
// one thing this feature must never ship, so the guard belongs here too where
// a future caller can't route around it — and null forces them to handle it.
export function toursDeepLink(city: string | null): string | null {
  const partnerId = process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
  if (!partnerId) return null;
  const params = new URLSearchParams();
  if (city) params.set('q', city);
  params.set('partner_id', partnerId);
  return city ? `${GYG_ORIGIN}/s/?${params}` : `${GYG_ORIGIN}/?${params}`;
}
