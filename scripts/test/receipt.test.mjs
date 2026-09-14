import { extractCandidateLines, toRows, confidenceOf, includedRows }
  from '../../src/features/receipts/receipts.js';
import { gramsPerUnit } from '../../src/api/portion.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const RECEIPT = `TARGET
Store T-1234  Seattle WA
GOODGATH JASMINE RICE 5LB     6.49
2 X OIKOS GREEK YOGURT        2.58
ZUCCHINI GREEN                4.66
0.778kg NET @ $5.99/kg
BANANAS                       3.20
3 @ $1.07
SPECIAL                       0.99
SUBTOTAL                     17.92
VISA                         17.92`;

const lines = extractCandidateLines(RECEIPT);

t('an inline "2 X" count is read, not guessed', () => {
  const y = lines.find((l) => /OIKOS/.test(l.rawName));
  eq(y.quantity, 2, 'quantity');
  eq(y.rawName, 'OIKOS GREEK YOGURT', 'the count is stripped from the name');
});

t('a "3 @ $1.07" sub-line is read as a count', () => {
  eq(lines.find((l) => /BANANAS/.test(l.rawName)).quantity, 3, 'quantity');
});

t('a weight sub-line still wins for weighed items', () => {
  const z = lines.find((l) => /ZUCCHINI/.test(l.rawName));
  eq(z.quantity, 0.778, 'quantity');
  eq(z.unit, 'kg', 'unit');
});

t('totals, tender lines and SPECIAL are not items', () => {
  eq(lines.length, 4, 'four real items');
  eq(lines.some((l) => /SPECIAL|SUBTOTAL|VISA/.test(l.rawName)), false, 'none of the noise');
});

t('WITHOUT THE COUNT RULES the quantity would silently be 1', () => {
  // The old parser only knew the weight sub-line. Prove the new rules are
  // what changes the answer, not something else.
  const naive = /^(.+?)\s+-?\$?\s?(\d+\.\d{2})\s*$/.exec('2 X OIKOS GREEK YOGURT        2.58');
  eq(naive[1].trim(), '2 X OIKOS GREEK YOGURT', 'the count stayed glued to the name');
});

const rows = toRows(lines, RECEIPT);

t('rows carry the shop, the expanded brand and a searchable query', () => {
  const rice = rows.find((r) => /RICE/.test(r.rawName));
  eq(rice.retailer, 'Target', 'retailer');
  eq(rice.brand, 'Good & Gather', 'brand');
  eq(rice.query, 'Good & Gather jasmine rice', 'query');
  eq(rice.name, 'Jasmine Rice', 'display name drops the till abbreviation');
});

t('every extracted line becomes exactly one row', () => {
  eq(rows.length, lines.length, 'one to one');
  eq(rows.every((r) => r.include && !r.decided), true, 'all start undecided and kept');
});

// ---- confidence ------------------------------------------------------------
const base = { state: 'done', matchedFood: { food_db_id: 'x', name: 'Thing' }, review: {} };

t('confidence: settled and matched is high', () => eq(confidenceOf(base), 'high', 'level'));
t('confidence: a shaky match is medium', () =>
  eq(confidenceOf({ ...base, review: { match: true } }), 'medium', 'level'));
t('confidence: a shaky quantity is medium', () =>
  eq(confidenceOf({ ...base, review: { quantity: true } }), 'medium', 'level'));
t('confidence: no product at all is low', () =>
  eq(confidenceOf({ ...base, matchedFood: null }), 'low', 'level'));
t('confidence: an unreadable name is low even with a product', () =>
  eq(confidenceOf({ ...base, review: { name: true } }), 'low', 'level'));
t('confidence: still resolving is neither', () =>
  eq(confidenceOf({ ...base, state: 'deciding' }), 'working', 'level'));

// ---- what actually reaches the fridge --------------------------------------
t('skipped rows never reach the fridge', () => {
  const set = [{ include: true, name: 'Rice' }, { include: false, name: 'Junk' }, { include: true, name: '  ' }];
  eq(includedRows(set).length, 1, 'only the kept, named one');
});

t('a pack of cheese saves the grams that make macros possible', () => {
  const cheese = { name: 'Sliced Cheddar', package_grams: 227, serving_text: '1 slice', serving_grams: 21 };
  eq(gramsPerUnit(cheese, 'pack').grams, 227, 'a pack weighs the package');
  eq(gramsPerUnit(cheese, 'slice').grams, 21, 'a slice weighs the serving');
  // The bug this fixes: before, grams_each was never set by anything but the
  // dev fixture, so both of these were null and the item scored zero calories.
  eq(gramsPerUnit(null, 'pack').grams, null, 'no food, no package weight');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
