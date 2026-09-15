/**
 * Receipt OCR text -> staging rows. Pure: no fetch, no Dexie, no React.
 *
 * Reading a receipt is clerical work with a right answer, so no model is
 * involved: regexes find the priced lines, a table expands the till's
 * abbreviations (retailers.js), and another table tidies what's left.
 * Deciding which *product* a line is happens next door in matching.js, where
 * there is genuine judgment to exercise.
 */
import { KNOWN_UNITS } from '../../units.js';
import { titleCase } from '../../api/foodQuality.js';
import { detectRetailer, expandReceiptText } from '../../api/retailers.js';

// Lines that are exactly one of these (no other text) are not a purchased
// item, even though they end in a price — a subtotal, a tax line, or a
// "SPECIAL" discount marker that most grocery receipts print as its own
// line under the item it discounts.
const NON_ITEM_LINE = /^(sub ?total|total|tax|gst|vat|cash|change|balance( due)?|discount|special|promo|markdown|round(ing)?|tender|approved|eftpos|visa|mastercard|debit|credit|loyalty|rewards?|savings?)$/i;

// "0.778kg NET @ $5.99/kg" — the weight sub-line printed directly under a
// weighed item. Exact, structured data once you know the pattern.
const WEIGHT_SUBLINE = /^([\d.]+)\s*(kg|g|lb|oz)\s*net\b/i;

// "3 @ $1.29" / "3 @ 1.29 ea" — the multi-buy sub-line. Same idea: the
// receipt is telling us the count outright, so it gets read, not guessed.
const COUNT_SUBLINE = /^(\d+)\s*(?:@|x|for)\s*\$?\s*([\d.]+)/i;

// "2 X OIKOS GREEK YOGURT" — the same information printed inline instead.
const COUNT_PREFIX = /^(\d{1,2})\s*[x×@]\s*(.+)$/i;

// A line ending in a price: some name text, then an optional minus sign
// (for a "-15.00" discount line) and a decimal amount, right at line end.
const PRICE_LINE = /^(.+?)\s+-?\$?\s?(\d+\.\d{2})\s*$/;

function normalizeUnit(u) {
  const n = String(u || '').toLowerCase();
  return KNOWN_UNITS.has(n) ? n : 'count';
}

/**
 * Every price-bearing line in the OCR text, deterministically — the
 * candidate list nothing downstream is allowed to shrink. Each candidate
 * becomes exactly one staged row, whether or not anything can be made of it.
 */
export function extractCandidateLines(ocrText) {
  const lines = String(ocrText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Consumed by the item above, not rows of their own.
    if (WEIGHT_SUBLINE.test(line) || COUNT_SUBLINE.test(line)) continue;

    const m = PRICE_LINE.exec(line);
    if (!m) continue;

    let rawName = m[1].trim();
    const price = Number(m[2]);
    if (!rawName || !Number.isFinite(price) || NON_ITEM_LINE.test(rawName)) continue;

    // The count may be printed inline ("2 X YOGURT") or on the next line
    // ("2 @ $1.29"). Either way the receipt said it, so we read it.
    let quantity = 1;
    let unit = 'count';

    const inline = COUNT_PREFIX.exec(rawName);
    if (inline) {
      quantity = Number(inline[1]);
      rawName = inline[2].trim();
    }

    const next = lines[i + 1] || '';
    const weightLine = WEIGHT_SUBLINE.exec(next);
    const countLine = COUNT_SUBLINE.exec(next);

    if (weightLine) {
      quantity = Number(weightLine[1]);
      unit = normalizeUnit(weightLine[2]);
    } else if (countLine) {
      quantity = Number(countLine[1]);
    }

    candidates.push({ rawName, price, quantity, unit });
  }

  return candidates;
}

/**
 * Builds the staging rows — one per candidate, always.
 *
 * The retailer is read once from the header and applied to every line, since
 * "GOODGATH" only expands to Good & Gather if we know this is a Target
 * receipt. Nothing here can fail or shrink the list: expansion is pure table
 * lookup, so a receipt stages identically with no network and no API key.
 */
export function toRows(candidates, ocrText = '') {
  const retailer = detectRetailer(ocrText);

  return candidates.map((c) => {
    const expanded = expandReceiptText(c.rawName, retailer);
    return {
      id: crypto.randomUUID(),
      rawName: c.rawName,
      name: titleCase(expanded.product || c.rawName),
      // What we'll actually search for, and the brand we believe we found.
      query: expanded.query,
      brand: expanded.brand,
      retailer: retailer?.name || null,
      quantity: c.quantity,
      unit: c.unit,
      price: c.price,
      // True when the receipt printed a weight, so nothing was assumed.
      weighed: c.unit !== 'count',
      include: true,
      decided: false,          // has a person said yes or no to this one
      state: 'searching',      // searching -> deciding -> done
      candidates: [],
      matchedFood: null,
      // Per-field: true means "a person should look at this".
      review: {}
    };
  });
}

/**
 * The fallback matcher, for when there's no API key or the quota is gone.
 * One rule: the first real word off the receipt has to appear in the food's
 * name. Crude, which is why every row it decides is flagged.
 */
export function acceptFoodMatch(queryName, food) {
  const first = String(queryName || '').toLowerCase().match(/[a-z]{3,}/)?.[0];
  if (!first || !food?.name) return false;
  return `${food.name} ${food.brand || ''}`.toLowerCase().includes(first);
}


/**
 * How sure we are, as one word, because that is what the card shows.
 *
 *  high    nothing flagged and a product attached. Glance and accept.
 *  medium  something is attached but a field is shaky. Worth a look.
 *  low     no product, or the name itself was unreadable. Don't pretend.
 */
export function confidenceOf(row) {
  if (row.state !== 'done') return 'working';
  const r = row.review || {};
  if (!row.matchedFood || r.name) return 'low';
  if (r.match || r.quantity) return 'medium';
  return 'high';
}


/** Rows the user has kept and given a usable name — what Save sends on. */
export function includedRows(rows) {
  return rows.filter((r) => r.include && r.name.trim());
}
