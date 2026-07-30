-- Compliance fix: Google Places Terms §14.3 permits caching only place_id
-- (indefinitely) and lat/lng (<=30 days), never the ratings/reviews/hours/
-- price/amenities historically stored in details for Places-sourced rows.
-- Scoped with the *positive* predicate source = 'google_places' (not
-- IS DISTINCT FROM 'tripadvisor'): Cafes/Restaurants/Bars rows can
-- legitimately be Tripadvisor-sourced and must stay untouched, and so must
-- admin-created rows (source IS NULL/''). Narrower than 0022's predicate on
-- purpose. One-way, same convention as every migration in this dir — the
-- cleared JSON can't be un-deleted, so there's no down-migration to write.
UPDATE activities
SET details = '{}'::jsonb
WHERE source = 'google_places';
