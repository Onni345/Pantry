/**
 * matching.js — the one place a model is allowed to decide something.
 *
 * These tests are about what happens when it answers badly, because that is
 * the part that has to be safe: a wrong field that looks confident gets
 * stored, and a flagged field only costs someone a glance.
 */
import { applyMatches, chunk, buildMatchPrompt } from '../../src/features/receipts/matching.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const row = (over = {}) => ({
  id: 'r1', rawName: 'GOODGATH JASMINE RICE', name: 'Jasmine Rice',
  quantity: 1, unit: 'count', review: {},
  candidates: [
    { food_db_id: 'a', name: 'Jasmine Rice', brand: 'Good & Gather', package_text: '5 lb', detail: 'Branded' },
    { food_db_id: 'b', name: 'Rice, white, long-grain, raw', detail: 'USDA Foundation' }
  ],
  ...over
});

const answer = (over = {}) => ({
  lines: [{
    line: 0, name: 'Jasmine Rice', name_confident: true,
    match: 0, match_confident: true,
    quantity: 1, unit: 'pack', quantity_confident: true, ...over
  }]
});

t('a confident answer attaches the candidate and flags nothing', () => {
  const [r] = applyMatches([row()], answer());
  eq(r.matchedFood.food_db_id, 'a', 'matched');
  eq(r.unit, 'pack', 'unit');
  eq(Object.values(r.review).some(Boolean), false, 'nothing flagged');
});

t('each confidence flag lands on its own field', () => {
  eq(applyMatches([row()], answer({ name_confident: false }))[0].review.name, true, 'name');
  eq(applyMatches([row()], answer({ match_confident: false }))[0].review.match, true, 'match');
  eq(applyMatches([row()], answer({ quantity_confident: false }))[0].review.quantity, true, 'quantity');
});

t('an out-of-range candidate index attaches nothing and flags the match', () => {
  const [r] = applyMatches([row()], answer({ match: 9 }));
  eq(r.matchedFood, null, 'no food invented');
  eq(r.review.match, true, 'flagged');
});

t('-1 means genuinely no match, and is believed when it says it is sure', () => {
  const [r] = applyMatches([row()], answer({ match: -1 }));
  eq(r.matchedFood, null, 'no food');
  eq(r.review.match, false, 'a confident "none of these" is an answer, not a doubt');
});

t('AN UNKNOWN UNIT FALLS BACK AND FLAGS — this is the addItem crash', () => {
  const [r] = applyMatches([row()], answer({ unit: 'punnet' }));
  // Before knownUnit(), this wrote 'punnet' straight through; the select had
  // nothing selected and addItem threw "Unknown unit" on save.
  eq(r.unit, 'count', 'fell back to the receipt unit');
  eq(r.review.quantity, true, 'and said so');
});

t('a plural unit is understood rather than rejected', () => {
  eq(applyMatches([row()], answer({ unit: 'slices' }))[0].unit, 'slice', 'singularised');
  eq(applyMatches([row()], answer({ unit: 'slices' }))[0].review.quantity, false, 'not flagged');
});

t('a nonsense quantity keeps the receipt’s own and flags it', () => {
  const [r] = applyMatches([row({ quantity: 3 })], answer({ quantity: -2 }));
  eq(r.quantity, 3, 'kept the printed quantity');
  eq(r.review.quantity, true, 'flagged');
});

t('a skipped line is flagged whole rather than dropped', () => {
  const [r] = applyMatches([row()], { lines: [] });
  eq(r.state, 'done', 'still resolves');
  eq(r.review.name && r.review.match && r.review.quantity, true, 'everything flagged');
});

t('JSON buried in prose is still read', () => {
  const [r] = applyMatches([row()], 'Sure! ' + JSON.stringify(answer()) + ' Hope that helps.');
  eq(r.matchedFood.food_db_id, 'a', 'matched');
});

t('a response with no JSON at all throws rather than half-applying', () => {
  let threw = false;
  try { applyMatches([row()], 'I could not do that.'); } catch { threw = true; }
  eq(threw, true, 'threw');
});

t('the prompt shows brand, size and shop so the model can tell packets apart', () => {
  const { prompt } = buildMatchPrompt([row({ retailer: 'Target', brand: 'Good & Gather' })]);
  eq(prompt.includes('Shop: Target'), true, 'shop');
  eq(prompt.includes('Store brand expanded from the receipt: Good & Gather'), true, 'brand');
  eq(prompt.includes('Jasmine Rice — Good & Gather, 5 lb'), true, 'candidate carries brand and size');
});

t('chunking keeps every row and never makes an empty call', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: i }));
  const groups = chunk(rows, 5);
  eq(groups.length, 3, 'three calls');
  eq(groups.flat().length, 12, 'nothing lost');
  eq(chunk([], 5).length, 0, 'no empty call for an empty receipt');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
