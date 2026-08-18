-- T6 (places-api-cost-reduction): replaces GetPhotos' len(Photos) > 1
-- inference with an explicit resolved flag. That heuristic misfired for a
-- venue whose true Google photo count is exactly 1: every detail view
-- re-attempted resolution forever, an unbounded permanent re-spend.
--
-- Backfill sets photos_resolved = true for exactly the rows the old
-- heuristic already treated as resolved (stored photo count > 1), so no
-- row that previously skipped resolution starts resolving again. Every
-- other row (0 or 1 stored photo) keeps resolving on its next detail view,
-- same as before this column existed — service.GetPhotos then persists
-- photos_resolved = true once that resolve completes, ending the loop for
-- good. No Places call happens as part of this migration.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS photos_resolved BOOLEAN NOT NULL DEFAULT false;
UPDATE activities SET photos_resolved = true WHERE jsonb_array_length(photos) > 1;
