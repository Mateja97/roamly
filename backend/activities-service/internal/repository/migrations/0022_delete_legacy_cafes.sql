-- Cutover to Tripadvisor as the exclusive Cafés source, joining
-- Restaurants/Bars (see 0016, same cutover for those two, and
-- cmd/scrapecity's categoryQueries, which no longer scrapes cafes from
-- Google). User-approved deletion. Removes every existing café row that
-- didn't come from Tripadvisor (Google-seeded rows from
-- 0011_import_belgrade_listings.sql and cmd/scrapecity, plus any
-- admin-hand-created ones) — a clean cutover, not a backfill. Fresh
-- Tripadvisor café data repopulates lazily as areas get queried
-- post-cutover (service.Activities.Query's lazy sync). Scoped strictly to
-- category = 'cafes' and a non-Tripadvisor source, same safety shape as
-- 0016, so nothing else is touched.
DELETE FROM activities
WHERE category = 'cafes'
  AND source IS DISTINCT FROM 'tripadvisor';
