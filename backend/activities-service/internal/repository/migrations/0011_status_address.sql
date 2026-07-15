-- Adds the admin panel's status and address fields (T1). The NOT NULL
-- DEFAULT below backfills every existing row to 'published' as part of the
-- column add itself (metadata-only in Postgres, no explicit UPDATE needed)
-- — the catalog is live today, so defaulting existing rows to 'draft' would
-- hide the whole thing from the app. address is nullable, same precedent as
-- city (0005): no data loss on the populated table, nothing backfills it yet.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS address TEXT;

-- Trust-boundary enforcement at the DB layer per GO_STANDARDS.md: exactly
-- these three lifecycle values, regardless of what a caller sends.
ALTER TABLE activities ADD CONSTRAINT activities_status_check CHECK (status IN ('published', 'draft', 'pending'));
