/**
 * servingsFor — the rule that decides whether a portion menu appears at all.
 *
 * The point of these tests is the *silence*: a dropdown of guesses is worse
 * than no dropdown, because it looks like the app knows something. So most
 * of what follows checks that nothing is offered when nothing is known.
 */
import { servingsFor, defaultServing, hasConfidentServings, gramsPerUnit }
  from '../../src/api/portion.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const labels = (f) => servingsFor(f).map((s) => `${s.label} — ${s.grams}g`);

t('eggs get real grading sizes, largest first', () => {
  eq(labels({ name: 'Egg, Raw' }).join(' | '),
    'jumbo — 63g | extra large — 56g | large — 50g | medium — 44g | small — 38g', 'sizes');
});

t('eggs default to large, not to the biggest option', () => {
  eq(defaultServing({ name: 'Egg, Raw' }).label, 'large', 'default');
});

t('NOTHING is offered for a food we know nothing about', () => {
  eq(servingsFor({ name: 'Item 18492' }).length, 0, 'no options');
  eq(hasConfidentServings({ name: 'Item 18492' }), false, 'no picker');
  // And the silent fallback still works — this is the difference between
  // "no menu" and "no number".
  eq(gramsPerUnit({ name: 'Item 18492' }, 'egg').grams, 50, 'guess still available');
  eq(gramsPerUnit({ name: 'Item 18492' }, 'egg').exact, false, 'and still labelled a guess');
});

t('the guess table never leaks into the menu', () => {
  // 'bunch' is in UNIT_GRAMS at 400g. It must not appear as a named portion.
  eq(servingsFor({ name: 'Bananas, raw' }).length, 0, 'no options for a plain banana');
});

t('egg whites are not eggs', () => {
  eq(servingsFor({ name: 'Egg White, Raw' }).length, 0, 'excluded');
  eq(servingsFor({ name: 'Egg Yolk, Raw' }).length, 0, 'excluded');
  eq(servingsFor({ name: 'Egg Noodles' }).length, 0, 'excluded');
});

t('peanut butter is not butter, cheesecake is not cheese', () => {
  eq(servingsFor({ name: 'Peanut Butter, Creamy' }).length, 0, 'peanut butter');
  eq(servingsFor({ name: 'Cheesecake, Plain' }).length, 0, 'cheesecake');
  eq(servingsFor({ name: 'Shredded Cheddar' }).some((s) => /slice/.test(s.label)), false,
    'shredded cheese has no slices');
});

t('a cheese named only by variety is still sliceable', () => {
  eq(servingsFor({ name: 'Sliced Sharp Cheddar' }).some((s) => s.label === 'slice'), true, 'cheddar');
  eq(servingsFor({ name: 'Provolone' }).some((s) => s.label === 'slice'), true, 'provolone');
});

t('database portions are used and outrank our wording at the same weight', () => {
  const food = {
    name: 'Sliced Sharp Cheddar',
    serving_text: '1 slice', serving_grams: 21,
    package_text: '8 oz', package_grams: 226.8
  };
  const out = servingsFor(food);
  eq(out.some((s) => s.label === '1 slice' && s.basis === 'database'), true, 'database wording kept');
  eq(out.some((s) => s.label === 'slice' && s.basis === 'standard'), false, 'ours dropped at 21g');
  eq(out.some((s) => s.label === 'thick slice'), true, 'ours kept at a different weight');
});

t('the whole packet is one of the portions', () => {
  const food = { name: 'Jasmine Rice', package_text: '5 lb', package_grams: 2267.96 };
  eq(servingsFor(food)[0].label, 'package (5 lb)', 'largest, and named');
});

t('picking a unit picks the plain portion, not a qualified one', () => {
  const food = { name: 'Sliced Sharp Cheddar', serving_text: '1 slice', serving_grams: 21 };
  eq(defaultServing(food, 'slice').label, '1 slice', 'plain slice, not thick slice');
});

t('the same weight is never listed twice', () => {
  const food = { name: 'Egg, Raw', serving_text: 'large', serving_grams: 50 };
  eq(servingsFor(food).filter((s) => s.grams === 50).length, 1, 'one 50g row');
});

t('a food with no name asks for nothing', () => {
  eq(servingsFor(null).length, 0, 'null');
  eq(servingsFor({}).length, 0, 'empty');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
