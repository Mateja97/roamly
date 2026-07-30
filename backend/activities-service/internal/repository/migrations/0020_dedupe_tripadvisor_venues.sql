-- Every synced venue must now produce exactly one row (see
-- tripadvisormap.Category / service.syncTripadvisorAnchor): the venue's
-- Roamly category is derived from its own name, not the caller's
-- due-category loop. Before this fix, a venue due for both Restaurants and
-- Bars got upserted once per due category (see 0017), so the same
-- external_id exists as two rows today. This is a one-time cleanup:
-- reclassify every existing Tripadvisor row by the same name-keyword
-- heuristic tripadvisormap.Category applies (kept in sync with that
-- function by hand -- SQL can't call Go), then collapse the resulting
-- duplicates down to one row per external_id. 0019 already removed the
-- rows with no food/drink signal at all; this only touches the legitimate
-- ones left.
UPDATE activities
SET category = CASE
    WHEN title ~* '\y(coffee|caf[eé]|kafe|espresso|roastery|poslasti[cč]arnica)\y' THEN 'cafes'
    WHEN title ~* '\y(bar|pub|pivnica|brewery|tavern|kafana|cocktail|wine)\y' THEN 'bars'
    ELSE 'restaurants'
END
WHERE source = 'tripadvisor'
  AND category IN ('restaurants', 'cafes', 'bars');

-- Collapse (external_id) duplicates left by the old per-due-category upsert
-- loop down to one row: keep the most recently created row per external_id
-- (an arbitrary but deterministic tie-break -- duplicate rows share the
-- same venue data anyway, just a different category), delete the rest.
DELETE FROM activities dup
USING activities keep
WHERE dup.source = 'tripadvisor'
  AND keep.source = 'tripadvisor'
  AND dup.category IN ('restaurants', 'cafes', 'bars')
  AND keep.category IN ('restaurants', 'cafes', 'bars')
  AND dup.external_id = keep.external_id
  AND (dup.created_at, dup.id) < (keep.created_at, keep.id);
