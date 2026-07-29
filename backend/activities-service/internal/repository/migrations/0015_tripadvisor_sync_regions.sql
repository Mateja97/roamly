-- Tripadvisor lazy-sync freshness tracking (see
-- docs/superpowers/specs/2026-07-29-tripadvisor-restaurants-bars-design.md).
-- cell_key is a sync anchor's lat/lng snapped to a coarse ~0.1-degree
-- (~11km) grid; paired with category so Restaurants and Bars track
-- freshness independently even when synced from the same anchor point.
CREATE TABLE tripadvisor_sync_regions (
    cell_key  TEXT NOT NULL,
    category  TEXT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (cell_key, category)
);
