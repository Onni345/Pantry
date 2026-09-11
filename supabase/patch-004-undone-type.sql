-- patch-004: carry `undone_type` through sync.
--
-- Why this exists: an `undo` event only cancels a consumption if the intake
-- maths knows *what kind* of event it reversed (features/macros/macros.js —
-- undoing a removal cancels eating; undoing an addition does not). That field
-- was written locally but never had a column here, so it never synced: a
-- second device pulling the same undo event saw an undo of nothing, and
-- counted the original consumption toward intake anyway. Every household with
-- more than one device has been over-counting intake after an undo.
--
-- Safe to run on a live database: additive, nullable, no rewrite, no lock of
-- consequence. Existing rows keep a null `undone_type`, which reads exactly
-- the same as today's behaviour — this fixes new undos, it does not
-- retroactively reinterpret old ones.
--
-- Run this BEFORE deploying the matching app code. The client whitelists the
-- columns it pushes, so new code against an un-migrated database would have
-- its event pushes rejected (nothing is lost — they stay queued in
-- pending_sync and retry — but sync stalls until the column exists).

alter table public.events
  add column if not exists undone_type text;
