/**
 * Receipt scanning: prompt building and response validation.
 *
 * Pure — no fetch, no Dexie, no React, no food-database lookup. `scanReceipt`
 * (in ../../api/llm.js) does the network call to Gemini; food matching is a
 * separate network call the component drives (see ReceiptScan.jsx). This
 * module only decides what to ask for and what shape a "staged" line item
 * takes before either of those touch it.
 */
import { KNOWN_UNITS } from '../../units.js';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number', nullable: true },
          unit: { type: 'string', nullable: true },
          price: { type: 'number', nullable: true }
        },
        required: ['name']
      }
    }
  },
  required: ['items']
};

const PROMPT = `This image is a grocery store receipt. Extract every purchased food or
grocery line item. Skip subtotals, tax, totals, loyalty/rewards messages, coupons, and
non-food lines (bag fees, gift cards, and similar).

For each item give:
- name: a plain, searchable food name (expand obvious abbreviations, e.g. "ORG BANANA" -> "Organic Banana")
- quantity: the number of units or weight bought, if printed (just the number, no unit)
- unit: a short unit word if you can tell one ("g", "kg", "lb", "oz", or "count"), omit if unclear
- price: the line price, if printed (just the number, no currency symbol)

Reply as JSON matching the given schema. If the image is not a readable receipt, return
an empty items array rather than guessing.`;

export function buildReceiptPrompt() {
  return { prompt: PROMPT, schema: RESPONSE_SCHEMA };
}

/**
 * Validates the model's answer and shapes it into editable staging rows.
 *
 * A receipt read is a starting point, not a fact: every row is meant to sit
 * in an editable list the user confirms before anything reaches inventory,
 * so this is about discarding garbage (empty names, non-finite numbers)
 * rather than rejecting anything borderline the way parseRecipes does — a
 * wrong guess here just becomes a row the user corrects, not a silent write.
 */
export function parseReceiptItems(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in the response.');
    data = JSON.parse(match[0]);
  }
  if (!data || !Array.isArray(data.items)) {
    throw new Error('Response had no items array.');
  }

  const out = [];
  for (const entry of data.items) {
    const name = String(entry?.name || '').trim();
    if (!name) continue;

    const qty = Number(entry?.quantity);
    const price = Number(entry?.price);
    const unit = String(entry?.unit || '').trim().toLowerCase();

    out.push({
      id: crypto.randomUUID(),
      rawName: name,
      name,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit: KNOWN_UNITS.has(unit) ? unit : 'count',
      price: Number.isFinite(price) && price >= 0 ? price : null,
      include: true,
      matchStatus: 'searching', // set to 'searching' as soon as staged; the
      matchedFood: null          // component kicks off the lookup right away
    });
  }
  return out;
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
