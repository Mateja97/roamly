-- Generalize Tripadvisor's lazy-sync freshness table to every provider and
-- down to subtype granularity (see
-- docs/superpowers/specs/2026-07-31-type-driven-discovery-design.md).
--
-- Google discovery issues one call per (cell, category, subtype), so
-- freshness has to be tracked at that granularity or a single Nature sync
-- would mark beaches fresh without ever having searched for one.
--
-- The provider column is the seam a tours provider drops into later: a new
-- provider value and its own syncXIfNeeded, no schema change.
ALTER TABLE tripadvisor_sync_regions RENAME TO sync_regions;

ALTER TABLE sync_regions ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'tripadvisor';
ALTER TABLE sync_regions ADD COLUMN IF NOT EXISTS subtype  TEXT NOT NULL DEFAULT '';

-- Drop the default now that existing rows are backfilled: every future write
-- states its provider explicitly.
ALTER TABLE sync_regions ALTER COLUMN provider DROP DEFAULT;

ALTER TABLE sync_regions DROP CONSTRAINT tripadvisor_sync_regions_pkey;
ALTER TABLE sync_regions ADD PRIMARY KEY (provider, cell_key, category, subtype);
