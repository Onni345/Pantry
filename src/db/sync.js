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
  device_id: e.device_id ?? null
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
  device_id: r.device_id
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
      row.target_table === 'items' ? itemToRemote(row.payload) : eventToRemote(row.payload);

    const { error } = await supabase
      .from(row.target_table)
      .upsert(payload, { onConflict: 'id' });

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

async function pull(householdId) {
  const cursor = getCursor(householdId);
  const since = new Date(Math.max(0, Date.parse(cursor) - OVERLAP_MS)).toISOString();

  const [items, events] = await Promise.all([
    pullTable('items', householdId, since, itemToLocal),
    pullTable('events', householdId, since, eventToLocal)
  ]);

  await db.transaction('rw', db.items, db.events, async (tx) => {
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
  });

  const stamps = [...items.raw, ...events.raw]
    .map((r) => r.server_updated_at)
    .filter(Boolean)
    .sort();
  if (stamps.length) setCursor(householdId, stamps[stamps.length - 1]);

  return { items: items.rows.length, events: events.rows.length };
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
