/**
 * Turns the event log into intake figures.
 *
 * Pure — no Dexie, no React. Give it items, events and cached foods; it gives
 * back totals for a window.
 *
 * What counts as eating:
 *   remove              -> yes, that is food leaving the inventory
 *   consumed_remainder  -> yes, "I finished it" is still eating it
 *   add                 -> no, that is shopping
 *   undo                -> only if it reversed one of the first two, in which
 *                          case it cancels that consumption out again
 *
 * Only weighed items can contribute. Macros are published per 100 g, and the
 * app has no way to know what three eggs weigh, so counted items are reported
 * separately rather than guessed at.
 */

export const CONSUMPTION_TYPES = new Set(['remove', 'consumed_remainder']);

export const RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: 'Last 7 days', days: 7 },
  { key: 'month', label: 'Last 30 days', days: 30 }
];

/** Start of the local day, `days - 1` days back. Windows are whole days. */
export function windowStart(days, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

const EMPTY = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

/**
 * Grams of an item consumed by one event, as a positive number.
 * Returns 0 for anything that is not consumption.
 */
export function consumedGrams(event) {
  const delta = Number(event.quantity_delta) || 0;

  if (CONSUMPTION_TYPES.has(event.type)) return delta < 0 ? -delta : 0;

  if (event.type === 'undo' && CONSUMPTION_TYPES.has(event.undone_type)) {
    // Reverses an earlier removal: negative consumption, cancelling it out.
    return -delta;
  }

  return 0;
}

export function summarize({ items, events, foods }, { days = 1, now = new Date() } = {}) {
  const from = windowStart(days, now).getTime();

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const macrosById = new Map(foods.map((f) => [f.food_db_id, f.macros_per_unit]));

  const totals = { ...EMPTY };
  let gramsCounted = 0;      // weighed, matched to a food
  let gramsUnmatched = 0;    // weighed, but no food record
  let countedUnits = 0;      // counted items — cannot be converted
  const perItem = new Map();

  for (const e of events) {
    const at = Date.parse(e.timestamp);
    if (!Number.isFinite(at) || at < from) continue;

    const grams = consumedGrams(e);
    if (grams === 0) continue;

    const item = itemsById.get(e.item_id);
    if (!item) continue;

    if (item.base_unit !== 'g') {
      countedUnits += grams;
      continue;
    }

    const macros = item.food_db_id ? macrosById.get(item.food_db_id) : null;
    if (!macros) {
      gramsUnmatched += grams;
      continue;
    }

    gramsCounted += grams;
    const factor = grams / 100;

    const row = perItem.get(item.id) || { id: item.id, name: item.name, grams: 0, ...EMPTY };
    row.grams += grams;

    for (const key of ['calories', 'protein_g', 'carbs_g', 'fat_g']) {
      const v = Number(macros[key]);
      if (Number.isFinite(v)) {
        totals[key] += v * factor;
        row[key] += v * factor;
      }
    }
    perItem.set(item.id, row);
  }

  const gramsTotal = gramsCounted + gramsUnmatched;

  return {
    totals: {
      calories: round(totals.calories, 0),
      protein_g: round(totals.protein_g, 1),
      carbs_g: round(totals.carbs_g, 1),
      fat_g: round(totals.fat_g, 1)
    },
    perDay: days > 1 ? {
      calories: round(totals.calories / days, 0),
      protein_g: round(totals.protein_g / days, 1),
      carbs_g: round(totals.carbs_g / days, 1),
      fat_g: round(totals.fat_g / days, 1)
    } : null,
    // Coverage is reported, never hidden. A total built from a third of what
    // you ate is not a total, and the UI should be able to say so.
    coverage: {
      gramsCounted: round(gramsCounted, 1),
      gramsUnmatched: round(gramsUnmatched, 1),
      countedUnits: round(countedUnits, 2),
      fraction: gramsTotal > 0 ? gramsCounted / gramsTotal : null
    },
    topItems: [...perItem.values()]
      .sort((a, b) => b.calories - a.calories || b.grams - a.grams)
      .slice(0, 8)
      .map((r) => ({
        ...r,
        grams: round(r.grams, 1),
        calories: round(r.calories, 0),
        protein_g: round(r.protein_g, 1),
        carbs_g: round(r.carbs_g, 1),
        fat_g: round(r.fat_g, 1)
      })),
    days
  };
}

function round(n, places = 1) {
  const f = 10 ** places;
  return Math.round(Number(n) * f) / f;
}
