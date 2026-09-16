-- patch-006: sync food_cache across devices.
--
-- Why this exists: food_cache (a device's local copy of matched-food
-- nutrition — brand, package/serving weights, macros per 100 g) was
-- documented as "local only, never synced" on the theory that it's just a
-- cache and each device can always rebuild its own with one more API call.
-- That's true for a fresh lookup, but it breaks the moment a SPECIFIC
-- candidate was chosen out of several plausible matches (a barcode scan, a
-- "Find product" pick, a receipt-line disambiguation): the item's
-- `food_db_id` syncs fine through patch-002's items table, but the actual
-- food record behind that id lived only in food_cache, which never left the
-- device. A second device with an item pointing at that food_db_id has
-- nothing to look it up against, and shows "No nutrition attached" until it
-- happens to independently re-search and land on the exact same result —
-- which it often doesn't. That's the reported bug: the same item shows
-- different (or no) nutrition on different devices at the same time.
--
-- Unlike items/events, food_cache is not household data — a barcode means
-- the same product for every household, so this table has no household_id
-- and is keyed by food_db_id (the app's own "usda:123" / "off:456" ids)
-- rather than a client-generated uuid. Every signed-in user reads and
-- writes the same shared cache, same as they all read the same USDA API.
--
-- Run this in the Supabase SQL editor. Safe to re-run.

create table if not exists public.food_cache (
  food_db_id     text primary key,
  name           text,
  brand          text,
  brand_owner    text,
  upc            text,
  image          text,
  package_text   text,
  package_grams  numeric,
  serving_text   text,
  serving_grams  numeric,
  servings       jsonb,
  dataset        text,
  macros_per_unit jsonb,
  source         text,
  detail         text,
  cached_at      timestamptz,
  server_updated_at timestamptz not null default now()
);

create index if not exists food_cache_server_updated_idx
  on public.food_cache(server_updated_at);

drop trigger if exists food_cache_touch on public.food_cache;
create trigger food_cache_touch before insert or update on public.food_cache
  for each row execute function public.touch_server_updated_at();

alter table public.food_cache enable row level security;

-- Public reference data: any signed-in user may read and contribute to the
-- shared cache. There is nothing household-private in here — the same
-- barcode already means the same product to everyone — so the only bar is
-- being an authenticated user of the app at all.
drop policy if exists food_cache_select on public.food_cache;
create policy food_cache_select on public.food_cache for select to authenticated
  using (true);

drop policy if exists food_cache_insert on public.food_cache;
create policy food_cache_insert on public.food_cache for insert to authenticated
  with check (true);

drop policy if exists food_cache_update on public.food_cache;
create policy food_cache_update on public.food_cache for update to authenticated
  using (true) with check (true);

-- Run this BEFORE deploying the matching app code. The client pushes
-- food_cache rows once this exists; against an un-migrated database those
-- pushes are rejected and stay queued in pending_sync, retrying harmlessly
-- until the table is there.
