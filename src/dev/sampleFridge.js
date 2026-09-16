/**
 * A known kitchen, for working on the app against something realistic.
 *
 * Edit ITEMS below and it changes everywhere: the "Load sample kitchen" button
 * in Settings (dev builds only), the screenshot harness, and the generated
 * supabase/sample-fridge.sql. One table, no second copy to drift.
 *
 * Loading it goes through the same addItem/logAmount the app itself uses, so
 * what you get is real data — it derives, it syncs, it undoes. Nothing here is
 * a special case the rest of the app has to know about.
 *
 * The macro figures are approximate per-100g values for fixture purposes. They
 * are in the right ballpark for realistic totals; they are not a nutrition
 * reference, and nothing in the app treats them as more authoritative than a
 * real USDA lookup (they carry their own `sample:` id so they never collide
 * with one).
 */

const day = 86400000;

/**
 * bought / used are in the item's unit. used is what's been eaten since, so
 * current quantity is bought - used, and the depletion bar has something to
 * show. usedToday splits eating into "counts toward today's intake" and
 * "happened earlier in the week", so the Intake screen has a believable day
 * rather than every item consumed in the same instant.
 */
export const ITEMS = [
  // ---- dairy ----
  { name: 'Whole milk', category: 'dairy', location: 'fridge', unit: 'gallon', bought: 1, used: 0.5, usedToday: 0.25, gramsEach: 3780, expiresIn: 5,
    macros: { calories: 61, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3 } },
  { name: 'Greek yogurt, plain', category: 'dairy', location: 'fridge', unit: 'container', bought: 4, used: 1, usedToday: 1, gramsEach: 170, expiresIn: 9,
    macros: { calories: 59, protein_g: 10.2, carbs_g: 3.6, fat_g: 0.4 } },
  { name: 'Cheddar cheese', category: 'dairy', location: 'fridge', unit: 'slice', bought: 20, used: 6, usedToday: 2, gramsEach: 21, expiresIn: 21,
    macros: { calories: 403, protein_g: 25, carbs_g: 1.3, fat_g: 33 } },
  { name: 'Salted butter', category: 'dairy', location: 'fridge', unit: 'stick', bought: 4, used: 2.5, usedToday: 0.25, gramsEach: 113, expiresIn: 40,
    macros: { calories: 717, protein_g: 0.9, carbs_g: 0.1, fat_g: 81 } },

  // ---- meat & protein ----
  { name: 'Chicken breast', category: 'meat', location: 'fridge', unit: 'breast', bought: 4, used: 1, usedToday: 1, gramsEach: 175, expiresIn: 1,
    macros: { calories: 120, protein_g: 22.5, carbs_g: 0, fat_g: 2.6 } },
  { name: 'Ground beef, 85% lean', category: 'meat', location: 'freezer', unit: 'pack', bought: 2, used: 1, usedToday: 0, gramsEach: 450, expiresIn: 120,
    macros: { calories: 215, protein_g: 18.6, carbs_g: 0, fat_g: 15 } },
  { name: 'Salmon fillet', category: 'seafood', location: 'freezer', unit: 'fillet', bought: 4, used: 1, usedToday: 0, gramsEach: 110, expiresIn: 90,
    macros: { calories: 208, protein_g: 20, carbs_g: 0, fat_g: 13 } },
  { name: 'Eggs', category: 'eggs', location: 'fridge', unit: 'egg', bought: 12, used: 4, usedToday: 2, gramsEach: 50, expiresIn: 16,
    macros: { calories: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5 } },
  // Finished — exercises the empty-item state and "Undo last".
  { name: 'Streaky bacon', category: 'meat', location: 'fridge', unit: 'slice', bought: 12, used: 12, usedToday: 3, gramsEach: 20, expiresIn: 4,
    macros: { calories: 541, protein_g: 37, carbs_g: 1.4, fat_g: 42 } },

  // ---- grains & carbs ----
  { name: 'Basmati rice', category: 'grain', location: 'pantry', unit: 'g', bought: 5000, used: 3200, usedToday: 180, expiresIn: 400,
    macros: { calories: 360, protein_g: 7.5, carbs_g: 79, fat_g: 0.9 } },
  { name: 'Rolled oats', category: 'grain', location: 'pantry', unit: 'g', bought: 1000, used: 380, usedToday: 80, expiresIn: 200,
    macros: { calories: 379, protein_g: 13.2, carbs_g: 67.7, fat_g: 6.5 } },
  { name: 'Wholemeal bread', category: 'grain', location: 'pantry', unit: 'slice', bought: 22, used: 11, usedToday: 2, gramsEach: 36, expiresIn: 3,
    macros: { calories: 247, protein_g: 13, carbs_g: 41, fat_g: 3.4 } },
  { name: 'Spaghetti', category: 'grain', location: 'pantry', unit: 'g', bought: 500, used: 250, usedToday: 0, expiresIn: 500,
    macros: { calories: 371, protein_g: 13, carbs_g: 74.7, fat_g: 1.5 } },
  { name: 'Corn tortillas', category: 'grain', location: 'fridge', unit: 'item', bought: 10, used: 4, usedToday: 2, gramsEach: 26, expiresIn: 12,
    macros: { calories: 218, protein_g: 5.7, carbs_g: 44.6, fat_g: 2.9 } },

  // ---- produce ----
  { name: 'Bananas', category: 'produce', location: 'pantry', unit: 'item', bought: 7, used: 4, usedToday: 1, gramsEach: 118, expiresIn: 2,
    macros: { calories: 89, protein_g: 1.1, carbs_g: 22.8, fat_g: 0.3 } },
  { name: 'Baby spinach', category: 'produce', location: 'fridge', unit: 'bag', bought: 1, used: 0.75, usedToday: 0.25, gramsEach: 200, expiresIn: 1,
    macros: { calories: 23, protein_g: 2.9, carbs_g: 3.6, fat_g: 0.4 } },
  { name: 'Roma tomatoes', category: 'produce', location: 'fridge', unit: 'item', bought: 8, used: 2, usedToday: 0, gramsEach: 62, expiresIn: 6,
    macros: { calories: 18, protein_g: 0.9, carbs_g: 3.9, fat_g: 0.2 } },
  // Already gone off — the one item that should be shouting on the shelf.
  { name: 'Brussels sprouts', category: 'produce', location: 'fridge', unit: 'g', bought: 500, used: 178, usedToday: 0, expiresIn: -2,
    macros: { calories: 43, protein_g: 3.4, carbs_g: 9, fat_g: 0.3 } },
  { name: 'Carrots', category: 'produce', location: 'fridge', unit: 'g', bought: 1000, used: 300, usedToday: 0, expiresIn: 18,
    macros: { calories: 41, protein_g: 0.9, carbs_g: 9.6, fat_g: 0.2 } },
  { name: 'Peas, frozen', category: 'frozen', location: 'freezer', unit: 'bag', bought: 2, used: 0.5, usedToday: 0.25, gramsEach: 500, expiresIn: 150,
    macros: { calories: 77, protein_g: 5.2, carbs_g: 13.6, fat_g: 0.4 } }
];

