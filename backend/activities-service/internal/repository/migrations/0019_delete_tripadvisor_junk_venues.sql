-- Terra's nearby-search category=RESTAURANT parameter doesn't actually
-- filter (verified live against the API) -- car rentals, passenger
-- transport, photo studios, monuments, and review-heavy non-food venues
-- (a department store, a hotel spa) all come back alongside real
-- restaurants and got synced in as Roamly restaurants/bars by every sync
-- before this fix (see service.hasFoodDrinkSignal). One-time cleanup of
-- already-cached junk: a row is junk if it has no price_level and no
-- subrating -- the exact same rule service.hasFoodDrinkSignal now applies
-- before every future upsert, so this only removes what a fresh sync would
-- no longer let in. A review-count fallback used to sit here too (and in
-- service.hasFoodDrinkSignal), but it let real, review-heavy non-food
-- venues (Disney Store, a hotel spa) through with zero food/drink signal --
-- removed; this predicate must stay logically identical to
-- service.hasFoodDrinkSignal by hand, SQL can't reference the Go function.
-- These are auto-synced cache rows, safe to delete: a legitimate venue
-- simply re-syncs on the next query for its area (14-day TTL, see
-- tripadvisorSyncTTL).
DELETE FROM activities
WHERE source = 'tripadvisor'
  AND category IN ('restaurants', 'bars')
  AND COALESCE(details -> 'tripadvisor' ->> 'price_level', '') = ''
  AND details -> 'tripadvisor' -> 'subratings' IS NULL;
