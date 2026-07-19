-- T1: optional, category-validated subtype layer beneath category. TEXT,
-- unconstrained same as category (validity is enforced application-side by
-- activitiessvc.ValidSubcategory, not a DB CHECK — a mismatch is caught at
-- the service layer before it ever reaches SQL). No backfill needed: all
-- activity data is wiped before this ships (design doc precondition).
ALTER TABLE activities ADD COLUMN subcategory TEXT NOT NULL DEFAULT '';
