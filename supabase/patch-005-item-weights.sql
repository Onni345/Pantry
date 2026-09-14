-- patch-005: carry the two item weights through sync.
--
-- Why this exists: `grams_each` (what one egg / slice / potato weighs) and
-- `pack_grams` (what one whole package weighs) are the only bridge between
-- the nouns the app counts in and the per-100 g figures nutrition is
-- published in. Both were written locally and neither had a column here, so
-- neither ever synced. An item created on a phone arrived on a laptop with no
-- weight at all — and an item with no weight contributes exactly zero to
-- intake, however carefully it was logged. Same silent class of bug as
-- patch-004's undone_type.
--
-- pack_grams is also what makes "26% of the jar" and "13 potatoes in a 5 lb
-- bag" sayable, so without it a second device loses the readable amounts too,
-- not only the macros.
--
-- Safe to run on a live database: additive, nullable, no rewrite, no lock of
-- consequence. Existing rows keep nulls, which reads exactly as today.
--
-- Run this BEFORE deploying the matching app code. The client whitelists the
-- columns it pushes, so new code against an un-migrated database has its item
-- pushes rejected — nothing is lost, rows stay queued in pending_sync and
-- retry, but sync stalls until these columns exist.

alter table public.items
  add column if not exists grams_each numeric;

alter table public.items
  add column if not exists pack_grams numeric;
