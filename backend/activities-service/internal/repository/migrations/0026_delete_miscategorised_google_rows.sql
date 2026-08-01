-- Delete Google-sourced rows left miscategorised by the pre-arbitration sync
-- (see e85f2e5's category-arbitration rule and this branch's
-- venueWrongCategory / CategoryForType).
--
-- WHY THIS SHAPE, NOT A primary_type PREDICATE. The obvious fix would be
-- "delete rows whose stored category disagrees with what their own
-- primary_type implies." That predicate cannot be written: activities has no
-- primary_type column, and live verification
-- (`docker exec roamly-activities-db-1 psql -U activities -d activities -tAc
-- "select raw ? 'primaryType', count(*) from activities where
-- source='google_places' group by 1"`) showed all 302 source='google_places'
-- rows carry raw = '{}' — toIngest (internal/service/googlesync.go) never
-- populates IngestActivity.Raw, so the Places primaryType this branch's
-- arbitration rule depends on was simply never persisted for any row. There
-- is nothing to read a predicate from, and inventing a category-name
-- heuristic (e.g. matching title substrings) is exactly the guess the task
-- forbids.
--
-- WHAT IS RECOVERABLE, NARROWLY. The upsert key is (source_url, category),
-- so one venue upserted under two different categories before this branch's
-- arbitration existed leaves two (or more) rows sharing the same
-- external_id (the Places place_id) under distinct categories. A venue has
-- exactly one true category under the new single-category invariant
-- (CategoryForType / venueWrongCategory), so at most one row in such a group
-- is right and the rest are the exact defect Fix 2 targets — the motivating
-- "Igraonica New Curance" case is one of these groups (kids, nature, sport,
-- same place_id ChIJhXnT7lBjWkcRFfxdCMCnBLY). With no stored signal to say
-- *which* row is the correct one, deleting the whole group and letting the
-- next sync re-ingest it under its one correct category (per row's own
-- primaryType, going forward) is the only verifiable option that doesn't
-- guess.
--
-- Live counts before this migration: 6 external_id groups, 13 rows total.
DELETE FROM activities
WHERE source = 'google_places'
  AND external_id IN (
    SELECT external_id
    FROM activities
    WHERE source = 'google_places'
      AND external_id IS NOT NULL
      AND external_id != ''
    GROUP BY external_id
    HAVING COUNT(DISTINCT category) > 1
  );
