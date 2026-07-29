-- The Tripadvisor Terra Partner API has no distinct "bars" category (only
-- RESTAURANT/ATTRACTION/HOTEL), so a Restaurants sync and a Bars sync for
-- the same area query it identically and can return the same venue. Rather
-- than guess which category a venue "really" belongs to (Tripadvisor gives
-- no signal to do that reliably), the same real-world venue is allowed to
-- exist as two separate rows — one per category, same source_url. The
-- previous source_url-only uniqueness prevented this: a second category's
-- upsert would silently overwrite the first's row instead of creating its
-- own. See docs/superpowers/specs/2026-07-29-tripadvisor-restaurants-bars-design.md.
DROP INDEX activities_source_url_key;
CREATE UNIQUE INDEX activities_source_url_category_key ON activities (source_url, category) WHERE source_url IS NOT NULL;
