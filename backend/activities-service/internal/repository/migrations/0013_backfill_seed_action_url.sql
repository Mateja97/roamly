-- T7 follow-up: migration 0009 added `action_url` (and Art `year`) onto the
-- 0002/0008 seed rows, but 0011_import_belgrade_listings later added more seed
-- rows in the same 8 action_url categories and only some carried an
-- `action_url` — leaving ~24 rows without one and 8 Art rows without `year`.
-- This backfills the gap so every SEED row in those categories has the CTA
-- link the T7 detail pages assume.
--
-- Scoped to `source_url IS NULL` on purpose: that is exactly the seed rows
-- (0002/0008/0011 INSERTs never set source_url). Real ingested venues
-- (scrapecity/importcity) always carry a source_url and are deliberately left
-- untouched — they legitimately have no booking URL from Places, and stamping
-- a fake example.com CTA onto live data would be worse than the gap.
--
-- Domains mirror 0009's per-category convention; the slug is derived from the
-- title. action_url/year are valid keys for every category targeted here (see
-- activity.go). Idempotent via the `NOT (details ? 'action_url')` guard.

UPDATE activities
SET details = details || jsonb_build_object(
	'action_url',
	CASE category
		WHEN 'restaurants' THEN 'https://reservations.example.com/'
		WHEN 'bars'        THEN 'https://menus.example.com/'
		WHEN 'nightlife'   THEN 'https://guestlist.example.com/'
		WHEN 'sport'       THEN 'https://booking.example.com/'
		WHEN 'wellness'    THEN 'https://booking.example.com/'
		ELSE                    'https://tickets.example.com/'
	END || lower(regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g'))
)
WHERE source_url IS NULL
  AND category IN ('restaurants', 'bars', 'nightlife', 'sport', 'culture', 'art', 'wellness', 'entertainment')
  AND NOT (details ? 'action_url');

UPDATE activities
SET details = details || '{"year": 2019}'::jsonb
WHERE source_url IS NULL
  AND category = 'art'
  AND NOT (details ? 'year');
