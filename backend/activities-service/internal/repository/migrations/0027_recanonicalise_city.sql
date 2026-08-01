-- Recanonicalise Tripadvisor-sourced cities.
--
-- Terra's own address field yields neighbourhood/sub-municipality names
-- (Stari Grad, Novi Beograd, Dorcol, Vozdovac, ...) instead of the city —
-- unlike the Google sync, which already resolves city by reverse-geocoding
-- the sync cell (places.ReverseGeocodeCity) and collapses those same
-- sub-municipalities to "Belgrade". This branch makes the Tripadvisor sync
-- do the same per-anchor resolution (see syncTripadvisorAnchor).
--
-- Clearing sync_regions for provider = 'tripadvisor' makes every anchor
-- look stale, so the next query for each area re-sweeps it and rewrites
-- city/country from coordinates instead of Terra's text. Deliberately NOT a
-- string-matching UPDATE (e.g. mapping "Dorcol" -> "Belgrade"): that would
-- need a new entry per neighbourhood per city forever, and would have to
-- special-case the 5 genuinely-correct San Francisco rows to avoid
-- mismapping them. Re-deriving from coordinates needs neither.
--
-- Scoped strictly to provider = 'tripadvisor' — Google's rows are already
-- correct (see 0026's own provider = 'google' scoping) and re-sweeping them
-- would be pure spend for no benefit.
DELETE FROM sync_regions WHERE provider = 'tripadvisor';

-- One-time heal for the rows a re-sweep can't reach.
--
-- Terra's nearby search returns a top-N that varies call to call, so a
-- handful of already-ingested rows (e.g. "Josephine Belgrade", "Cveće Zla")
-- may simply never resurface in a future sweep to get their city rewritten
-- by the coordinate-derived resolution above. This statement is
-- COORDINATE-DERIVED, NOT A NAME-ALIAS LIST — the same principle as the
-- sync-time fix, just applied once to existing rows instead of on ingest:
-- it never reads or matches on the stored city string (no "Dorcol"/"Stari
-- Grad"/... table), only on country and distance from Belgrade's centre.
-- That's what makes it correct for every sub-city name at once, known or
-- not, with no per-neighbourhood curation.
--
-- 30km is deliberately tight: wide enough to cover every measured
-- sub-Belgrade row (max observed 5.8km) but well short of the next Serbian
-- city (Novi Sad, ~80km away), so this stays safe as coverage expands to
-- more of Serbia. country = 'Serbia' plus 9,000km of distance keeps this
-- nowhere near the 5 genuinely-correct San Francisco rows.
--
-- One-time only: this heals pre-existing rows, it is not an ongoing
-- mechanism. Every row ingested from here on gets its city from
-- ReverseGeocodeCity at sync time (see syncTripadvisorAnchor /
-- syncGoogleIfNeeded), which is what makes an ongoing version of this
-- unnecessary.
-- IS DISTINCT FROM, not <>: city is nullable (0005_city.sql) and
-- NULL <> 'Belgrade' evaluates to NULL, which WHERE treats as false — a
-- Belgrade-area row with a NULL city would silently survive a bare <>.
UPDATE activities
SET city = 'Belgrade'
WHERE country = 'Serbia'
  AND city IS DISTINCT FROM 'Belgrade'
  AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(20.4612, 44.8125), 4326)::geography, 30000);
