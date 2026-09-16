/**
 * Sync between the local Dexie database and Supabase.
 *
 * Shape of it:
 *   1. Local writes already queued themselves in `pending_sync` in the same
 *      transaction as the data. This module drains that queue.
 *   2. Push each queued row with an upsert keyed on the client-generated id,
 *      so re-pushing a row that already landed is a harmless no-op. On failure
 *      the row stays queued and is retried.
 *   3. Pull everything the server has seen since our cursor, and merge it in.
 *
 * The cursor is `server_updated_at`, set by Postgres — not by a device.
 * Device clocks disagree by minutes, and a device whose clock runs fast would
 * otherwise skip every row written while it was ahead.
 */
import { db } from './schema.js';
import { supabase, isConfigured } from './supabaseClient.js';

const CURSOR_KEY = 'pantry.last_synced_at';

/**
 * Re-read a short window before the cursor on every pull.
 *
 * Rows become visible in commit order, not timestamp order, so a row stamped
 * at T can appear after we have already read past T. Re-reading a few seconds
 * costs nothing — upserts are idempotent — and closes that gap.
 */
const OVERLAP_MS = 10_000;

const getCursor = (householdId) =>
  localStorage.getItem(`${CURSOR_KEY}.${householdId}`) || '1970-01-01T00:00:00Z';

function setCursor(householdId, iso) {
  localStorage.setItem(`${CURSOR_KEY}.${householdId}`, iso);
}

/* ------------------------------------------------------------ row mapping */
// Dexie cannot index booleans, so `deleted` is 0/1 locally and boolean in
// Postgres. These two functions are the only place that difference exists.

const itemToRemote = (i) => ({
  id: i.id,
  household_id: i.household_id,
  name: i.name,
  category: i.category ?? null,
  location: i.location ?? null,
  base_unit: i.base_unit,
  display_unit: i.display_unit ?? null,
  // The two weights. Without these an item that syncs to a second device
  // arrives with no idea what one of it weighs, so it contributes nothing to
  // intake there — the same silent class of bug as undone_type. Both need
  // their columns server-side (patch-005) or these pushes are rejected.
  grams_each: i.grams_each ?? null,
  pack_grams: i.pack_grams ?? null,
  food_db_id: i.food_db_id ?? null,
  expiry_date: i.expiry_date ?? null,
  deleted: Boolean(i.deleted),
  created_at: i.created_at,
  updated_at: i.updated_at
});

const itemToLocal = (r) => ({
  id: r.id,
  household_id: r.household_id,
  name: r.name,
  category: r.category,
  location: r.location,
  base_unit: r.base_unit,
  display_unit: r.display_unit,
  grams_each: r.grams_each ?? null,
  pack_grams: r.pack_grams ?? null,
  food_db_id: r.food_db_id,
  expiry_date: r.expiry_date,
  deleted: r.deleted ? 1 : 0,
  created_at: r.created_at,
  updated_at: r.updated_at
});

const eventToRemote = (e) => ({
  id: e.id,
  household_id: e.household_id,
  item_id: e.item_id,
  type: e.type,
  quantity_delta: e.quantity_delta,
  entered_value: e.entered_value ?? null,
  entered_unit: e.entered_unit ?? null,
  timestamp: e.timestamp,
  device_id: e.device_id ?? null,
  // Which kind of event an undo reversed. Without this the intake maths on
  // another device cannot tell "I didn't eat that after all" from "I didn't
  // buy that after all" — see supabase/patch-004-undone-type.sql.
  undone_type: e.undone_type ?? null
});

// food_cache is reference data, not household data — keyed by food_db_id,
// the same for every household that ever looks that food up — so there is
// no household_id to carry and no household filter on the pull below.
const foodToRemote = (f) => ({
  food_db_id: f.food_db_id,
  name: f.name,
  brand: f.brand || '',
  brand_owner: f.brand_owner || '',
  upc: f.upc || '',
  image: f.image ?? null,
  package_text: f.package_text || '',
  package_grams: f.package_grams ?? null,
  serving_text: f.serving_text || '',
  serving_grams: f.serving_grams ?? null,
  servings: f.servings || [],
  dataset: f.dataset || '',
  macros_per_unit: f.macros_per_unit ?? null,
  source: f.source || '',
  detail: f.detail || '',
  cached_at: f.cached_at
});

const foodToLocal = (r) => ({
  food_db_id: r.food_db_id,
  name: r.name,
  brand: r.brand,
  brand_owner: r.brand_owner,
  upc: r.upc,
  image: r.image,
  package_text: r.package_text,
  package_grams: r.package_grams,
  serving_text: r.serving_text,
  serving_grams: r.serving_grams,
  servings: r.servings || [],
  dataset: r.dataset,
  macros_per_unit: r.macros_per_unit,
  source: r.source,
  detail: r.detail,
  cached_at: r.cached_at
});

const eventToLocal = (r) => ({
  id: r.id,
  household_id: r.household_id,
  item_id: r.item_id,
  type: r.type,
  quantity_delta: Number(r.quantity_delta),
  entered_value: r.entered_value == null ? null : Number(r.entered_value),
  entered_unit: r.entered_unit,
  timestamp: r.timestamp,
  device_id: r.device_id,
  undone_type: r.undone_type ?? null
});

