-- Anywhere sync fetches out to the requested radius (T1, rating-and-anywhere-radius,
-- see docs/superpowers/specs/2026-08-11-rating-and-anywhere-radius-design.md D1).
-- radius_km records the radius a sync sweep actually covered, so freshness
-- can be judged on covered radius as well as recency: a prior narrow sync
-- (e.g. Nearby's fixed 10km) no longer blocks a later wider Anywhere sync
-- from actually running.
--
-- Backfilled to each provider's true historical sync radius, since every row
-- written before this migration came from a fixed-radius sweep: Google's
-- (googleSyncRadiusKM, service/googlesync.go) was fixed at 10km, Tripadvisor's
-- (tripadvisorSyncRadiusKM, service/activity.go) fixed at 8km. Existing
-- "fresh" marks are thus correctly reclassified as narrow, so an
-- already-synced cell self-heals the first time a genuinely wider search
-- asks for it — no manual data purge needed.
ALTER TABLE sync_regions ADD COLUMN radius_km DOUBLE PRECISION;

UPDATE sync_regions SET radius_km = 10 WHERE provider = 'google';
UPDATE sync_regions SET radius_km = 8 WHERE provider = 'tripadvisor';

ALTER TABLE sync_regions ALTER COLUMN radius_km SET NOT NULL;
