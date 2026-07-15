-- Migrates existing rows off the retired 6-value Category enum onto the
-- 12-value taxonomy (BUSINESS_STANDARDS.md). No column type change: category
-- is already unconstrained TEXT.
--
-- ponytail: this is a coarse default remap, not a real reclassification —
-- the old categories don't carry enough information to auto-split e.g.
-- food_and_drink into restaurants vs cafes vs bars. Acceptable ceiling for
-- today's seed/dev data (not a data-loss risk); a real migration for
-- production data would need per-row review.
UPDATE activities SET category = 'restaurants' WHERE category = 'food_and_drink';
UPDATE activities SET category = 'culture' WHERE category = 'history_and_culture';
UPDATE activities SET category = 'nature' WHERE category = 'nature_and_outdoors';
UPDATE activities SET category = 'art' WHERE category = 'art_and_design';
UPDATE activities SET category = 'sport' WHERE category = 'sports';
UPDATE activities SET category = 'wellness' WHERE category = 'entertainment_and_wellness';
