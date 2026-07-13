-- Replaces the plain image_refs URL array with a photos JSONB column that
-- carries each photo's Google Places author attribution (author name +
-- link) alongside its URL, per T3. Existing image_refs values (0002's
-- picsum.photos placeholders) are dropped rather than migrated — none of
-- them are a legitimate photo source, so there is nothing worth carrying
-- forward. An empty photos array is a supported state: it renders as the
-- existing missing-image fallback, same as an unresolved Google photo.
ALTER TABLE activities ADD COLUMN photos JSONB NOT NULL DEFAULT '[]';
ALTER TABLE activities DROP COLUMN image_refs;
