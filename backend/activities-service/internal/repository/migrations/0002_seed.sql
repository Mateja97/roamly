-- Seed catalog. Cluster A sits around Belgrade, Serbia (usable as the
-- current_location test anchor for the nearby/anywhere scopes). Cluster B
-- sits in other countries (usable for anywhere with no/wide distance cap).
-- See engineering-notes.md for the documented test coordinates.
--
-- image_refs starts empty here (T3): no picsum.photos placeholders ship.
-- 0004_photos.sql adds the real `photos` JSONB column (URL + Google author
-- attribution) that a maintainer backfills via cmd/resolvephotos once a
-- Places-enabled API key is available; until then every activity correctly
-- renders the existing missing-image fallback, not a placeholder photo.

INSERT INTO activities (title, description, category, location, country, rating, image_refs, tags) VALUES
('Skadarlija Food Walk', 'Guided tasting crawl through Belgrade''s bohemian quarter.', 'food_and_drink', ST_SetSRID(ST_MakePoint(20.4646, 44.8153), 4326)::geography, 'Serbia', 4.6, ARRAY[]::text[], ARRAY['food','walking']),
('Belgrade Fortress & Kalemegdan Park', 'History tour of the fortress overlooking the river confluence.', 'history_and_culture', ST_SetSRID(ST_MakePoint(20.4519, 44.8225), 4326)::geography, 'Serbia', 4.7, ARRAY[]::text[], ARRAY['history','park']),
('Ada Ciganlija Lake Walk', 'Riverside island trail popular for walking and swimming.', 'nature_and_outdoors', ST_SetSRID(ST_MakePoint(20.4103, 44.7967), 4326)::geography, 'Serbia', 4.4, ARRAY[]::text[], ARRAY['nature','lake']),
('Street Art Tour Savamala', 'Walking tour of Belgrade''s riverside street-art district.', 'art_and_design', ST_SetSRID(ST_MakePoint(20.4534, 44.8172), 4326)::geography, 'Serbia', 4.3, ARRAY[]::text[], ARRAY['art','walking']),
('Kayaking on the Sava', 'Guided kayak session on the Sava river.', 'sports', ST_SetSRID(ST_MakePoint(20.4400, 44.8090), 4326)::geography, 'Serbia', 4.8, ARRAY[]::text[], ARRAY['sports','water']),
('Belgrade Spa & Wellness Day', 'Full-day spa and thermal-pool access.', 'entertainment_and_wellness', ST_SetSRID(ST_MakePoint(20.4700, 44.8000), 4326)::geography, 'Serbia', 4.5, ARRAY[]::text[], ARRAY['wellness','relax']),
('Zemun Riverside Cycling', 'Bike rental and guided ride along the Danube in Zemun.', 'sports', ST_SetSRID(ST_MakePoint(20.4010, 44.8430), 4326)::geography, 'Serbia', 4.2, ARRAY[]::text[], ARRAY['sports','cycling']),

('Colosseum Guided Tour', 'Skip-the-line guided tour of the Colosseum and Roman Forum.', 'history_and_culture', ST_SetSRID(ST_MakePoint(12.4922, 41.8902), 4326)::geography, 'Italy', 4.8, ARRAY[]::text[], ARRAY['history','landmark']),
('Eiffel Tower Sunset Picnic', 'Curated picnic with sunset views of the Eiffel Tower.', 'food_and_drink', ST_SetSRID(ST_MakePoint(2.2945, 48.8584), 4326)::geography, 'France', 4.6, ARRAY[]::text[], ARRAY['food','sunset']),
('Shibuya Street Food Crawl', 'Late-night street food tour through Shibuya.', 'food_and_drink', ST_SetSRID(ST_MakePoint(139.7005, 35.6595), 4326)::geography, 'Japan', 4.7, ARRAY[]::text[], ARRAY['food','nightlife']),
('Central Park Bike Tour', 'Guided cycling loop through Central Park landmarks.', 'sports', ST_SetSRID(ST_MakePoint(-73.9654, 40.7829), 4326)::geography, 'United States', 4.4, ARRAY[]::text[], ARRAY['sports','cycling']),
('Sagrada Familia Art Walk', 'Guided architecture walk covering Gaudi''s Barcelona.', 'art_and_design', ST_SetSRID(ST_MakePoint(2.1744, 41.4036), 4326)::geography, 'Spain', 4.9, ARRAY[]::text[], ARRAY['art','architecture']);
