/**
 * productAmount / isProductFood — the fix for two reported bugs at once:
 *
 *  1. Barcode scanning sometimes treated the ENTIRE PACKAGE weight as the
 *     serving size. Root cause: `servingsFor` deliberately lists the whole
 *     packet as one of its portion options (so a manual picker can offer
 *     it), sorts by grams descending, and `defaultServing` falls back to
 *     the largest option — the package — whenever nothing else matches the
 *     unit in play. A barcode-scanned row defaulted to unit 'pack', which
 *     is exactly the case that fallback hits.
 *
 *  2. "Recognised product -> servings x macros-per-serving" always, using
 *     the label's own serving size, never a guess and never the package
 *     weight standing in for it.
 */
import { isProductFood, productAmount } from '../../src/features/inventory/amounts.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

// A branded bag of bagels: 5 per pack, each bagel (one serving) is 85 g,
// the whole bag is 425 g. This is the exact shape of bug #2 — a barcode
// scan used to default to unit 'pack' and hand the WHOLE 425 g to
// foodUnitGrams, which (package noun, no better match) returned the
// package weight as if it were one unit's worth of nutrition.
const bagels = {
  food_db_id: 'usda:123',
  name: '1st National Bagel Co. Presliced Bagels, Blueberry',
  brand: '1st National Bagel Company',
  dataset: 'Branded',
  source: 'usda',
  upc: '000000000001',
  package_text: '5 bagels',
  package_grams: 425,
  serving_text: '1 bagel',
  serving_grams: 85,
  macros_per_unit: { basis: 'per_100g', calories: 270, protein_g: 11, carbs_g: 55, fat_g: 1 }
};

t('a barcode-scanned product is recognised as a product', () => {
  eq(isProductFood(bagels), true, 'branded + upc');
});

t('a product with a real serving size is tracked in servings, not the package', () => {
  const amount = productAmount(bagels);
  eq(amount.mode, 'servings', 'mode');
  eq(amount.unit, 'serving', 'unit');
  eq(amount.grams_each, 85, 'THE BUG: this used to come out 425 (the whole bag)');
});

t('the default quantity is how many servings are actually in the package', () => {
  const amount = productAmount(bagels);
  eq(amount.defaultQuantity, 5, '425 / 85 = 5 bagels');
});

t('a product with no serving size on file falls back to plain weight, never a guess', () => {
  const noServing = { ...bagels, serving_grams: null, serving_text: '' };
  const amount = productAmount(noServing);
  eq(amount.mode, 'weight', 'mode');
  eq(amount.unit, 'g', 'unit');
  eq(amount.grams_each, null, 'no invented per-unit weight');
  eq(amount.defaultQuantity, 425, 'the package weight is offered as the quantity to enter, not as a serving');
});

t('a generic USDA ingredient (no brand, no UPC) is not a product', () => {
  const chicken = {
    food_db_id: 'usda:456',
    name: 'Chicken, breast, raw',
    dataset: 'Foundation',
    source: 'usda',
    serving_grams: null
  };
  eq(isProductFood(chicken), false, 'generic ingredient');
});

t('an Open Food Facts match is always treated as a product', () => {
  const off = { food_db_id: 'off:789', name: 'Yoghurt', source: 'off', serving_grams: 125, package_grams: 500 };
  eq(isProductFood(off), true, 'off source');
  eq(productAmount(off).grams_each, 125, 'per-serving, not per-package');
});

t('no food at all is not a product', () => {
  eq(isProductFood(null), false, 'null food');
  eq(isProductFood(undefined), false, 'undefined food');
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nall ${pass} passed`);
process.exit(fail ? 1 : 0);
