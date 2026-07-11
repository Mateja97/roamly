-- Seed catalog. Cluster A sits around Belgrade, Serbia (usable as the
-- home_location/current_location test anchor for the home/nearby scopes).
-- Cluster B sits in other countries (usable for outside_country with
-- home_country = 'Serbia'). See engineering-notes.md for the documented
-- test coordinates.

INSERT INTO activities (title, description, category, location, country, price_tier, rating, image_refs, tags) VALUES
('Skadarlija Food Walk', 'Guided tasting crawl through Belgrade''s bohemian quarter.', 'food_and_drink', ST_SetSRID(ST_MakePoint(20.4646, 44.8153), 4326)::geography, 'Serbia', 'moderate', 4.6, ARRAY['https://picsum.photos/seed/skadarlija/600/400'], ARRAY['food','walking']),
('Belgrade Fortress & Kalemegdan Park', 'History tour of the fortress overlooking the river confluence.', 'history_and_culture', ST_SetSRID(ST_MakePoint(20.4519, 44.8225), 4326)::geography, 'Serbia', 'budget', 4.7, ARRAY['https://picsum.photos/seed/kalemegdan/600/400'], ARRAY['history','park']),
('Ada Ciganlija Lake Walk', 'Riverside island trail popular for walking and swimming.', 'nature_and_outdoors', ST_SetSRID(ST_MakePoint(20.4103, 44.7967), 4326)::geography, 'Serbia', 'budget', 4.4, ARRAY['https://picsum.photos/seed/adaciganlija/600/400'], ARRAY['nature','lake']),
('Street Art Tour Savamala', 'Walking tour of Belgrade''s riverside street-art district.', 'art_and_design', ST_SetSRID(ST_MakePoint(20.4534, 44.8172), 4326)::geography, 'Serbia', 'budget', 4.3, ARRAY['https://picsum.photos/seed/savamala/600/400'], ARRAY['art','walking']),
('Kayaking on the Sava', 'Guided kayak session on the Sava river.', 'sports', ST_SetSRID(ST_MakePoint(20.4400, 44.8090), 4326)::geography, 'Serbia', 'premium', 4.8, ARRAY['https://picsum.photos/seed/savakayak/600/400'], ARRAY['sports','water']),
('Belgrade Spa & Wellness Day', 'Full-day spa and thermal-pool access.', 'entertainment_and_wellness', ST_SetSRID(ST_MakePoint(20.4700, 44.8000), 4326)::geography, 'Serbia', 'luxury', 4.5, ARRAY['https://picsum.photos/seed/spawellness/600/400'], ARRAY['wellness','relax']),
('Zemun Riverside Cycling', 'Bike rental and guided ride along the Danube in Zemun.', 'sports', ST_SetSRID(ST_MakePoint(20.4010, 44.8430), 4326)::geography, 'Serbia', 'moderate', 4.2, ARRAY['https://picsum.photos/seed/zemuncycling/600/400'], ARRAY['sports','cycling']),

('Colosseum Guided Tour', 'Skip-the-line guided tour of the Colosseum and Roman Forum.', 'history_and_culture', ST_SetSRID(ST_MakePoint(12.4922, 41.8902), 4326)::geography, 'Italy', 'premium', 4.8, ARRAY['https://picsum.photos/seed/colosseum/600/400'], ARRAY['history','landmark']),
('Eiffel Tower Sunset Picnic', 'Curated picnic with sunset views of the Eiffel Tower.', 'food_and_drink', ST_SetSRID(ST_MakePoint(2.2945, 48.8584), 4326)::geography, 'France', 'moderate', 4.6, ARRAY['https://picsum.photos/seed/eiffelpicnic/600/400'], ARRAY['food','sunset']),
('Shibuya Street Food Crawl', 'Late-night street food tour through Shibuya.', 'food_and_drink', ST_SetSRID(ST_MakePoint(139.7005, 35.6595), 4326)::geography, 'Japan', 'budget', 4.7, ARRAY['https://picsum.photos/seed/shibuyafood/600/400'], ARRAY['food','nightlife']),
('Central Park Bike Tour', 'Guided cycling loop through Central Park landmarks.', 'sports', ST_SetSRID(ST_MakePoint(-73.9654, 40.7829), 4326)::geography, 'United States', 'moderate', 4.4, ARRAY['https://picsum.photos/seed/centralparkbike/600/400'], ARRAY['sports','cycling']),
('Sagrada Familia Art Walk', 'Guided architecture walk covering Gaudi''s Barcelona.', 'art_and_design', ST_SetSRID(ST_MakePoint(2.1744, 41.4036), 4326)::geography, 'Spain', 'moderate', 4.9, ARRAY['https://picsum.photos/seed/sagradafamilia/600/400'], ARRAY['art','architecture']);