/** Stable per-item id, so the SQL seed replaces rather than duplicates. */
const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const foodIdOf = (item) => `sample:${slugOf(item.name)}`;

export const isoDaysFromNow = (days, from = Date.now()) =>
  new Date(from + days * day).toISOString();

/**
 * The same kitchen in the shape `listItems` returns, for anything that needs
 * the data without a database behind it (the screenshot harness). Derived
 * from the same table, so a screenshot can't show a fridge the app wouldn't.
 */
export function asItems(householdId = 'sample') {
  return ITEMS.map((spec, i) => ({
    id: `sample-${i}`,
    household_id: householdId,
    name: spec.name,
    category: spec.category,
    location: spec.location,
    base_unit: ['g', 'kg', 'oz', 'lb'].includes(spec.unit) ? 'g' : 'count',
    display_unit: spec.unit,
    grams_each: spec.gramsEach || null,
    quantity: spec.bought - spec.used,
    added: spec.bought,
    food_db_id: foodIdOf(spec),
    expiry_date: isoDaysFromNow(spec.expiresIn).slice(0, 10),
    created_at: isoDaysFromNow(-(14 - (i % 14))),
    deleted: 0,
    macros: { basis: 'per_100g', ...spec.macros }
  }));
}

/**
 * Replaces the household's items with the sample kitchen.
 *
 * Clears first, deliberately: the point is a *known* state you can return to,
 * not twenty more items on top of whatever was there. Everything it writes
 * goes through the normal paths, so it syncs to the server and to every other
 * device like any other shopping trip.
 */
export async function loadSampleFridge(householdId, queries) {
  await queries.clearAllItems(householdId);

  for (const [i, spec] of ITEMS.entries()) {
    // Bought over the past fortnight rather than all at once, so "recently
    // added" has a real order and the depletion history looks plausible.
    const boughtAt = Date.now() - (14 - (i % 14)) * day;

    await queries.cacheFood({
      food_db_id: foodIdOf(spec),
      name: spec.name,
      macros_per_unit: { basis: 'per_100g', ...spec.macros },
      source: 'sample',
      detail: 'Sample data'
    });

    const item = await queries.addItem(householdId, {
      name: spec.name,
      category: spec.category,
      location: spec.location,
      unit: spec.unit,
      quantity: spec.bought,
      food_db_id: foodIdOf(spec),
      grams_each: spec.gramsEach || null,
      expiry_date: isoDaysFromNow(spec.expiresIn).slice(0, 10),
      at: new Date(boughtAt).toISOString()
    });

    const earlier = spec.used - (spec.usedToday || 0);
    if (earlier > 0) {
      await queries.logAmount(householdId, item.id, {
        value: earlier,
        unit: spec.unit,
        direction: 'remove',
        at: new Date(boughtAt + day).toISOString()
      });
    }
    if (spec.usedToday > 0) {
      await queries.logAmount(householdId, item.id, {
        value: spec.usedToday,
        unit: spec.unit,
        direction: 'remove'
      });
    }
  }

  return ITEMS.length;
}
