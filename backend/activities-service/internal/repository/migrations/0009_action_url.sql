-- T7: the primary CTA button is permanently disabled for the 8 categories
-- whose action links to an external page (Restaurants/Bars/Nightlife/Sport/
-- Culture/Art/Wellness/Entertainment) because no `details` field ever
-- carried a URL. This migration adds a plausible `action_url` key onto
-- every existing seed row (0002_seed.sql + 0008's backfill) in those 8
-- categories, plus a `year` on the existing Art rows' artwork attribution.
-- No new rows — only new keys merged into existing `details` JSON, matching
-- backend/shared/models/activitiessvc/activity.go's per-category structs.

UPDATE activities SET details = details || '{"action_url":"https://reservations.example.com/skadarlija-food-walk"}'::jsonb WHERE title = 'Skadarlija Food Walk';
UPDATE activities SET details = details || '{"action_url":"https://reservations.example.com/eiffel-tower-picnic"}'::jsonb WHERE title = 'Eiffel Tower Sunset Picnic';
UPDATE activities SET details = details || '{"action_url":"https://reservations.example.com/shibuya-street-food-crawl"}'::jsonb WHERE title = 'Shibuya Street Food Crawl';

UPDATE activities SET details = details || '{"action_url":"https://menus.example.com/rakia-bar-skadarlija"}'::jsonb WHERE title = 'Rakia Bar Skadarlija';

UPDATE activities SET details = details || '{"action_url":"https://guestlist.example.com/river-splavovi-night-club"}'::jsonb WHERE title = 'River Splavovi Night Club';

UPDATE activities SET details = details || '{"action_url":"https://booking.example.com/kayaking-sava"}'::jsonb WHERE title = 'Kayaking on the Sava';
UPDATE activities SET details = details || '{"action_url":"https://booking.example.com/zemun-riverside-cycling"}'::jsonb WHERE title = 'Zemun Riverside Cycling';
UPDATE activities SET details = details || '{"action_url":"https://booking.example.com/central-park-bike-tour"}'::jsonb WHERE title = 'Central Park Bike Tour';

UPDATE activities SET details = details || '{"action_url":"https://tickets.example.com/belgrade-fortress-kalemegdan"}'::jsonb WHERE title = 'Belgrade Fortress & Kalemegdan Park';
UPDATE activities SET details = details || '{"action_url":"https://tickets.example.com/colosseum-guided-tour"}'::jsonb WHERE title = 'Colosseum Guided Tour';

UPDATE activities SET details = details || '{"action_url":"https://tickets.example.com/street-art-tour-savamala","year":2021}'::jsonb WHERE title = 'Street Art Tour Savamala';
UPDATE activities SET details = details || '{"action_url":"https://tickets.example.com/sagrada-familia-art-walk","year":1935}'::jsonb WHERE title = 'Sagrada Familia Art Walk';

UPDATE activities SET details = details || '{"action_url":"https://booking.example.com/belgrade-spa-wellness-day"}'::jsonb WHERE title = 'Belgrade Spa & Wellness Day';

UPDATE activities SET details = details || '{"action_url":"https://tickets.example.com/sava-center-live-music-hall"}'::jsonb WHERE title = 'Sava Center Live Music Hall';
