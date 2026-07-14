-- Adds a queryable city per activity (T1). Nullable: safe on the populated
-- table, no data loss, no failure on existing rows. NOT NULL enforcement for
-- future ingestion is a deliberate follow-up (see engineering-notes.md), not
-- done here since nothing yet guarantees every new activity supplies one.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS city TEXT;

-- Btree: city is looked up/grouped by exact value here (no prefix/fuzzy
-- typeahead search over this column yet - that's T4, add pg_trgm then if
-- the search moves onto free-text city matching).
CREATE INDEX IF NOT EXISTS activities_city_idx ON activities (city);

-- Backfill the seed catalog from the hand-maintained title->city map that
-- already lives in cmd/resolvephotos/main.go, per T1's acceptance criteria
-- (no live geocoding required for the existing 12 rows).
UPDATE activities SET city = 'Belgrade' WHERE title IN (
    'Skadarlija Food Walk',
    'Belgrade Fortress & Kalemegdan Park',
    'Ada Ciganlija Lake Walk',
    'Street Art Tour Savamala',
    'Kayaking on the Sava',
    'Belgrade Spa & Wellness Day',
    'Zemun Riverside Cycling'
);
UPDATE activities SET city = 'Rome' WHERE title = 'Colosseum Guided Tour';
UPDATE activities SET city = 'Paris' WHERE title = 'Eiffel Tower Sunset Picnic';
UPDATE activities SET city = 'Tokyo' WHERE title = 'Shibuya Street Food Crawl';
UPDATE activities SET city = 'New York' WHERE title = 'Central Park Bike Tour';
UPDATE activities SET city = 'Barcelona' WHERE title = 'Sagrada Familia Art Walk';
