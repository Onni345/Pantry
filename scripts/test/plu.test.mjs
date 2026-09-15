/**
 * Produce codes.
 *
 * The rule that matters most here is the one NOT implemented: a leading 8
 * does not mean genetically modified. That range was reserved for it, never
 * used at retail, and formally reassigned in 2015 to ordinary conventional
 * and organic produce. Several popular open PLU datasets still document the
 * old meaning, so it is worth a test that would fail if someone "fixed" this
 * back.
 */
import { readPlu, pluQuery, isPluCode, PLU_CODES } from '../../src/api/plu.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

t('a four-digit code is conventionally grown', () => {
  const r = readPlu('4011');
  eq(r.name, 'Banana', 'name');
  eq(r.organic, false, 'conventional');
});

t('a leading 9 means organic, and the rest is the same code', () => {
  const r = readPlu('94011');
  eq(r.name, 'Banana', 'same fruit');
  eq(r.organic, true, 'organic');
  eq(r.code, '4011', 'the nine is stripped');
  eq(pluQuery('94011'), 'Organic Banana', 'and the search says so');
});

t('A LEADING 8 IS NOT "GENETICALLY MODIFIED"', () => {
  // Retired in 2015 and reassigned. If this ever starts returning a gmo flag,
  // someone has copied a stale dataset's semantics.
  const r = readPlu('84011');
  eq(r, null, 'not a recognised code, and certainly not a GMO marker');
  eq(Object.keys(PLU_CODES).some((c) => c.startsWith('8')), false,
    'no 8-prefixed entries in the table');
});

t('a five-digit code not starting with 9 is not a PLU', () => {
  eq(readPlu('54011'), null, 'rejected');
  eq(readPlu('12345'), null, 'rejected');
});

t('an unknown code resolves to nothing rather than a guess', () => {
  eq(readPlu('4999'), null, 'no entry');
  eq(pluQuery('4999'), null, 'and no query');
});

t('a barcode is not mistaken for a produce sticker', () => {
  eq(isPluCode('016000275287'), false, 'twelve digits');
  eq(isPluCode('4011'), true, 'four');
  eq(isPluCode('94011'), true, 'five');
});

t('separators and spaces in a typed code are ignored', () => {
  eq(readPlu(' 4011 ').name, 'Banana', 'trimmed');
});

t('the table only holds entries worth vouching for', () => {
  const codes = Object.keys(PLU_CODES);
  eq(codes.length > 40, true, 'enough to cover a weekly shop');
  eq(codes.every((c) => /^\d{4}$/.test(c)), true, 'all four-digit conventional codes');
  eq(Object.values(PLU_CODES).every((v) => typeof v === 'string' && v.length > 2), true,
    'every code names something');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
