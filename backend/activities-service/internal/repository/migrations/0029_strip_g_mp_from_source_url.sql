-- Google's googleMapsUri carries a "g_mp" query parameter naming the Places
-- API method that returned the place -- base64 of
-- "google.maps.places.v1.Places.SearchNearby" vs "...SearchText". It says
-- nothing about the place. Because source_url is the identity half of the
-- activities_source_url_category_key unique index (0017), one venue reached by
-- both discovery calls stored two different source_urls and so became two
-- rows: googlesync runs a searchNearby per discovery row plus a searchText
-- fallback for subtypes Table A cannot express, and any venue matching both
-- was inserted twice with the same title, category, external_id and location.
--
-- This measured 102 duplicate rows in production: 81 where a legacy
-- "firecrawl" row survived the google_places sweep it should have been
-- overwritten by, and 21 google_places pairs created seconds apart in a single
-- sync run. Stripping g_mp collapses exactly those 102 groups and no others.
--
-- Survivor rule, in order: the row that has an external_id (rows without one
-- can never resolve live Place Details -- see service.hydrateLiveDetails --
-- so they serve stale stored content forever), then the row that has a
-- subcategory, then the newest. Every survivor is a google_places row.
--
-- repository.canonicalSourceURL applies the same strip on the write path;
-- without it the next sync re-creates every row deleted here.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY regexp_replace(source_url, '[&?]g_mp=[^&]*', ''), category
               ORDER BY (external_id IS NOT NULL AND external_id <> '') DESC,
                        (coalesce(subcategory, '') <> '') DESC,
                        created_at DESC
           ) AS rn
    FROM activities
    WHERE source_url IS NOT NULL
)
DELETE FROM activities WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE activities
SET source_url = regexp_replace(source_url, '[&?]g_mp=[^&]*', '')
WHERE source_url LIKE '%g_mp=%';
