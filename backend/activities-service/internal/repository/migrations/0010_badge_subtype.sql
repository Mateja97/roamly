-- T8: the category badge's subtype qualifier ("Nightlife · Club",
-- "Sport · Climbing", "Wellness · Spa") had no backing field for these 3
-- categories. Adds a plausible value onto every existing seed row, same
-- merge-only pattern as 0009_action_url.sql.

UPDATE activities SET details = details || '{"venue_type":"Club"}'::jsonb WHERE title = 'River Splavovi Night Club';

UPDATE activities SET details = details || '{"discipline":"Kayaking"}'::jsonb WHERE title = 'Kayaking on the Sava';
UPDATE activities SET details = details || '{"discipline":"Cycling"}'::jsonb WHERE title = 'Zemun Riverside Cycling';
UPDATE activities SET details = details || '{"discipline":"Cycling"}'::jsonb WHERE title = 'Central Park Bike Tour';

UPDATE activities SET details = details || '{"venue_type":"Spa"}'::jsonb WHERE title = 'Belgrade Spa & Wellness Day';
