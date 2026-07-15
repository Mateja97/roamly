-- T5: the seed catalog (0002_seed.sql) only ever had 12 rows across the old
-- 6-category taxonomy; 0006's remap lands them on only 6 of the 12 new
-- categories, and 0007's `details` column was never backfilled on any row.
-- This migration closes both gaps: one new demo activity per empty category,
-- plus a realistic `details` payload on every one of the 12 categories' rows
-- (JSON shapes match backend/shared/models/activitiessvc/activity.go's
-- per-category structs exactly).

-- New demo activities for the 6 categories with zero rows. Belgrade cluster
-- A coordinates (see 0002_seed.sql), no photos placeholder (same reasoning
-- as 0002_seed.sql/0004_photos.sql: real photos are backfilled later via
-- cmd/resolvephotos; `photos` already defaults to '[]').
INSERT INTO activities (title, description, category, location, country, city, rating, tags, details) VALUES
('Coffee Dictionary Skadarlija', 'Specialty third-wave coffee bar in the bohemian quarter.', 'cafes', ST_SetSRID(ST_MakePoint(20.4620, 44.8140), 4326)::geography, 'Serbia', 'Belgrade', 4.6, ARRAY['coffee','wifi'],
  '{"known_for_brew":"Single-origin Ethiopian pour-over","wifi_quality":"Fast, plenty of outlets","hours":"07:00-22:00","on_the_bar":[{"name":"Flat White","price":"320 RSD"},{"name":"Almond Croissant","price":"280 RSD"}]}'::jsonb),
('Rakia Bar Skadarlija', 'Cozy tasting bar pouring house-infused rakia flights.', 'bars', ST_SetSRID(ST_MakePoint(20.4650, 44.8155), 4326)::geography, 'Serbia', 'Belgrade', 4.5, ARRAY['bar','rakia'],
  '{"vibe":"Cozy, wood-paneled tasting room","happy_hour_window":"17:00-19:00","opens_time":"16:00","signature_pours":["Quince Rakia","Walnut Rakia","Honey Rakia"]}'::jsonb),
('River Splavovi Night Club', 'Riverboat club with resident DJs and Danube views.', 'nightlife', ST_SetSRID(ST_MakePoint(20.4550, 44.8100), 4326)::geography, 'Serbia', 'Belgrade', 4.3, ARRAY['nightlife','club'],
  '{"entry_price":"1000 RSD","dress_code":"Smart casual","opens_time":"23:00","open_tonight":true,"lineup":[{"time":"23:30","act":"DJ Nemanja","stage":"Main Deck"},{"time":"01:00","act":"DJ Iva","stage":"Lower Deck"}]}'::jsonb),
('Belgrade Zoo Family Day', 'Family-friendly zoo visit with keeper talks and play areas.', 'kids', ST_SetSRID(ST_MakePoint(20.4580, 44.8250), 4326)::geography, 'Serbia', 'Belgrade', 4.4, ARRAY['kids','family'],
  '{"age_range":"All ages","facilities":["Stroller rental","Baby changing rooms","Playground","Picnic area"]}'::jsonb),
('Sava Center Live Music Hall', 'Mid-size venue hosting touring bands and local acts.', 'entertainment', ST_SetSRID(ST_MakePoint(20.4650, 44.8000), 4326)::geography, 'Serbia', 'Belgrade', 4.5, ARRAY['music','live'],
  '{"genre":"Indie & Rock","neighborhood":"New Belgrade","upcoming_shows":[{"date":"2026-08-02","title":"Local Openers Night","time_or_price":"800 RSD"},{"date":"2026-08-15","title":"Touring Headliner","time_or_price":"1500 RSD"}]}'::jsonb),
('Knez Mihailova Shopping Walk', 'Guided walk through Belgrade''s main pedestrian shopping street.', 'shopping', ST_SetSRID(ST_MakePoint(20.4590, 44.8175), 4326)::geography, 'Serbia', 'Belgrade', 4.2, ARRAY['shopping','boutiques'],
  '{"venue_type":"Pedestrian shopping street","best_day":"Saturday","hours":"10:00-21:00","what_youll_find":["Local designer boutiques","Souvenir shops","Bookstores","Street performers"]}'::jsonb);

