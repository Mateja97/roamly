-- Un-freeze every Tripadvisor sync region. The pre-pagination sweep read
-- only the first 20-result page of Terra's nearby catalog — mostly
-- hotels/apartments/attractions noise — so each stamped cell froze a
-- handful of venues (Belgrade: 2 restaurants) for the full 14-day TTL.
-- Deleting the freshness records makes the next query for each area re-run
-- the sweep with the paginated search; activity rows themselves are kept
-- (Upsert refreshes them in place, keyed on source_url).
DELETE FROM tripadvisor_sync_regions;
