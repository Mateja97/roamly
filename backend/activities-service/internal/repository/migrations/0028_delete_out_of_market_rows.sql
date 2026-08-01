-- Remove venues outside the MVP market (Serbia).
--
-- The lazy sync is deliberately ungated by country: it ingests whichever map
-- cell a query anchors on. A query anchored on San Francisco left 5 genuine SF
-- restaurants in the catalog, and because SuggestCities is just
-- "SELECT DISTINCT city FROM activities WHERE status='published'", the city
-- picker offered "San Francisco" to users — who would pick it and find five
-- restaurants and nothing else.
--
-- Predicate is `country = 'United States'` rather than `country <> 'Serbia'`
-- deliberately. The catalog holds exactly two countries and no NULL or empty
-- ones (verified before writing this), so this is exact; a negated predicate
-- would also match rows with a NULL/empty country, which is how 0025's first
-- draft nearly deleted admin-created rows (repository.Create leaves source and
-- country unset). Narrow beats clever for a DELETE.
--
-- One-time cleanup, not a guard: the sync stays ungated by the owner's
-- decision, so a future query anchored abroad can reintroduce foreign venues.
DELETE FROM activities
WHERE country = 'United States';
