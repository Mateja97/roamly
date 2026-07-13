-- Drops the dead, unused price-tier filter column. IF EXISTS: a no-op on
-- fresh installs where 0001_schema.sql never creates the column.
ALTER TABLE activities DROP COLUMN IF EXISTS price_tier;
