/**
 * Deciding what a receipt line actually is.
 *
 * This is the one part of receipt handling where a model earns its place.
 * Choosing between "GRAPES GREEN" -> *Grapes, red or green, raw* and
 * *Beet greens, raw* is judgment over real options, not a lookup with a right
 * answer — which is exactly the line drawn elsewhere in this codebase (regex
 * finds the lines, a table expands abbreviations, a model picks the match).
 *
 * Two rules make it safe:
 *  - It chooses by index from candidates the food database actually returned.
 *    It cannot invent a food, only pick one or decline.
 *  - It reports confidence per field, and anything it isn't sure about comes
 *    back flagged for a human rather than quietly accepted.
 *
 * Pure — no fetch, no React. `matchReceiptLines` in ../../api/llm.js makes the
 * call; this decides what to ask and whether the answer is usable.
 */
import { KNOWN_UNITS } from '../../units.js';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer' },
          name: { type: 'string' },
          name_confident: { type: 'boolean' },
          match: { type: 'integer' },          // index into candidates, -1 for none
          match_confident: { type: 'boolean' },
          quantity: { type: 'number', nullable: true },
          unit: { type: 'string', nullable: true },
          quantity_confident: { type: 'boolean' }
        },
        required: ['line', 'name', 'name_confident', 'match', 'match_confident', 'quantity_confident']
      }
    }
  },
  required: ['lines']
};

/**
 * One prompt for a handful of lines. Candidates are numbered per line so the
 * model answers with an index rather than free text — an index can be checked,
 * a name can't.
 */
export function buildMatchPrompt(rows) {
  const blocks = rows.map((row, i) => {
    const candidates = row.candidates.length
      ? row.candidates.map((c, k) => {
          const brand = c.brand || c.brand_owner;
          const size = c.package_text ? `, ${c.package_text}` : '';
          return `    ${k}. ${c.name}${brand ? ` — ${brand}` : ''}${size}` +
            `${c.detail ? ` [${c.detail}]` : ''}`;
        }).join('\n')
      : '    (the food database returned nothing)';
    return `LINE ${i}
  Receipt text: "${row.rawName}"
${row.retailer ? `  Shop: ${row.retailer}\n` : ''}` +
`${row.brand ? `  Store brand expanded from the receipt: ${row.brand}\n` : ''}` +
`  Printed quantity: ${row.quantity ?? 'not printed'} ${row.unit || ''}
  Candidates:
${candidates}`;
  }).join('\n\n');

  return {
    schema: RESPONSE_SCHEMA,
    prompt: `These are lines from a supermarket receipt, read by OCR, with candidate
matches from a food database. For each line decide what was actually bought.

${blocks}

For each line return:
- line: the LINE number above
- name: a clean shopper's name for the item ("ORG BANANA" -> "Organic Bananas").
  Base it on the receipt text, not on a candidate you aren't sure about.
- name_confident: false if the receipt text is too garbled to name confidently
- match: the index of the candidate that is the SAME PRODUCT, or -1 if none of
  them are. A candidate that is merely a related food is not a match — "Beet
  greens, raw" is not grapes, and "Flour, potato" is not potatoes.
  When the receipt names a brand, a candidate carrying that brand beats a
  generic entry for the same food: the shopper bought that packet, and the
  packet is what has a weight and a barcode. When no brand is named, prefer
  the plain unprocessed entry over a prepared or branded one.
- match_confident: false if you had to guess, or if you picked -1 because the
  candidates were unusable rather than because the item is genuinely unmatched
- quantity / unit: how many were bought and of what ("3", "item"), using the
  printed quantity when there is one. Natural units are fine and preferred —
  item, pack, bottle, slice, bag, loaf, bunch, can, jar, egg — or a weight in
  g/kg/lb/oz if the receipt priced it by weight.
- quantity_confident: false if the receipt didn't say and you're assuming

Be honest with the confidence flags. A flagged field gets a human's attention,
which is cheap; a wrong field that looks confident gets stored, which is not.

Reply as JSON matching the schema, one entry per line, same order.`
  };
}

const clean = (s) => String(s || '').trim();

/**
 * The model is asked for a natural unit and usually gives one, but "lb.",
 * "bunch of", "each" and similar turn up. An unknown unit would leave the
 * select with nothing selected and make addItem throw on save, so anything
 * the app doesn't recognise falls back to the receipt's own unit and the
 * field is flagged instead.
 */
function knownUnit(word) {
  const w = clean(word).toLowerCase().replace(/[^a-z]/g, '');
  if (KNOWN_UNITS.has(w)) return w;
  // Plurals are the common near-miss: "slices", "packs", "eggs".
  const singular = w.replace(/s$/, '');
  return KNOWN_UNITS.has(singular) ? singular : null;
}

/**
 * Validates one chunk's answer and folds it into the rows it came from.
 *
 * Anything the model got wrong structurally — a missing line, an out-of-range
 * candidate index, a nonsense quantity — degrades that field to "needs
 * review" rather than throwing the chunk away. A receipt where three fields
 * are highlighted is still a useful receipt.
 */
export function applyMatches(rows, raw) {
  let data = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON object in the response.');
    data = JSON.parse(m[0]);
  }
  const byLine = new Map();
  for (const entry of Array.isArray(data?.lines) ? data.lines : []) {
    if (Number.isInteger(entry?.line)) byLine.set(entry.line, entry);
  }

  return rows.map((row, i) => {
    const got = byLine.get(i);
    // The model skipped this line. Nothing about it was decided, so nothing
    // about it is presented as decided.
    if (!got) {
      return { ...row, state: 'done', review: { name: true, match: true, quantity: true } };
    }

    const name = clean(got.name) || row.name;
    const idx = Number(got.match);
    const picked =
      Number.isInteger(idx) && idx >= 0 && idx < row.candidates.length
        ? row.candidates[idx]
        : null;

    const qty = Number(got.quantity);
    const goodQty = Number.isFinite(qty) && qty > 0;
    const unit = knownUnit(got.unit);

    return {
      ...row,
      state: 'done',
      name,
      quantity: goodQty ? qty : row.quantity,
      unit: unit || row.unit,
      matchedFood: picked,
      // A field is flagged when the model said it wasn't sure, or when the
      // answer didn't survive validation. Both mean the same thing to the
      // person looking at the screen: check this one.
      review: {
        name: got.name_confident === false || !clean(got.name),
        match: got.match_confident === false || (idx >= 0 && !picked),
        quantity:
          got.quantity_confident === false ||
          !goodQty ||
          // It named a unit the app doesn't have, so the one on screen is the
          // receipt's guess rather than its answer.
          (clean(got.unit) !== '' && !unit)
      }
    };
  });
}

/** Split into chunks so rows land in waves instead of one long blank wait. */
export function chunk(rows, size = 5) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
