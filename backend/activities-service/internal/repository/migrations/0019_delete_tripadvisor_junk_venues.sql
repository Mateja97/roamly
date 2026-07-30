-- Terra's nearby-search category=RESTAURANT parameter doesn't actually
-- filter (verified live against the API) -- car rentals, passenger
-- transport, photo studios, monuments, and near-zero-review venues all come
-- back alongside real restaurants and got synced in as Roamly
-- restaurants/bars by every sync before this fix (see
-- service.hasFoodDrinkSignal). One-time cleanup of already-cached junk: a
-- row is junk if it has no price_level, no subrating, and fewer than 10
-- reviews -- the exact same rule service.hasFoodDrinkSignal now applies
-- before every future upsert, so this only removes what a fresh sync would
-- no longer let in. These are auto-synced cache rows, safe to delete: a
-- legitimate venue simply re-syncs on the next query for its area (14-day
-- TTL, see tripadvisorSyncTTL).
--
-- NOTE: the "10" below must be kept in sync with
-- service.tripadvisorJunkReviewFloor by hand -- SQL can't reference a Go
-- constant.
DELETE FROM activities
WHERE source = 'tripadvisor'
  AND category IN ('restaurants', 'bars')
  AND COALESCE(details -> 'tripadvisor' ->> 'price_level', '') = ''
  AND details -> 'tripadvisor' -> 'subratings' IS NULL
  AND COALESCE((details -> 'tripadvisor' ->> 'review_count')::int, 0) < 10;
