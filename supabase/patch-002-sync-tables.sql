-- Patch 002 — items and events tables for sync.
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists public.items (
  id            uuid primary key,
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null,
  category      text,
  location      text,
  base_unit     text not null,
  display_unit  text,
  food_db_id    text,
  expiry_date   date,
  deleted       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Set by the server, never by a device. Devices disagree about the time;
  -- this column is the one clock every device can trust, so it is what the
  -- pull cursor compares against.
  server_updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id             uuid primary key,
  household_id   uuid not null references public.households(id) on delete cascade,
  item_id        uuid not null,
  type           text not null,
  quantity_delta numeric not null,
  entered_value  numeric,
  entered_unit   text,
  "timestamp"    timestamptz not null default now(),
  device_id      text,
  server_updated_at timestamptz not null default now()
);

-- No FK from events.item_id to items.id on purpose: an offline device can
-- push an event before its item lands, and a foreign key would reject the
-- event instead of letting it settle a moment later.

create index if not exists items_household_idx  on public.items(household_id, server_updated_at);
create index if not exists events_household_idx on public.events(household_id, server_updated_at);
create index if not exists events_item_idx      on public.events(item_id);

-- Keep server_updated_at honest on every write, including upserts.
create or replace function public.touch_server_updated_at()
returns trigger language plpgsql as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.touch_server_updated_at();

drop trigger if exists events_touch on public.events;
create trigger events_touch before insert or update on public.events
  for each row execute function public.touch_server_updated_at();

alter table public.items  enable row level security;
alter table public.events enable row level security;

-- Every policy is scoped by household membership, enforced by Postgres.
-- A device holding the publishable key still cannot read or write another
-- household's rows.

drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists items_update on public.items;
create policy items_update on public.items for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (public.is_household_member(household_id));

-- Events are an append-only log. There is deliberately no update or delete
-- policy: a mistake is corrected by appending its inverse, not by rewriting
-- history.