-- Backfill `details` onto the 6 pre-existing categories' seed rows (targeted
-- by their exact 0002_seed.sql titles).
UPDATE activities SET details = '{"cuisine":"Serbian","price_tier":"$$","hours":"11:00-23:00","open_status":"Open now","popular_dishes":[{"name":"Cevapi Platter","price":"900 RSD"},{"name":"Grilled Trout","price":"1400 RSD"}]}'::jsonb WHERE title = 'Skadarlija Food Walk';
UPDATE activities SET details = '{"cuisine":"French","price_tier":"$$$","hours":"17:00-21:00","open_status":"Open now","popular_dishes":[{"name":"Cheese & Charcuterie Board","price":"28 EUR"},{"name":"Champagne Pairing","price":"18 EUR"}]}'::jsonb WHERE title = 'Eiffel Tower Sunset Picnic';
UPDATE activities SET details = '{"cuisine":"Japanese","price_tier":"$$","hours":"18:00-01:00","open_status":"Open now","popular_dishes":[{"name":"Takoyaki","price":"600 JPY"},{"name":"Yakitori Skewers","price":"450 JPY"}]}'::jsonb WHERE title = 'Shibuya Street Food Crawl';

UPDATE activities SET details = '{"venue_type":"Historic landmark","ticket_price":"Free entry","hours":"08:00-20:00","now_showing":{"title":"Roman Well Exhibit","description":"Guided descent into the 62-metre well beneath the fortress."}}'::jsonb WHERE title = 'Belgrade Fortress & Kalemegdan Park';
UPDATE activities SET details = '{"venue_type":"Ancient monument","ticket_price":"18 EUR","hours":"09:00-19:00","now_showing":{"title":"Underground Chambers Tour","description":"Limited-access tour of the arena''s hypogeum."}}'::jsonb WHERE title = 'Colosseum Guided Tour';

UPDATE activities SET details = '{"time_to_spend":"2-3 hours","best_time":"Early morning","cost":"Free","good_to_know":["Bring swimwear in summer","Bike rentals available at the entrance","Gets crowded on weekends"]}'::jsonb WHERE title = 'Ada Ciganlija Lake Walk';

UPDATE activities SET details = '{"venue_type":"Open-air gallery district","ticket_price":"Free","hours":"Anytime (outdoor)","artwork":{"artist":"Various local artists","work":"Savamala Murals","medium":"Spray paint on brick"},"current_exhibition":{"title":"Mikser House Collective","description":"Rotating collection of large-scale murals along Karadjordjeva."}}'::jsonb WHERE title = 'Street Art Tour Savamala';
UPDATE activities SET details = '{"venue_type":"Architecture landmark","ticket_price":"26 EUR","hours":"09:00-18:00","artwork":{"artist":"Antoni Gaudi","work":"Sagrada Familia Facades","medium":"Stone and stained glass"},"current_exhibition":{"title":"Nativity Facade Restoration","description":"Close-up viewing platform for the ongoing stonework restoration."}}'::jsonb WHERE title = 'Sagrada Familia Art Walk';

UPDATE activities SET details = '{"difficulty":2,"effort_level":"Moderate","duration":"2 hours","gear":"Kayak, paddle, life vest provided","what_to_bring":["Swimwear","Sunscreen","Change of clothes"]}'::jsonb WHERE title = 'Kayaking on the Sava';
UPDATE activities SET details = '{"difficulty":1,"effort_level":"Easy","duration":"1.5 hours","gear":"Bike and helmet provided","what_to_bring":["Water bottle","Comfortable shoes"]}'::jsonb WHERE title = 'Zemun Riverside Cycling';
UPDATE activities SET details = '{"difficulty":1,"effort_level":"Easy","duration":"2 hours","gear":"Bike, helmet and lock provided","what_to_bring":["Water bottle","Camera"]}'::jsonb WHERE title = 'Central Park Bike Tour';

UPDATE activities SET details = '{"treatments":[{"item":"Thermal Pool Access","duration":"Full day","price":"3500 RSD"},{"item":"Swedish Massage","duration":"60 min","price":"4500 RSD"}],"external_booking_note":"Book treatments at least 24 hours in advance via the front desk."}'::jsonb WHERE title = 'Belgrade Spa & Wellness Day';
