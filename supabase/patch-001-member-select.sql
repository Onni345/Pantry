-- Patch 001 — fixes "new row violates row-level security policy" when a
-- membership row is inserted with RETURNING.
-- Run in the Supabase SQL editor. Safe to re-run.

drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_household_member(household_id));
