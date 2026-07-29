-- Cutover to Tripadvisor as the exclusive Restaurants/Bars source (see
-- docs/superpowers/specs/2026-07-29-tripadvisor-restaurants-bars-design.md).
-- Removes every existing row in these two categories that didn't come
-- from Tripadvisor (Google-seeded rows from
-- 0011_import_belgrade_listings.sql, plus any admin-hand-created ones) —
-- a clean cutover, not a backfill. Fresh Tripadvisor data repopulates
-- lazily as areas get queried post-cutover
-- (service.Activities.Query's lazy sync).
DELETE FROM activities
WHERE category IN ('restaurants', 'bars')
  AND source IS DISTINCT FROM 'tripadvisor';