/* -------------------------------------------------------------------- push */

async function push(householdId) {
  const queued = await db.pending_sync.orderBy('created_at').toArray();
  if (queued.length === 0) return { pushed: 0, failed: 0 };

  let pushed = 0;
  let failed = 0;

  // Batched by table, in queue order, so an item lands before events that
  // reference it wherever possible.
  for (const row of queued) {
    const payload =
      row.target_table === 'items' ? itemToRemote(row.payload)
      : row.target_table === 'food_cache' ? foodToRemote(row.payload)
      : eventToRemote(row.payload);

    // food_cache is keyed by food_db_id, not the client-generated `id` every
    // other synced row uses — it's a global cache, not a row someone created.
    const conflictKey = row.target_table === 'food_cache' ? 'food_db_id' : 'id';

    const { error } = await supabase
      .from(row.target_table)
      .upsert(payload, { onConflict: conflictKey });

    if (error) {
      failed++;
      // Leave it queued. A transient failure retries; a permanent one (bad
      // row, revoked access) would otherwise block the queue forever, so it
      // is surfaced rather than silently dropped.
      console.warn('sync: push failed', row.target_table, error.message);
      continue;
    }

    await db.pending_sync.delete(row.local_id);
    pushed++;
  }

  return { pushed, failed };
}

/* -------------------------------------------------------------------- pull */

async function pullTable(table, householdId, since, toLocal) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('household_id', householdId)
    .gt('server_updated_at', since)
    .order('server_updated_at', { ascending: true })
    .limit(1000);

  if (error) throw error;
  return { rows: (data || []).map(toLocal), raw: data || [] };
}

/**
 * Same shape as `pullTable`, but food_cache has no household_id — it's a
 * shared cache of public reference data, so every device pulls every food
 * anyone has ever looked up rather than just its own household's.
 */
async function pullFoodCache(since) {
  const { data, error } = await supabase
    .from('food_cache')
    .select('*')
    .gt('server_updated_at', since)
    .order('server_updated_at', { ascending: true })
    .limit(1000);

  if (error) throw error;
  return { rows: (data || []).map(foodToLocal), raw: data || [] };
}

async function pull(householdId) {
  const cursor = getCursor(householdId);
  const since = new Date(Math.max(0, Date.parse(cursor) - OVERLAP_MS)).toISOString();

  const [items, events, foods] = await Promise.all([
    pullTable('items', householdId, since, itemToLocal),
    pullTable('events', householdId, since, eventToLocal),
    pullFoodCache(since)
  ]);

  await db.transaction('rw', db.items, db.events, db.food_cache, async (tx) => {
    // Items: last write wins on updated_at. A remote row older than what this
    // device already has is a stale echo of a change we made — ignore it.
    for (const remote of items.rows) {
      const local = await tx.table('items').get(remote.id);
      if (!local || String(remote.updated_at) >= String(local.updated_at)) {
        await tx.table('items').put(remote);
      }
    }

    // Events are immutable, so there is nothing to reconcile: put by id and
    // duplicates collapse onto themselves.
    if (events.rows.length) await tx.table('events').bulkPut(events.rows);

    // Foods: last write wins on cached_at, same reasoning as items — a
    // device that just enriched a food (loadServings) shouldn't have that
    // overwritten by an older remote echo of the same food_db_id.
    for (const remote of foods.rows) {
      const local = await tx.table('food_cache').get(remote.food_db_id);
      if (!local || String(remote.cached_at) >= String(local.cached_at)) {
        await tx.table('food_cache').put(remote);
      }
    }
  });

  const stamps = [...items.raw, ...events.raw, ...foods.raw]
    .map((r) => r.server_updated_at)
    .filter(Boolean)
    .sort();
  if (stamps.length) setCursor(householdId, stamps[stamps.length - 1]);

  return { items: items.rows.length, events: events.rows.length, foods: foods.rows.length };
}

/* ------------------------------------------------------------------- entry */

let inFlight = null;

/**
 * One full cycle. Concurrent calls share the in-flight promise rather than
 * racing — several UI actions in quick succession should not mean several
 * overlapping syncs.
 */
export function syncNow(householdId) {
  if (!isConfigured || !householdId) {
    return Promise.resolve({ ok: false, reason: 'not-configured' });
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, reason: 'offline' };
    }
    try {
      const pushed = await push(householdId);
      const pulled = await pull(householdId);
      return { ok: true, ...pushed, ...pulled };
    } catch (e) {
      console.warn('sync: cycle failed', e.message);
      return { ok: false, reason: 'error', message: e.message };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function pendingCount() {
  return db.pending_sync.count();
}

/**
 * Runs a cycle now, whenever the device comes back online, when the tab is
 * refocused, and on a slow poll as a backstop. Returns an unsubscribe.
 */
export function startSync(householdId, { onCycle, intervalMs = 30_000 } = {}) {
  let stopped = false;

  const run = async (why) => {
    if (stopped) return;
    const result = await syncNow(householdId);
    onCycle?.({ ...result, why });
  };

  const onOnline = () => run('online');
  const onVisible = () => document.visibilityState === 'visible' && run('focus');

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => run('poll'), intervalMs);

  run('start');

  return () => {
    stopped = true;
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
