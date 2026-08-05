-- Every synced venue must now produce exactly one row (see
-- namemap.Category / service.syncTripadvisorAnchor): the venue's
-- Roamly category is derived from its own name, not the caller's
-- due-category loop. Before this fix, a venue due for both Restaurants and
-- Bars got upserted once per due category (see 0017), so the same
-- external_id exists as two rows today -- e.g. (url, restaurants) and
-- (url, bars). 0017's UNIQUE (source_url, category) index means those two
-- rows can coexist today (different category each), but reassigning both
-- to the classifier's single category before removing the surplus row
-- would collide on that same index mid-migration. So order matters:
-- delete the surplus row(s) per external_id FIRST, then reclassify the one
-- survivor -- at every intermediate step at most one row per
-- (source_url, category) exists. 0020 already removed the rows with no
-- food/drink signal at all; this only touches the legitimate ones left.
-- Naturally idempotent: once every external_id has exactly one row, the
-- DELETE matches nothing and the UPDATE just re-derives the same category.

-- Step 1: collapse (external_id) duplicates down to one row, keeping the
-- most recently created (an arbitrary but deterministic tie-break --
-- duplicate rows share the same venue data, just a different category).
DELETE FROM activities dup
USING activities keep
WHERE dup.source = 'tripadvisor'
  AND keep.source = 'tripadvisor'
  AND dup.category IN ('restaurants', 'cafes', 'bars')
  AND keep.category IN ('restaurants', 'cafes', 'bars')
  AND dup.external_id = keep.external_id
  AND (dup.created_at, dup.id) < (keep.created_at, keep.id);

-- Step 2: now exactly one row per external_id remains, so reassigning its
-- category can never collide with a sibling row on
-- (source_url, category). Reclassify by the same name-keyword heuristic
-- namemap.Category applies (kept in sync with that function by
-- hand).
UPDATE activities
SET category = CASE
    WHEN title ~* '\y(coffee|caf[eé]|kafe|espresso|roastery|poslasti[cč]arnica)\y' THEN 'cafes'
    WHEN title ~* '\y(bar|pub|pivnica|brewery|tavern|kafana|cocktail|wine)\y' THEN 'bars'
    ELSE 'restaurants'
END
WHERE source = 'tripadvisor'
  AND category IN ('restaurants', 'cafes', 'bars');
