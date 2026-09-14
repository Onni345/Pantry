/**
 * amounts.js — stocked one way, eaten another.
 *
 * The bug these guard: an item used to be fixed into "counted" or "weighed"
 * at creation, so the unit you bought in was the unit you were stuck
 * consuming in. A jar of peanut butter was one indivisible jar and a 5 lb bag
 * of potatoes contained no potatoes.
 */
import {
  describe, portionsFor, gramsPerUnit, gramsToDelta, deltaToGrams,
  stockGrams, supportsGrams, nounOf
} from '../../src/features/inventory/amounts.js';
import { pluralize } from '../../src/units.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const near = (a, b, m) => { if (Math.abs(a - b) > 0.01) throw new Error(`${m}: ${a} !== ${b}`); };

const eggs = { base_unit: 'count', display_unit: 'egg', grams_each: 50, quantity: 12 };
const potatoes = { base_unit: 'g', display_unit: 'potato', grams_each: 173, pack_grams: 2268, quantity: 2268 };
const jar = { base_unit: 'count', display_unit: 'jar', pack_grams: 454, quantity: 1 };
const rice = { base_unit: 'g', display_unit: 'kg', quantity: 1200 };
const curry = { base_unit: 'count', display_unit: 'container', quantity: 2 };
const PB = { name: 'Peanut Butter', serving_text: '2 tbsp', serving_grams: 32 };

t('a 5 lb bag of potatoes contains potatoes', () => {
  eq(describe(potatoes).main, '13 potatoes', 'reads as potatoes');
  eq(describe(potatoes).aside, '2.27 kg', 'with the weight behind it');
});

t('THE OLD MODEL COULD NOT DO THIS: a weighed item had no countable unit', () => {
  // Without grams_each the same stock is only a weight — which is exactly
  // what every weighed item used to be.
  eq(describe({ ...potatoes, grams_each: null }).main, '2.27 kg', 'no potatoes in it');
});

t('a jar counted as one jar still gives up a spoonful', () => {
  const delta = gramsToDelta(jar, 32);
  near(delta, 32 / 454, 'a spoonful is a fraction of a jar');
  eq(supportsGrams(jar), true, 'grams work on a counted item with a pack weight');
});

t('taking grams off a jar leaves a readable remainder', () => {
  const left = { ...jar, base_unit: 'g', quantity: 454 - 32 * 4 };
  eq(describe(left).main, '326 g', 'weight');
  eq(describe(left).aside, '72% of the jar', 'and how much of the jar that is');
});

t('something nobody has weighed cannot be taken in grams', () => {
  eq(gramsToDelta(curry, 30), null, 'no conversion');
  eq(supportsGrams(curry), false, 'and the UI is told not to offer it');
  eq(stockGrams(curry), null, 'no stock weight either');
});

t('eggs still read as eggs', () => {
  eq(describe(eggs).main, '12 eggs', 'main');
  eq(describe(eggs).aside, '600 g', 'aside');
  eq(stockGrams(eggs), 600, 'stock weight');
});

t('portions offer the whole unit, the package, and finer food servings', () => {
  const labels = portionsFor({ ...jar, base_unit: 'g', quantity: 454 }, PB).map((p) => p.label);
  eq(labels.includes('jar'), true, 'the unit');
  eq(labels.includes('2 tbsp'), true, 'the database serving');
  // A serving bigger than one unit is noise, not an option.
  eq(portionsFor(eggs, { name: 'Egg, Raw' }).every((p) => !p.grams || p.grams <= 50), true,
    'nothing larger than one egg');
});

t('an item bought by weight has no noun and no unit chip', () => {
  eq(nounOf(rice), null, 'kg is a unit, not a noun');
  eq(portionsFor(rice, null).length, 0, 'so there is nothing to offer but grams');
  eq(describe(rice).main, '1.2 kg', 'and it simply reads as a weight');
});

t('grams round-trip through a counted item', () => {
  near(deltaToGrams(eggs, gramsToDelta(eggs, 150)), 150, 'there and back');
  near(deltaToGrams(potatoes, gramsToDelta(potatoes, 500)), 500, 'weighed too');
});

t('below three-quarters of a unit it stops counting units', () => {
  eq(describe({ ...potatoes, quantity: 100 }).main, '100 g', 'half a potato is a weight');
  eq(describe({ ...potatoes, quantity: 160 }).main, '1 potato', 'nearly one is one');
});

t('gramsPerUnit prefers the per-unit weight over the package', () => {
  eq(gramsPerUnit(potatoes), 173, 'a potato, not the bag');
  eq(gramsPerUnit(jar), 454, 'the jar, when that is all there is');
  eq(gramsPerUnit(curry), null, 'nothing known');
});

t('plurals are not embarrassing', () => {
  eq(pluralize('potato', 3), 'potatoes', 'potato');
  eq(pluralize('avocado', 3), 'avocados', 'avocado');
  eq(pluralize('bunch', 2), 'bunches', 'bunch');
  eq(pluralize('berry', 2), 'berries', 'berry');
  eq(pluralize('loaf', 2), 'loaves', 'loaf');
  eq(pluralize('slice', 1), 'slice', 'one stays singular');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
