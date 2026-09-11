/**
 * Receipt OCR text -> staging rows. Pure: no fetch, no Dexie, no React, no
 * model call. Three regexes find the priced lines, and one substring rule
 * decides whether a food-database hit is really the same food.
 */
import { KNOWN_UNITS } from '../../units.js';
import { titleCase } from '../../api/foodQuality.js';

// Lines that are exactly one of these (no other text) are not a purchased
// item, even though they end in a price — a subtotal, a tax line, or a
// "SPECIAL" discount marker that most grocery receipts print as its own
// line under the item it discounts. Matched against the *whole* line text
// preceding the price, so "GRAPES GREEN" a few lines away is untouched.
const NON_ITEM_LINE = /^(sub ?total|total|tax|gst|vat|cash|change|balance( due)?|discount|special|promo|markdown|round(ing)?|tender|approved|eftpos|visa|mastercard|debit|credit|loyalty|rewards?|savings?)$/i;

// "0.778kg NET @ $5.99/kg" — the weight sub-line grocery receipts print
// directly under a weighed item's name/price line. Exact, structured data
// once you know the pattern, so it is read rather than interpreted: a
// weighed item's quantity comes straight off the receipt.
const WEIGHT_SUBLINE = /^([\d.]+)\s*(kg|g|lb|oz)\s*net\b/i;

// A line ending in a price: some name text, then an optional minus sign
// (for a "-15.00" discount line) and a decimal amount, right at line end.
const PRICE_LINE = /^(.+?)\s+-?\$?\s?(\d+\.\d{2})\s*$/;

function normalizeUnit(u) {
  const n = String(u || '').toLowerCase();
  return KNOWN_UNITS.has(n) ? n : 'count';
}

/**
 * Every price-bearing line in the OCR text, deterministically — the
 * candidate list nothing downstream is allowed to shrink. `rawName` is
 * whatever text preceded the price, unmodified; `toRows` tidies it into a
 * display name, but every candidate here becomes exactly one staged row.
 */
export function extractCandidateLines(ocrText) {
  const lines = String(ocrText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (WEIGHT_SUBLINE.test(line)) continue; // consumed by the item above, not its own row

    const m = PRICE_LINE.exec(line);
    if (!m) continue;

    const rawName = m[1].trim();
    const price = Number(m[2]);
    if (!rawName || !Number.isFinite(price) || NON_ITEM_LINE.test(rawName)) continue;

    const weightLine = WEIGHT_SUBLINE.exec(lines[i + 1] || '');

    candidates.push({
      rawName,
      price,
      quantity: weightLine ? Number(weightLine[1]) : 1,
      unit: weightLine ? normalizeUnit(weightLine[2]) : 'count'
    });
  }

  return candidates;
}

/**
 * Builds the final staging rows from the candidate list — one row per
 * candidate, always. Nothing here can shrink the list or fail: name
 * expansion is a pure table lookup, so a receipt stages the same way with
 * no network, no API key, and no quota left.
 */
export function toRows(candidates) {
  return candidates.map((c) => ({
    id: crypto.randomUUID(),
    rawName: c.rawName,
    name: titleCase(c.rawName),
    quantity: c.quantity,
    unit: c.unit,
    price: c.price,
    include: true,
    matchStatus: 'searching', // the component kicks off a food-lookup right away
    matchedFood: null
  }));
}

/**
 * Is this lookup result plausibly the same food as the receipt line?
 *
 * One rule: the first real word off the receipt has to appear in the food's
 * name. That's it. "GRAPES GREEN" won't match "Beet greens, raw", and
 * "BROCCOLI" will match "Broccoli, leaves, raw" — which is the whole job.
 * A miss just means that item carries no macros, which is a fine outcome;
 * a wrong match is not, because it gets believed.
 */
export function acceptFoodMatch(queryName, food) {
  const first = String(queryName || '').toLowerCase().match(/[a-z]{3,}/)?.[0];
  if (!first || !food?.name) return false;
  return food.name.toLowerCase().includes(first);
}

/**
 * Folds one food-lookup result into a staged row. Kept as a pure function
 * (rather than inlined in the component) so the matching rule — first result
 * wins, no result means unmatched — lives in one place and is easy to test.
 */
export function withMatch(row, food) {
  return food
    ? { ...row, matchStatus: 'matched', matchedFood: food }
    : { ...row, matchStatus: 'not_found', matchedFood: null };
}

/** Rows the user has kept checked and given a usable name — what Save sends on. */
export function includedRows(rows) {
  return rows.filter((r) => r.include && r.name.trim());
}
