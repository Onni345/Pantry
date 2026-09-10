-- Patch 003 — replaces join codes with an email allowlist.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Access stops being "something you have" (a code, which leaks and cannot be
-- taken back) and becomes "someone you are" (a verified email address).
--
-- It also closes a real hole: households_select was `using (true)`, so any
-- signed-in user could list EVERY household id — and the id was the join
-- code. A secret the server will list on request is not a secret.

/* ---------------------------------------------------------- 1. households */

-- Households are now created by hand in the dashboard, not by the app.
drop policy if exists households_insert on public.households;

alter table public.households
  add column if not exists name text;

/* ----------------------------------------------------------- 2. allowlist */

-- The mapping of who may reach which household.
-- Editable ONLY from the Supabase dashboard: there is no insert, update or
-- delete policy below, so no request carrying an app session can write here,
-- whatever it asks. Adding a person requires logging into Supabase.
create table if not exists public.household_allowlist (
  household_id uuid not null references public.households(id) on delete cascade,
  -- Always stored lower-case (see the trigger below). Comparison is exact,
  -- so a stray capital typed in the dashboard would silently lock someone
  -- out; normalising on write means "Mom@Gmail.com" just works.
  email        text not null,
  added_at     timestamptz not null default now(),
  primary key (household_id, email)
);

-- Normalise on the way in rather than rejecting: this table is edited by
-- hand in a dashboard, and a constraint error there is a puzzle, not a
-- safeguard. Trimming also absorbs a trailing space from copy-paste.
create or replace function public.normalize_allowlist_email()
returns trigger language plpgsql as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end;
$$;

drop trigger if exists allowlist_normalize on public.household_allowlist;
create trigger allowlist_normalize before insert or update on public.household_allowlist
  for each row execute function public.normalize_allowlist_email();

alter table public.household_allowlist enable row level security;

-- You may see which households YOUR address is listed against, and nothing
-- else. This is what the app reads on sign-in to know where to go.
drop policy if exists allowlist_select_self on public.household_allowlist;
create policy allowlist_select_self on public.household_allowlist
  for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

/* ------------------------------------------------------ 3. the access test */

-- Single source of truth for "may this caller touch this household?".
-- SECURITY DEFINER so it can consult the allowlist without the caller needing
-- to read it; STABLE so repeated calls in one query are cheap.
create or replace function public.can_access_household(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_allowlist a
    where a.household_id = hid
      -- The email comes from the signed token, not from anything the client
      -- sends. A device cannot claim to be someone else.
      and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.can_access_household(uuid) from public, anon;
grant execute on function public.can_access_household(uuid) to authenticated;

/* ------------------------------------------------------------ 4. policies */

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (public.can_access_household(id));

drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (public.can_access_household(household_id));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert to authenticated
  with check (public.can_access_household(household_id));

drop policy if exists items_update on public.items;
create policy items_update on public.items for update to authenticated
  using (public.can_access_household(household_id))
  with check (public.can_access_household(household_id));

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (public.can_access_household(household_id));

drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (public.can_access_household(household_id));

-- Events stay append-only: no update or delete policy. A mistake is corrected
-- by appending its inverse, which is what Undo already does.

/* -------------------------------------------------- 5. retire the old path */

-- household_members existed to record who redeemed a join code. The allowlist
-- replaces it. Dropped so no stale policy can grant access by the old rules.
drop table if exists public.household_members cascade;
drop function if exists public.is_household_member(uuid) cascade;
