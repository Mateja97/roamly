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
--
-- The strip is two nested regexp_replace calls, not one. A single
-- '[&?]g_mp=[^&]*' consumes the "?" when g_mp is the FIRST parameter
-- ('?g_mp=X&cid=7' -> '&cid=7'), which both malforms the URL and disagrees
-- with canonicalSourceURL's '?cid=7' — two different canonical forms means a
-- row deduped here gets re-split by the very next sync. The inner call
-- rewrites a leading 'g_mp' back to '?' first, so the outer one only ever
-- sees g_mp in a non-leading position. Google currently emits g_mp last, so
-- this is latent rather than active, but the two implementations must agree
-- by construction. TestCanonicalSourceURLMatchesMigration (integration) pins
-- the two against the same table of cases.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY regexp_replace(regexp_replace(source_url, '\?g_mp=[^&]*&', '?'), '[?&]g_mp=[^&]*', '', 'g'), category
               -- Survivor order. details before created_at: when both rows
               -- have an external_id, preferring the newer one alone would
               -- drop an older row's website-sync content (price_from,
               -- treatments, typical_visit, upcoming_shows) that
               -- BuildLiveDetails does NOT regenerate — re-earning it costs a
               -- Firecrawl scrape. id last so equal timestamps still pick a
               -- deterministic survivor rather than an arbitrary one (0021
               -- breaks its own tie the same way).
               ORDER BY (external_id IS NOT NULL AND external_id <> '') DESC,
                        (coalesce(details, '{}'::jsonb) <> '{}'::jsonb) DESC,
                        (coalesce(subcategory, '') <> '') DESC,
                        created_at DESC,
                        id DESC
           ) AS rn
    FROM activities
    WHERE source_url IS NOT NULL
)
DELETE FROM activities WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE activities
SET source_url = regexp_replace(regexp_replace(source_url, '\?g_mp=[^&]*&', '?'), '[?&]g_mp=[^&]*', '', 'g')
WHERE source_url LIKE '%g_mp=%';

-- websitesync keys the shared sync_regions freshness table by the activity's
-- own ID (provider 'website', cell_key = activities.id — see
-- websiteSyncProvider), so deleting rows above strands their freshness
-- markers. They are inert (ids are UUIDs, so a future activity can never
-- collide with one) but they accumulate on every run of this class of
-- cleanup, so drop them rather than leaving rows nothing will ever read.
DELETE FROM sync_regions s
WHERE s.provider = 'website'
  AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.id::text = s.cell_key);
