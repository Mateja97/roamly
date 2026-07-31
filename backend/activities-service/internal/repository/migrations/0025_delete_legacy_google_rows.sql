-- Delete only the Google rows the type-driven sync CANNOT heal, plus the
-- source-less demo seeds (see
-- docs/superpowers/specs/2026-07-31-type-driven-discovery-design.md).
--
-- SCOPE NARROWED after live verification. The original plan deleted every
-- source='google_places' row. That is no longer right: the sync re-upserts
-- matching rows in place (conflict on source_url, category), so a live
-- Belgrade sweep already healed 265 of 360 rows — correct subtypes, correct
-- city. Deleting those would discard verified-good data and force a needless
-- re-sweep costing real API spend.
--
-- What CANNOT be healed is the 58 rows scraped before place_id capture: they
-- have no external_id, so nothing links them to a Places result and no sweep
-- will ever update them. They are also the rows that can never be labelled
-- retroactively, which is why they exist as a problem at all.
DELETE FROM activities
WHERE source = 'google_places'
  AND (external_id IS NULL OR external_id = '');

-- The two source-less tours_experiences rows are seeded placeholders (not
-- from 0008/0010, which seed cafes/bars/nightlife/kids/entertainment/
-- shopping — these are tours-specific). Tours has no data provider, so
-- nothing will replace them — but a fake venue is worse than an empty
-- category, and the empty state is the honest signal that the category is
-- unsourced.
--
-- Scoped to category = 'tours_experiences' deliberately: source IS NULL/''
-- is NOT unique to these placeholders — repository/activity.go's admin
-- Create() never sets source, so every admin-drafted row across every
-- category also has a NULL source (see 0023's same distinction). Without
-- the category guard this DELETE would silently destroy real admin content.
DELETE FROM activities
WHERE (source IS NULL OR source = '')
  AND category = 'tours_experiences';
