/**
 * Units.
 *
 * Grams are the only real unit. Everything else is a *name for a number of
 * grams* — an egg is 50 of them, a jar is 454, a slice is 21 — and the app's
 * job is to let people speak in those names while it quietly keeps the grams.
 *
 * An item stores its amount in a base unit, which is grams whenever a weight
 * is knowable and `count` only for things with genuinely no weight ("two
 * containers of leftover curry"). `display_unit` is the noun it is spoken in.
 * Nothing here converts between the two dimensions — that needs to know what
 * one of a thing weighs, which is the item's business, not this module's, and
 * lives in features/inventory/amounts.js.
 *
 * Volume is deliberately absent. Millilitres to grams needs a density, and a
 * guessed density is exactly the kind of invented number this app refuses to
 * store. A carton counted in "1 carton" works fine without one.
 */

export const DIMENSIONS = { WEIGHT: 'weight', COUNT: 'count' };

/**
 * Nouns you count. "14 slices", "2 containers", "half a gallon". The app does
 * not need to know what a slice weighs to track that you have fourteen — the
 * weight is optional metadata that unlocks macros, not the price of entry.
 */
export const NATURAL_UNITS = [
  'item', 'pack', 'container', 'bottle', 'can', 'jar', 'box', 'bag', 'carton', 'tub',
  'egg', 'slice', 'loaf', 'bunch', 'head', 'clove', 'stick', 'breast', 'fillet', 'steak',
  'gallon', 'quart', 'pint', 'litre', 'cup',
  // A recognised product's own nutrition-label serving — "3 servings", not
  // "3 packs". See features/inventory/amounts.js `productAmount`.
  'serving'
];

/** Weight units someone might type. Exact factors, all to grams. */
export const WEIGHT_UNITS = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237
};

export const WEIGHT_UNIT_NAMES = Object.keys(WEIGHT_UNITS);

const COUNT_UNITS = new Set(['count', 'dozen', ...NATURAL_UNITS]);

/** Every unit name the app recognises, for "is this real" checks. */
export const KNOWN_UNITS = new Set([...WEIGHT_UNIT_NAMES, ...COUNT_UNITS]);

export const dimensionOf = (unit) =>
  WEIGHT_UNITS[unit] ? DIMENSIONS.WEIGHT : COUNT_UNITS.has(unit) ? DIMENSIONS.COUNT : null;

export const unitLabel = (unit) => (unit === 'count' ? 'item' : unit);

export function baseUnitFor(unit) {
  const d = dimensionOf(unit);
  return d === DIMENSIONS.WEIGHT ? 'g' : d === DIMENSIONS.COUNT ? 'count' : null;
}

/** Nouns that don't pluralise by adding an s. */
const IRREGULAR = { loaf: 'loaves', leaf: 'leaves', knife: 'knives' };

/** Food words ending in -o that take -es. Everything else takes -s. */
const O_ES = new Set(['potato', 'tomato', 'mango', 'buffalo', 'hero', 'echo', 'volcano']);

export function pluralize(noun, n) {
  const v = Math.abs(Number(n) || 0);
  // "1 gallon" and "½ gallon", but "0 eggs" and "1½ gallons".
  if (v === 1 || (v > 0 && v < 1)) return noun;
  if (IRREGULAR[noun]) return IRREGULAR[noun];

  // -ch, -sh, -s, -x, -z take -es: bunches, boxes.
  if (/(ch|sh|s|x|z)$/.test(noun)) return `${noun}es`;
  // -o is not decidable by spelling: potatoes but avocados, both a consonant
  // before the o. It is about the word's origin, so the -es words are listed.
  if (O_ES.has(noun)) return `${noun}es`;
  // Consonant before -y turns to -ies: berries, patties.
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** ½ reads better than 0.5 on a carton of milk. */
const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.33: '⅓', 0.67: '⅔' };

export function niceNumber(n) {
  const v = Number(n) || 0;
  const whole = Math.floor(v);
  const frac = Math.round((v - whole) * 100) / 100;
  const glyph = FRACTIONS[frac];
  if (!glyph) return String(round(v, 2));
  return whole === 0 ? glyph : `${whole}${glyph}`;
}

/** 1200 g reads better as 1.2 kg; 30 g should stay grams. */
export function formatGrams(grams) {
  const v = Number(grams) || 0;
  return v >= 1000 ? `${round(v / 1000, 2)} kg` : `${round(v, v < 10 ? 1 : 0)} g`;
}

/**
 * Converts an amount into an item's base unit, within one dimension.
 *
 * Crossing dimensions throws on purpose: grams to eggs needs to know what one
 * egg weighs, which this module has no business knowing. amounts.js does that
 * conversion, using the item's own recorded weight.
 */
export function toBase(value, fromUnit, baseUnit) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Amount must be a number.');
  if (!KNOWN_UNITS.has(fromUnit)) throw new Error(`Unknown unit: ${fromUnit}`);

  if (baseUnit === 'g') {
    const factor = WEIGHT_UNITS[fromUnit];
    if (!factor) {
      throw new Error(
        `Cannot convert ${unitLabel(fromUnit)} to grams here — ` +
        'that needs to know what one of them weighs.'
      );
    }
    return n * factor;
  }

  if (baseUnit === 'count') {
    if (WEIGHT_UNITS[fromUnit]) {
      throw new Error('Cannot convert a weight to a count without a weight per unit.');
    }
    return fromUnit === 'dozen' ? n * 12 : n;
  }

  throw new Error(`Unknown base unit: ${baseUnit}`);
}

/** Units offered when entering an amount — same dimension as the item. */
export function enterableUnits(baseUnit) {
  return baseUnit === 'g' ? [...WEIGHT_UNIT_NAMES] : ['count', 'dozen', ...NATURAL_UNITS];
}

export function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(Number(n) * f) / f;
}
