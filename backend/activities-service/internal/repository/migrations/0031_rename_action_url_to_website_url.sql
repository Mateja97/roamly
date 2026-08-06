-- T1 (website-url-action-chip): the `action_url` details key is renamed to
-- `website_url` everywhere — the field always meant "the venue's website",
-- and 5 more categories (cafes, nature, kids, shopping, tours_experiences)
-- are gaining the same field under the new name (see activity.go), so
-- carrying the old CTA-label-derived name into 13 categories would be worse
-- than fixing it once. No dual-key fallback (product decision) — this is a
-- straight rename, value preserved, for every row/category that has the key.
-- Idempotent via the `details ? 'action_url'` guard.
UPDATE activities
SET details = (details - 'action_url') || jsonb_build_object('website_url', details -> 'action_url')
WHERE details ? 'action_url';
