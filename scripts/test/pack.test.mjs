import '../node-compat.mjs';
import 'fake-indexeddb/auto';
import { createServer } from 'vite';
process.env.VITE_SUPABASE_URL ||= 'https://t.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ||= 'k';
const server = await createServer({ root: new URL('../..', import.meta.url).pathname, logLevel: 'error', server: { middlewareMode: true } });
const load = (p) => server.ssrLoadModule(p);
const q = await load('/src/db/queries.js');
const { describe } = await load('/src/features/inventory/amounts.js');
const H = '00000000-0000-0000-0000-000000000000';

const PB = { food_db_id: 'usda:pb', name: 'Peanut Butter',
  macros_per_unit: { basis: 'per_100g', calories: 588, protein_g: 25, carbs_g: 20, fat_g: 50 } };
await q.cacheFood(PB);

// A jar, counted as one jar, with its real weight recorded.
const jar = await q.addItem(H, {
  name: 'Peanut butter', quantity: 1, unit: 'jar', location: 'pantry',
  food_db_id: PB.food_db_id, pack_grams: 454
});
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const near = (a, b, m) => { if (Math.abs(a - b) > 1) throw new Error(`${m}: ${a} !== ${b}`); };

t('a pack weight is stored against any product', () => eq(jar.pack_grams, 454, 'stored'));

// Two spoonfuls off a jar counted in jars.
await q.logAmount(H, jar.id, { grams: 32, direction: 'remove' });
await q.logAmount(H, jar.id, { grams: 32, direction: 'remove' });
let items = await q.listItems(H);
const left = describe(items.find((i) => i.name === 'Peanut butter'));
t('A JAR COUNTED AS ONE JAR STILL GIVES UP A SPOONFUL', () => {
  // The old model could not do this at all: a counted item could only lose
  // whole counts, so a jar was one indivisible object.
  eq(left.main, '390 g', 'what is left');
  eq(left.aside, '86% of the jar', 'and how much of the jar that is');
});

// A 5 lb bag of potatoes, taken one potato at a time.
const bag = await q.addItem(H, {
  name: 'Potatoes', quantity: 2268, unit: 'g', location: 'pantry',
  grams_each: 173, pack_grams: 2268
});
await q.logAmount(H, bag.id, { grams: 173, direction: 'remove' });
items = await q.listItems(H);
const spuds = describe({ ...items.find((i) => i.name === 'Potatoes'), display_unit: 'potato' });
t('a 5 lb bag counts down in potatoes', () => {
  eq(spuds.main, '12 potatoes', 'thirteen less one');
  eq(spuds.aside, '2.1 kg', 'with the weight behind it');
});

// Grams on something with no weight at all must be refused, not guessed.
const curry = await q.addItem(H, { name: 'Leftover curry', quantity: 2, unit: 'container', location: 'fridge' });
let refused = false;
try { await q.logAmount(H, curry.id, { grams: 50, direction: 'remove' }); }
catch { refused = true; }
t('grams are refused on something nobody has weighed', () => eq(refused, true, 'refused'));

const { summarize } = await load('/src/features/macros/macros.js');
const out = summarize(await q.getMacroInputs(H), { days: 1 });
t('A PACK WEIGHT ALONE IS ENOUGH FOR MACROS', () => {
  // macros.js used to read item.grams_each directly, so a jar with only a
  // package weight scored exactly zero calories however much you ate.
  near(out.totals.calories, 376, '588 kcal/100g x 64 g');
  near(out.totals.protein_g, 16, 'protein');
});

await server.close().catch(() => {});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
