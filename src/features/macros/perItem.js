/**
 * Macros for one item, expressed in the unit that item is actually counted in.
 *
 * The intake screen answers "what did I eat today". This answers a different
 * question, asked while standing at the open fridge door: *what is this, per
 * one of them?* An egg should say what an egg is worth. Rice, bought by
 * weight, should say what 100 g is worth. Nobody should have to do the
 * division themselves.
 *
 * Nutrition is published per 100 g, so a counted item needs `grams_each` to
 * answer at all. Without it this returns null rather than a guess — the UI
 * then says the nutrition is missing and offers to fix it, which is more
 * useful than a confident wrong number.
 *
 * Pure — no Dexie, no React, no fetch.
 */
import { pluralize } from '../../units.js';

const KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g'];

const scale = (macros, factor) => {
  const out = {};
  for (const k of KEYS) {
    const v = Number(macros?.[k]);
    out[k] = Number.isFinite(v) ? round(v * factor, k === 'calories' ? 0 : 1) : null;
  }
  return out;
};

/**
 * What one unit of this item is worth.
 *
 * Returns { basis, grams, ...macros } where `basis` is the phrase to print —
 * "per egg", "per slice", "per 100 g" — or null when it cannot be worked out.
 */
export function perUnit(item, macros = item?.macros) {
  if (!macros) return null;

  // Weighed food talks in the unit its nutrition is already published in.
  // Converting "per 100 g" to "per 100 g" would be theatre.
  if (item.base_unit === 'g') {
    return { basis: 'per 100 g', grams: 100, ...scale(macros, 1) };
  }

  const grams = Number(item.grams_each);
  if (!Number.isFinite(grams) || grams <= 0) return null;

  const noun = item.display_unit && item.display_unit !== 'count' ? item.display_unit : 'item';
  return { basis: `per ${noun}`, grams, noun, ...scale(macros, grams / 100) };
}

/**
 * What the whole of what's left is worth — "12 eggs, 1,716 kcal".
 *
 * The number people actually want when deciding whether there is dinner in
 * the house. Null on the same terms as perUnit.
 */
export function inStock(item, macros = item?.macros) {
  if (!macros) return null;

  const quantity = Number(item.quantity) || 0;
  if (quantity <= 0) return null;

  const grams = item.base_unit === 'g' ? quantity : quantity * Number(item.grams_each || 0);
  if (!Number.isFinite(grams) || grams <= 0) return null;

  const noun = item.base_unit === 'g'
    ? null
    : pluralize(item.display_unit && item.display_unit !== 'count' ? item.display_unit : 'item', quantity);

  return { grams: round(grams, 0), noun, ...scale(macros, grams / 100) };
}

/**
 * Why an item contributes nothing, in one word, so the UI can say something
 * specific rather than leaving a silent blank.
 *
 *   'ok'      it counts
 *   'no-food' nothing is attached, so there are no macros to scale
 *   'no-weight' a food is attached but nobody knows what one unit weighs
 */
export function macroGap(item) {
  if (!item?.food_db_id || !item?.macros) return 'no-food';
  if (item.base_unit !== 'g' && !(Number(item.grams_each) > 0)) return 'no-weight';
  return 'ok';
}

/**
 * "1,716" — thousands separated, because four-figure calorie counts are
 * common. Nothing renders as an em dash: Number(null) is 0, which is finite,
 * so an absent figure would otherwise print as a confident zero.
 */
export const formatCalories = (n) => {
  if (n == null || n === '') return '\u2014';
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString() : '\u2014';
};

function round(n, places = 1) {
  const f = 10 ** places;
  return Math.round(Number(n) * f) / f;
}
