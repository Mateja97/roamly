-- 0019 (already applied on every deployed database -- shipped, left
-- untouched; editing an already-applied migration is the anti-pattern
-- here) removed cached Tripadvisor junk using a price_level/subrating rule
-- with a ReviewCount >= 10 fallback. service.hasFoodDrinkSignal has since
-- replaced that whole approach: price_level/subratings are only populated
-- once a venue has existing reviews, which would wrongly reject a
-- brand-new restaurant, and the review-count fallback let real,
-- review-heavy non-food venues through with zero food/drink signal
-- (verified live -- Disney Store and Spa in Hotel Moskva are both
-- Attraction_Review venues, Hotel Zelos and citizenM San Francisco Union
-- Square are both Hotel_Review). The new gate is Tripadvisor's own
-- classification: web_url (persisted as source_url) carries a
-- "/Restaurant_Review-" path segment for every eatery, regardless of
-- review history. This migration re-applies that gate against whatever
-- 0019's looser rule already left behind. Matched with a leading "/" so a
-- venue name that happens to contain the text can't spoof it, same
-- full-path-segment intent as the Go side (Postgres has no URL path
-- parser, so this is the closest SQL equivalent) -- must stay logically
-- identical to service.hasFoodDrinkSignal by hand. Naturally idempotent:
-- once applied, re-running deletes zero rows.
DELETE FROM activities
WHERE source = 'tripadvisor'
  AND category IN ('restaurants', 'bars')
  AND COALESCE(source_url, '') !~ '/Restaurant_Review-';
