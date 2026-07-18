-- Ingestion pipeline (see docs/superpowers/specs/2026-07-17-activity-ingestion-design.md).
-- source/source_url identify and dedupe scraped rows; raw keeps the original
-- extraction so details can be re-shaped later without re-scraping. description
-- becomes nullable as a safety net — a scraped row with no prose renders the
-- base detail layout (same contract as empty details, 0007). external_id is
-- the provider's stable identifier (Google Places place_id) — a plain
-- attribute, not the dedup key; source_url stays the unique index below.
ALTER TABLE activities ADD COLUMN source      TEXT;
ALTER TABLE activities ADD COLUMN source_url  TEXT;
ALTER TABLE activities ADD COLUMN external_id TEXT;
ALTER TABLE activities ADD COLUMN raw         JSONB NOT NULL DEFAULT '{}';
ALTER TABLE activities ALTER COLUMN description DROP NOT NULL;

-- Upsert key: one row per source_url. Partial index so multiple legacy/admin
-- rows with NULL source_url stay allowed.
CREATE UNIQUE INDEX activities_source_url_key ON activities (source_url) WHERE source_url IS NOT NULL;
