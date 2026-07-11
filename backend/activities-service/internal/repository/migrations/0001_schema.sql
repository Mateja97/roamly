CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS activities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL,
    location    GEOGRAPHY(POINT, 4326) NOT NULL,
    country     TEXT NOT NULL,
    price_tier  TEXT NOT NULL,
    rating      DOUBLE PRECISION NOT NULL,
    image_refs  TEXT[] NOT NULL DEFAULT '{}',
    tags        TEXT[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index: home/nearby scope queries filter with ST_DWithin against
-- this column and must use the index rather than a full table scan.
CREATE INDEX IF NOT EXISTS activities_location_gix ON activities USING GIST (location);
CREATE INDEX IF NOT EXISTS activities_country_idx ON activities (country);
CREATE INDEX IF NOT EXISTS activities_category_idx ON activities (category);
