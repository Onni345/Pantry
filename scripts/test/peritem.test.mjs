/**
 * perItem — macros in the unit the item is actually counted in.
 *
 * The bug these guard against is the quiet one: an item with no weight per
 * unit contributes nothing to intake, and before this the app said nothing
 * about why.
 */
import { perUnit, inStock, macroGap, formatCalories }
  from '../../src/features/macros/perItem.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const EGG_100G = { calories: 143, protein_g: 12.6, carbs_g: 0.7, fat_g: 9.5 };
const eggs = {
  base_unit: 'count', display_unit: 'egg', grams_each: 50, quantity: 12,
  location: 'fridge', food_db_id: 'usda:1', macros: EGG_100G
};
const rice = {
  base_unit: 'g', display_unit: 'kg', quantity: 1200,
  food_db_id: 'usda:2', macros: { calories: 365, protein_g: 7.1, carbs_g: 80, fat_g: 0.7 }
};

t('a counted item reports per one of them, not per 100 g', () => {
  const p = perUnit(eggs);
  eq(p.basis, 'per egg', 'basis');
  eq(p.calories, 72, '143 kcal/100g x 50g');
  eq(p.protein_g, 6.3, 'protein');
});

t('a weighed item keeps the per-100 g basis it is published in', () => {
  const p = perUnit(rice);
  eq(p.basis, 'per 100 g', 'basis');
  eq(p.calories, 365, 'unscaled');
});

t('the whole stock is totalled, and the noun is pluralised', () => {
  const all = inStock(eggs);
  eq(all.calories, 858, '12 x 50g = 600g');
  eq(all.noun, 'eggs', 'plural');
  eq(inStock({ ...eggs, quantity: 1 }).noun, 'egg', 'singular');
});

t('NO WEIGHT PER UNIT MEANS NO ANSWER, not a guess', () => {
  // This is the bug: before, the item silently contributed zero and the
  // screen said nothing. It must now be detectable.
  eq(perUnit({ ...eggs, grams_each: null }), null, 'no per-unit figure');
  eq(macroGap({ ...eggs, grams_each: null }), 'no-weight', 'and the reason is nameable');
  eq(inStock({ ...eggs, grams_each: null }), null, 'no stock figure either');
});

t('no food attached is a different gap from no weight', () => {
  const bare = { base_unit: 'count', display_unit: 'container', quantity: 1 };
  eq(perUnit(bare), null, 'no figure');
  eq(macroGap(bare), 'no-food', 'reason');
  eq(macroGap({ ...bare, food_db_id: 'x' }), 'no-food', 'an id with no cached macros is still no-food');
});

t('a healthy item reports no gap', () => {
  eq(macroGap(eggs), 'ok', 'eggs');
  eq(macroGap(rice), 'ok', 'rice — weighed, so grams_each is irrelevant');
});

t('an empty item has no stock figure but still has a per-unit one', () => {
  eq(inStock({ ...eggs, quantity: 0 }), null, 'nothing in stock');
  eq(perUnit({ ...eggs, quantity: 0 }).calories, 72, 'an egg is still an egg');
});

t('missing macro keys come back null rather than NaN', () => {
  const p = perUnit({ ...eggs, macros: { calories: 143 } });
  eq(p.calories, 72, 'present');
  eq(p.protein_g, null, 'absent');
});

t('calories are thousands-separated', () => {
  eq(formatCalories(1716), '1,716', 'formatted');
  eq(formatCalories(null), '—', 'nothing');
});

t('an item counted in plain "count" says item, not count', () => {
  eq(perUnit({ ...eggs, display_unit: 'count' }).basis, 'per item', 'basis');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
