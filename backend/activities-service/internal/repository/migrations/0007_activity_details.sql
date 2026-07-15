-- Adds the category-specific structured detail payload (T2). One JSONB
-- blob rather than ~25 nullable flat columns: the per-category shapes are
-- heterogeneous (scalars, name+price lists, checklists, tag pills) and only
-- one category's shape is ever populated per row. Existing rows default to
-- '{}' (no detail data), same "renders base layout, unique section
-- omitted" contract as an activity with no photos.
ALTER TABLE activities ADD COLUMN details JSONB NOT NULL DEFAULT '{}';
