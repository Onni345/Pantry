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
import { gramsToDelta, gramsPerUnit } from '../features/inventory/amounts.js';
// Pure helpers, no Dexie or React of their own. Imported rather than
// reimplemented so "what counts as eating" has exactly one definition — the
// intake screen and the intake reset must agree or the reset won't zero it.
import { consumedGrams, windowStart } from '../features/macros/macros.js';

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
    expiry_date = null,
    // What one of them weighs, if anyone happens to know. Purely optional:
    // it buys macros for a counted item ("8 eggs" -> 400 g) and nothing else
    // depends on it. Absent is a normal, permanent state.
    grams_each = null,
    // What one whole package weighs — a 454 g jar, a 5 lb bag. Settable on
    // any product, which is what lets per-100 g macros scale to the thing
    // actually in the cupboard rather than to a serving size someone else
    // chose. Also what makes "26% of the jar" sayable.
    pack_grams = null,
    // Optional backdating. Real use always leaves this alone; the sample-fridge
    // fixture sets it so a seeded kitchen has a believable history rather than
    // twenty items all bought in the same second.
    at = null
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
    grams_each: grams_each ? Number(grams_each) : null,
    pack_grams: pack_grams ? Number(pack_grams) : null,
    created_at: at || now(),
    updated_at: at || now(),
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
        timestamp: at || now(),
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
export async function logAmount(
  householdId, itemId, { value, unit, grams, units, direction = 'remove', type, at = null }
) {
  const item = await db.items.get(itemId);
  if (!item) throw new Error('Item not found.');

  /* `units` is "this many of whatever it is counted in" — one egg, one
   * potato, one jar — and it is the one the buttons use.
   *
   * It exists because the obvious spelling was wrong. The sheet used to send
   * { value: 1, unit: 'count' }, which toBase refuses for a grams-based item:
   * converting counts to grams needs to know what one of them weighs, which
   * units.js has no business knowing. So the primary button threw on every
   * item bought by weight — rice, a bag of potatoes — and the sheet swallowed
   * the error, so it simply looked like nothing happened.
   *
   * The item DOES know what one weighs, so the conversion belongs here. */
  if (units != null) {
    const n = Number(units);
    if (!Number.isFinite(n) || n <= 0) throw new Error('Enter an amount greater than zero.');

    if (item.base_unit === 'count') {
      grams = null;
      value = n;
      unit = 'count';
    } else {
      const per = gramsPerUnit(item);
      if (!per) {
        throw new Error(
          `Nobody has recorded what one ${item.display_unit || 'unit'} of this weighs, ` +
          'so it can only be used by the gram.'
        );
      }
      grams = n * per;
    }
  }

  // Grams are accepted for any item whose weight is known, whatever it is
  // counted in — that is what lets a jar counted as "1 jar" give up a 32 g
  // spoonful and come back reading "93% of the jar".
  if (grams != null) {
    const delta = gramsToDelta(item, grams);
    if (delta == null) {
      throw new Error('This item has no recorded weight, so it cannot be used by the gram.');
    }
    return logBaseDelta(
      householdId, itemId, direction === 'add' ? delta : -delta,
      type || (direction === 'add' ? EVENT_TYPES.ADD : EVENT_TYPES.REMOVE),
      { entered_value: Number(grams), entered_unit: 'g' }
    );
  }

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
    timestamp: at || now(),
    device_id: getDeviceId()
  };

  await db.transaction('rw', db.events, db.pending_sync, async (tx) => {
    await tx.table('events').put(event);
    await enqueue(tx, 'events', 'insert', event);
  });

  return event;
}

/**
 * Raw base-unit delta. Used internally by markEmpty and undo.
 *
 * `extra` is folded into the event before it is written, so anything it adds
 * (in practice `undone_type`) is part of the row the sync queue captures.
 * It used to be patched on afterwards, which left the queued payload without
 * it — the field existed on this device and nowhere else.
 */
async function logBaseDelta(householdId, itemId, baseDelta, type, extra = {}) {
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
    device_id: getDeviceId(),
    ...extra
  };

  await db.transaction('rw', db.events, db.pending_sync, async (tx) => {
    await tx.table('events').put(event);
    await enqueue(tx, 'events', 'insert', event);
  });

  return event;
}

