/**
 * The only module that touches Dexie. Components call these functions; they
 * never import `db` themselves.
 *
 * Quantity is never stored. An item's quantity is the sum of the
 * quantity_delta of its events. That makes every write an append, and appends
 * from two offline devices merge without conflict — there is no shared number
 * for them to disagree about.
 */
import { db, EVENT_TYPES } from './schema.js';
import { getDeviceId } from '../auth/household.js';
import { toBase, baseUnitFor } from '../units.js';

const now = () => new Date().toISOString();

/** Every local write also enqueues itself for the sync layer (feature 5). */
function enqueue(tx, target_table, operation, payload) {
  return tx.table('pending_sync').put({
    local_id: crypto.randomUUID(),
    target_table,
    operation,
    payload,
    created_at: now()
  });
}

export async function addItem(householdId, fields) {
  const {
    name,
    category = 'other',
    unit = 'count',
    location = 'pantry',
    quantity = 1,
    food_db_id = null,
    expiry_date = null
  } = fields;

  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('An item needs a name.');

  // The unit it was bought in fixes the item's dimension; from then on the
  // item is stored in that dimension's base unit and `display_unit` is only a
  // presentation choice.
  const base_unit = baseUnitFor(unit);
  if (!base_unit) throw new Error(`Unknown unit: ${unit}`);

  const item = {
    id: crypto.randomUUID(),
    household_id: householdId,
    name: trimmed,
    category,
    base_unit,
    display_unit: unit,
    location,
    food_db_id,
    expiry_date,
    created_at: now(),
    updated_at: now(),
    deleted: 0 // Dexie cannot index booleans; 0/1 keeps `deleted` queryable
  };

  const amount = Number(quantity) || 0;
  const converted = amount > 0 ? toBase(amount, unit, base_unit) : null;

  const event = converted != null
    ? {
        id: crypto.randomUUID(),
        household_id: householdId,
        item_id: item.id,
        type: EVENT_TYPES.ADD,
        quantity_delta: converted,
        entered_value: amount,
        entered_unit: unit,
        timestamp: now(),
        device_id: getDeviceId()
      }
    : null;

  await db.transaction('rw', db.items, db.events, db.pending_sync, async (tx) => {
    await tx.table('items').put(item);
    await enqueue(tx, 'items', 'insert', item);
    if (event) {
      await tx.table('events').put(event);
      await enqueue(tx, 'events', 'insert', event);
    }
  });

  return item;
}

/**
 * Records a change in quantity, entered in whatever unit suits the moment.
 *
 * `direction` is 'add' or 'remove'; `value`/`unit` are what the user typed.
 * The delta is converted to the item's base unit before it is stored, and the
 * typed amount is kept alongside, so the log can say "2 oz" rather than
 * "-56.7".
 */
export async function logAmount(householdId, itemId, { value, unit, direction = 'remove', type }) {
  const item = await db.items.get(itemId);
  if (!item) throw new Error('Item not found.');

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter an amount greater than zero.');
  }

  const converted = toBase(amount, unit, item.base_unit);
  const signed = direction === 'add' ? converted : -converted;

  const event = {
    id: crypto.randomUUID(),
    household_id: householdId,
    item_id: itemId,
    type: type || (direction === 'add' ? EVENT_TYPES.ADD : EVENT_TYPES.REMOVE),
    quantity_delta: signed,
    entered_value: amount,
    entered_unit: unit,
    timestamp: now(),
    device_id: getDeviceId()
  };

  await db.transaction('rw', db.events, db.pending_sync, async (tx) => {
    await tx.table('events').put(event);
    await enqueue(tx, 'events', 'insert', event);
  });

  return event;
}

/** Raw base-unit delta. Used internally by markEmpty and undo. */
export async function logBaseDelta(householdId, itemId, baseDelta, type) {
  const amount = Number(baseDelta);
  if (!amount) throw new Error('Delta must be a non-zero number.');

  const event = {
    id: crypto.randomUUID(),
    household_id: householdId,
    item_id: itemId,
    type: type || (amount > 0 ? EVENT_TYPES.ADD : EVENT_TYPES.REMOVE),
    quantity_delta: amount,
    entered_value: null,
    entered_unit: null,
    timestamp: now(),
    device_id: getDeviceId()
  };

  await db.transaction('rw', db.events, db.pending_sync, async (tx) => {
    await tx.table('events').put(event);
    await enqueue(tx, 'events', 'insert', event);
  });

  return event;
}

/** Fills in an estimated expiry date after the fact, if the item has none. */
export async function setEstimatedExpiry(householdId, itemId, expiry_date) {
  if (!expiry_date) return null;
  const item = await db.items.get(itemId);
  if (!item || item.expiry_date) return null;
  return updateItem(householdId, itemId, { expiry_date, expiry_estimated: 1 });
}

