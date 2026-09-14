import { rankResults, PREFER, scoreResult, looksBranded, dedupe }
  from '../../src/api/foodQuality.js';
import { expandReceiptText, detectRetailer, ALL_STORE_BRANDS }
  from '../../src/api/retailers.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('PASS ', name); pass++; }
  catch (e) { console.log('FAIL ', name, '\n        ' + e.message); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const F = (o) => ({
  name: '', brand: '', brand_owner: '', dataset: 'Foundation', detail: 'USDA Foundation',
  source: 'usda', macros_per_unit: {}, ...o
});

const generic = F({ name: 'Rice, white, long-grain, regular, raw, unenriched', dataset: 'Foundation', detail: 'USDA Foundation' });
const branded = F({ name: 'Jasmine Rice', brand: 'Good & Gather', brand_owner: 'Target Stores', dataset: 'Branded', detail: 'Branded' });
const wrongBrand = F({ name: 'Jasmine Rice', brand: 'Mahatma', dataset: 'Branded', detail: 'Branded' });

t('a branded query puts the branded product first', () => {
  const r = rankResults([generic, wrongBrand, branded], 'Good & Gather Jasmine Rice',
    { prefer: PREFER.BRANDED, brand: 'Good & Gather' });
  eq(r[0].brand, 'Good & Gather', 'top result');
});

t('THE OLD BEHAVIOUR FAILS: sorting by dataset alone picks the generic', () => {
  // This is exactly what rankSort did — a.rank - b.rank, nothing else.
  const old = [generic, wrongBrand, branded]
    .map((r) => ({ ...r, rank: { Foundation: 0, 'SR Legacy': 1, 'Survey (FNDDS)': 2, Branded: 3 }[r.dataset] }))
    .sort((a, b) => a.rank - b.rank || a.name.length - b.name.length);
  eq(old[0].dataset, 'Foundation', 'old sort really did bury the brand');
  if (old[0].brand === 'Good & Gather') throw new Error('old sort would have worked; test proves nothing');
});

t('a plain ingredient query still prefers the curated generic entry', () => {
  const r = rankResults([branded, generic], 'rice white long grain raw',
    { prefer: PREFER.GENERIC });
  eq(r[0].dataset, 'Foundation', 'top result');
});

t('auto infers branded from a known store brand in the query', () => {
  const r = rankResults([generic, branded], 'good and gather jasmine rice',
    { prefer: PREFER.AUTO, knownBrands: ALL_STORE_BRANDS });
  eq(r[0].brand, 'Good & Gather', 'top result');
});

t('auto infers generic when no brand is named', () => {
  const r = rankResults([branded, generic], 'white rice raw',
    { prefer: PREFER.AUTO, knownBrands: ALL_STORE_BRANDS });
  eq(r[0].dataset, 'Foundation', 'top result');
});

t('the right brand beats a different brand with the same product name', () => {
  const r = rankResults([wrongBrand, branded], 'Good & Gather Jasmine Rice',
    { prefer: PREFER.BRANDED, brand: 'Good & Gather' });
  eq(r[0].brand, 'Good & Gather', 'top result');
});

t('word coverage beats dataset standing', () => {
  const beetGreens = F({ name: 'Beet greens, raw', dataset: 'Foundation', detail: 'USDA Foundation' });
  const grapes = F({ name: 'Grapes, red or green, raw', dataset: 'SR Legacy', detail: 'USDA SR Legacy' });
  const r = rankResults([beetGreens, grapes], 'grapes green', { prefer: PREFER.GENERIC });
  eq(r[0].name, 'Grapes, red or green, raw', 'top result');
});

t('looksBranded spots a store brand written loosely', () => {
  eq(looksBranded('kirkland signature chicken', ALL_STORE_BRANDS), true, 'kirkland');
  eq(looksBranded('chicken breast raw', ALL_STORE_BRANDS), false, 'plain');
});

t('dedupe keeps the higher-scoring copy, not the first seen', () => {
  const a = { ...branded, score: 10, food_db_id: 'a', macros_per_unit: { calories: 130, protein_g: 2.7 } };
  const b = { ...branded, score: 90, food_db_id: 'b', macros_per_unit: { calories: 130, protein_g: 2.7 } };
  const out = dedupe([a, b]);
  eq(out.length, 1, 'collapsed');
  eq(out[0].food_db_id, 'b', 'kept the better one');
});

t('dedupe keeps two different brands of the same product apart', () => {
  const a = { ...branded, score: 10, macros_per_unit: { calories: 130, protein_g: 2.7 } };
  const b = { ...wrongBrand, score: 10, macros_per_unit: { calories: 130, protein_g: 2.7 } };
  eq(dedupe([a, b]).length, 2, 'kept both');
});

// ---- the receipt path end to end -------------------------------------------
t('a Target receipt line resolves to a brand and a clean product', () => {
  const r = detectRetailer('TARGET\nStore T-1234\nSeattle WA 98101\n');
  const e = expandReceiptText('GOODGATH JASMINE RICE 5LB', r);
  eq(e.brand, 'Good & Gather', 'brand');
  eq(e.product, 'jasmine rice', 'product');
  eq(e.query, 'Good & Gather jasmine rice', 'query');
});

t('noise words and sizes are stripped, shorthand expanded', () => {
  const e = expandReceiptText('ORG CHKN BRST 1.2LB', null);
  eq(e.product, 'chicken breast', 'product');
});

t('a store brand from another chain is not believed', () => {
  const target = detectRetailer('TARGET\n');
  eq(expandReceiptText('KS ORG CHKN BRST', target).brand, null, 'KS on a Target receipt');
  const costco = detectRetailer('COSTCO WHOLESALE\n');
  eq(expandReceiptText('KS ORG CHKN BRST', costco).brand, 'Kirkland Signature', 'KS at Costco');
});

t('an unrecognised shop still produces a usable query', () => {
  eq(detectRetailer('JOE’S CORNER MARKET\n'), null, 'no retailer');
  eq(expandReceiptText('GRAPES GREEN', null).query, 'grapes green', 'query');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