/** Fills in an estimated expiry date after the fact, if the item has none. */
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
  // Everything ever put in, so the UI can say "322 g of the 500 g you bought"
  // rather than just "322 g" — the same log, read a second way.
  const added = new Map();
  for (const e of events) {
    const delta = Number(e.quantity_delta || 0);
    totals.set(e.item_id, (totals.get(e.item_id) || 0) + delta);
    if (delta > 0) added.set(e.item_id, (added.get(e.item_id) || 0) + delta);
  }

  return items
    .filter((i) => !i.deleted)
    .map((i) => ({
      ...i,
      quantity: Math.max(0, totals.get(i.id) || 0),
      added: added.get(i.id) || 0,
      macros: i.food_db_id ? macrosById.get(i.food_db_id) || null : null
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
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

  // `undone_type` records which kind of event this reversed: an undone
  // removal must cancel the consumption it recorded, an undone addition must
  // not count as eating. It goes in at creation so the synced row carries it.
  return logBaseDelta(
    householdId, itemId, -Number(last.quantity_delta), EVENT_TYPES.UNDO,
    { undone_type: last.type }
  );
}


/* -------------------------------------------------------------------- resets
 * Two blunt instruments for getting back to a known state: the fridge is
 * empty, or today didn't happen. Both go through the normal soft-delete and
 * append paths rather than wiping rows, so they sync like any other change
 * and the history stays readable.
 */

/**
 * Empties the fridge — soft-deletes every item in the household at once.
 *
 * Past intake is unaffected: the events stay, and the intake screen reads
 * items by id whether or not they are deleted, so what you ate last Tuesday
 * still counts. This clears what you *have*, not what you *did*.
 */
export async function clearAllItems(householdId) {
  const items = await db.items.where('household_id').equals(householdId).toArray();
  const live = items.filter((i) => !i.deleted);
  if (live.length === 0) return 0;

  const stamp = now();
  await db.transaction('rw', db.items, db.pending_sync, async (tx) => {
    for (const item of live) {
      const updated = { ...item, deleted: 1, updated_at: stamp };
      await tx.table('items').put(updated);
      await enqueue(tx, 'items', 'update', updated);
    }
  });

  return live.length;
}

/**
 * Puts intake for the window back to zero.
 *
 * Nothing is deleted. For each item it works out what the log says was eaten
 * in the window — netting out anything already undone, using the same rule
 * the intake screen uses — and appends a single undo event for that amount.
 *
 * Two consequences worth being clear about, both of which follow from
 * quantity and intake being derived from one log rather than stored apart:
 *  - The food goes back in the fridge. There is no way to say "I didn't eat
 *    this" without also saying "so it's still there".
 *  - Pressing it twice is harmless. The second press nets zero and appends
 *    nothing, so a double tap can't inflate the fridge.
 */
export async function resetIntake(householdId, { days = 1, now: at = new Date() } = {}) {
  const from = windowStart(days, at).getTime();
  const events = await db.events.where('household_id').equals(householdId).toArray();

  const netByItem = new Map();
  for (const e of events) {
    const ts = Date.parse(e.timestamp);
    if (!Number.isFinite(ts) || ts < from) continue;
    const grams = consumedGrams(e);
    if (grams === 0) continue;
    netByItem.set(e.item_id, (netByItem.get(e.item_id) || 0) + grams);
  }

  const outstanding = [...netByItem.entries()].filter(([, net]) => net > 0);

  for (const [itemId, net] of outstanding) {
    await logBaseDelta(householdId, itemId, net, EVENT_TYPES.UNDO, {
      undone_type: EVENT_TYPES.REMOVE
    });
  }

  return outstanding.length;
}

/**
 * Distinct things this household has bought before, newest first — what
 * "Add from recent" offers. Reads deleted items too: finishing the milk is
 * exactly when it becomes worth re-adding.
 */
export async function recentNames(householdId, limit = 24) {
  const items = await db.items.where('household_id').equals(householdId).toArray();
  const seen = new Map();
  for (const i of [...items].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    const key = i.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, { name: i.name, unit: i.display_unit || 'item', location: i.location });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
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
 * A cache of public reference data (USDA / Open Food Facts), keyed by
 * `food_db_id` rather than by household — the same barcode means the same
 * food for everyone, so this is shared reference data, not private state.
 *
 * It DOES sync (see db/sync.js), and that matters: an item's `food_db_id`
 * syncs fine on its own, but without the food record behind it, a second
 * device has an id pointing at nothing until it happens to look the same
 * food up itself — which is exactly why the same item used to show full
 * nutrition on one device and "No nutrition attached" on another. Syncing
 * this table is what makes the two devices agree.
 */

export async function cacheFood(food) {
  const record = {
    food_db_id: food.food_db_id,
    name: food.name,
    // Identity, kept whole. A cached food has to be usable for everything a
    // freshly fetched one is — the confirmation card shows the brand, the
    // package weight is what makes "1 pack" mean grams, and the photo is the
    // difference between recognising the product and reading about it.
    brand: food.brand || '',
    brand_owner: food.brand_owner || '',
    upc: food.upc || '',
    image: food.image || null,
    package_text: food.package_text || '',
    package_grams: food.package_grams ?? null,
    serving_text: food.serving_text || '',
    serving_grams: food.serving_grams ?? null,
    // Named portions ("large — 50g"), when the database published them.
    servings: food.servings || [],
    dataset: food.dataset || '',
    macros_per_unit: food.macros_per_unit,
    source: food.source,
    detail: food.detail || '',
    cached_at: now()
  };

  await db.transaction('rw', db.food_cache, db.pending_sync, async (tx) => {
    await tx.table('food_cache').put(record);
    await enqueue(tx, 'food_cache', 'upsert', record);
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
  // Brand is searched too: someone typing "kirkland" is looking for the
  // brand, and matching only the product name would miss every one of them.
  const hay = (f) => `${f.name || ''} ${f.brand || ''} ${f.brand_owner || ''}`.toLowerCase();
  return all.filter((f) => hay(f).includes(q)).slice(0, limit);
}
