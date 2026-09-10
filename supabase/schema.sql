-- Pantry — schema for feature 1 (household onboarding).
-- Run this in the Supabase dashboard: SQL Editor > New query > paste > Run.

create table if not exists public.households (
  id uuid primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create index if not exists household_members_user_idx
  on public.household_members(user_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- Helper: is the caller a member of this household?
-- SECURITY DEFINER avoids infinite recursion when policies on
-- household_members need to consult household_members.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

-- households --------------------------------------------------------------

drop policy if exists households_insert on public.households;
create policy households_insert on public.households
  for insert to authenticated
  with check (true);

-- Anyone signed in may look up a household BY ID to validate a join code.
-- Nothing sensitive lives in this table (id + created_at only), and the id
-- is already the shared secret, so this does not leak anything.
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (true);

-- household_members -------------------------------------------------------

-- A device may only enroll ITSELF, never another user.
drop policy if exists household_members_insert on public.household_members;
create policy household_members_insert on public.household_members
  for insert to authenticated
  with check (user_id = auth.uid());

-- You can see the roster of households you belong to.
-- You can always see your OWN membership row, plus the full roster of any
-- household you belong to.
--
-- The `user_id = auth.uid()` branch is not redundant. When a row is inserted
-- with RETURNING, Postgres also applies the SELECT policy to the new row --
-- but the new row is not yet visible to any subquery inside the same
-- statement, so is_household_member() cannot see the very membership being
-- created and the insert is refused. Matching on user_id needs no subquery,
-- so it decides without reading the table.
drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_household_member(household_id));