export async function updateItem(householdId, itemId, changes) {
  const existing = await db.items.get(itemId);
  if (!existing) throw new Error('Item not found.');

  const updated = { ...existing, ...changes, updated_at: now() };

  await db.transaction('rw', db.items, db.pending_sync, async (tx) => {
    await tx.table('items').put(updated);
    await enqueue(tx, 'items', 'update', updated);
  });

  return updated;
}

/** Soft delete — the row stays so other devices learn it was removed. */
export function removeItem(householdId, itemId) {
  return updateItem(householdId, itemId, { deleted: 1 });
}

/**
 * Items for a household with their derived quantities, newest first.
 * Clamped at zero: two devices can each zero out the same item while offline,
 * and the sum would go negative without this.
 */
export async function listItems(householdId) {
  const [items, events, foods] = await Promise.all([
    db.items.where('household_id').equals(householdId).toArray(),
    db.events.where('household_id').equals(householdId).toArray(),
    db.food_cache.toArray()
  ]);

  const macrosById = new Map(foods.map((f) => [f.food_db_id, f.macros_per_unit]));

  const totals = new Map();
  for (const e of events) {
    totals.set(e.item_id, (totals.get(e.item_id) || 0) + Number(e.quantity_delta || 0));
  }

  return items
    .filter((i) => !i.deleted)
    .map((i) => ({
      ...i,
      quantity: Math.max(0, totals.get(i.id) || 0),
      macros: i.food_db_id ? macrosById.get(i.food_db_id) || null : null
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Current quantity for one item, derived the same way listItems derives it. */
export async function getQuantity(itemId) {
  const events = await db.events.where('item_id').equals(itemId).toArray();
  const total = events.reduce((sum, e) => sum + Number(e.quantity_delta || 0), 0);
  return Math.max(0, total);
}

/**
 * "I finished it" — the drift correction.
 *
 * Real use undercounts: you pour a splash of milk five times without logging
 * any of them, so the stored total drifts above what's actually in the fridge.
 * Rather than letting the user edit the number to zero (which would mean
 * storing a quantity, the one thing this design avoids), this appends one
 * event large enough to bring the sum to exactly zero. The log stays a true
 * history: it records that an unmeasured remainder was consumed, and when.
 */
export async function markEmpty(householdId, itemId) {
  const qty = await getQuantity(itemId);
  if (qty <= 0) return null;
  return logBaseDelta(householdId, itemId, -qty, EVENT_TYPES.CONSUMED_REMAINDER);
}

/**
 * Undoes the most recent event for an item by appending its inverse.
 *
 * Nothing is deleted: the history keeps both the mistake and the correction,
 * which is what an append-only log is for. Cheap here precisely because
 * quantity is derived -- undo is just another row.
 */
export async function undoLast(householdId, itemId) {
  const events = await db.events.where('item_id').equals(itemId).toArray();
  if (events.length === 0) return null;

  const last = events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
  if (last.type === EVENT_TYPES.UNDO) return null; // don't undo an undo

  const event = await logBaseDelta(
    householdId, itemId, -Number(last.quantity_delta), EVENT_TYPES.UNDO
  );
  // Which kind of event this reversed. An undone removal must cancel the
  // consumption it recorded; an undone addition must not count as eating.
  await db.events.update(event.id, { undone_type: last.type });
  return { ...event, undone_type: last.type };
}

export function getEventsForItem(itemId) {
  return db.events.where('item_id').equals(itemId).toArray();
}

/** Debug helper — how many writes are waiting for the sync layer. */
export function pendingSyncCount() {
  return db.pending_sync.count();
}

/** Everything the macro summary needs, in one read. */
export async function getMacroInputs(householdId) {
  const [items, events, foods] = await Promise.all([
    db.items.where('household_id').equals(householdId).toArray(),
    db.events.where('household_id').equals(householdId).toArray(),
    db.food_cache.toArray()
  ]);
  return { items, events, foods };
}

/* ---------------------------------------------------------------- food cache
 * Local only — never synced. It is a cache of public reference data, so each
 * device rebuilding its own costs one API call and nothing is lost if it is
 * cleared.
 */

export async function cacheFood(food) {
  await db.food_cache.put({
    food_db_id: food.food_db_id,
    name: food.name,
    macros_per_unit: food.macros_per_unit,
    source: food.source,
    detail: food.detail || '',
    cached_at: now()
  });
  return food;
}

export function getCachedFood(foodDbId) {
  return db.food_cache.get(foodDbId);
}

/** Substring match over cached foods, so lookup still works offline. */
export async function searchCachedFoods(query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const all = await db.food_cache.toArray();
  return all
    .filter((f) => String(f.name || '').toLowerCase().includes(q))
    .slice(0, limit);
}
