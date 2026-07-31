// Shared by TripadvisorReviewsCarousel.tsx (§5b review cards) and
// GoogleAttributionPlate.tsx (Google review rows) — both show a review's
// date as "14 June 2026", not the API's raw ISO-8601 timestamp. Returns
// `null` (not the raw string) when `date` is missing/unparseable so a
// caller can fall back to rendering it verbatim (e.g. a Google
// `relativePublishTimeDescription`-style string like "a month ago", which
// isn't parseable as a `Date` and is supposed to pass through unchanged).
export function formatReviewDate(date: string | undefined): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    parsed,
  );
}
