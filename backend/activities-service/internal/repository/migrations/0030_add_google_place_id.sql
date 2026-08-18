-- T1 (tripadvisor-google-review-fallback): stores the Google place id
-- ResolveTripadvisorSubtype already matches every Tripadvisor venue against
-- via SearchTextInArea + venueNameMatches, so a later live Place Details
-- lookup (T3) needs no additional Places request to find the right place.
-- Caching a bare place_id (not any Places content) is explicitly permitted
-- by Places ToS §14.3. Nullable, no default, no backfill here — existing
-- rows are covered separately by cmd/backfillgoogleplaceid (T2).
ALTER TABLE activities ADD COLUMN IF NOT EXISTS google_place_id TEXT;
