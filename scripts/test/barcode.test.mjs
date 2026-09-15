/**
 * Barcode normalisation.
 *
 * The finding this guards: FDC stores every GTIN zero-padded to fourteen
 * digits and its tokenizer does not normalise lengths, so the twelve digits a
 * UPC-A scanner hands you match NOTHING. Not a bad ranking — a flat zero.
 * Every scan of a standard US barcode would have silently found nothing.
 */
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('PASS ', n); pass++; }
  catch (e) { console.log('FAIL ', n, '\n        ' + e.message); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

// The widths the lookup tries, mirroring foodLookup.lookupBarcodeUsda.
const widthsFor = (code) => {
  const digits = String(code).replace(/\D/g, '');
  return [14, 13, 12].filter((w) => w >= digits.length).map((w) => digits.padStart(w, '0'));
};

t('A UPC-A SCAN IS PADDED TO 14 — the whole point', () => {
  const tried = widthsFor('016000275287');
  eq(tried[0], '00016000275287', 'fourteen digits, as FDC stores them');
  eq(tried.includes('016000275287'), true, 'the raw scan is still tried');
});

t('an EAN-13 pads by one', () => {
  eq(widthsFor('5000112637922')[0], '05000112637922', 'fourteen');
});

t('a GTIN-14 is left alone', () => {
  const tried = widthsFor('00016000275287');
  eq(tried.length, 1, 'nothing narrower to try');
  eq(tried[0], '00016000275287', 'unchanged');
});

t('an EAN-8 is padded and every wider form is tried', () => {
  const tried = widthsFor('96385074');
  eq(tried[0], '00000096385074', 'fourteen');
  eq(tried.length, 3, 'fourteen, thirteen, twelve');
});

t('separators in a typed code are ignored', () => {
  eq(widthsFor('0-16000-27528-7')[0], '00016000275287', 'digits only');
});

t('widest first, so the stored form is found on the first call', () => {
  eq(widthsFor('016000275287').map((c) => c.length).join(','), '14,13,12', 'order');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
