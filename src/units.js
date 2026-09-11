/**
 * Unit handling.
 *
 * Two dimensions only: WEIGHT and COUNT. Pantry assumes food gets weighed —
 * that is the point of the app — so milk, honey and oil are all logged in
 * grams like everything else. Volume units are deliberately absent: allowing
 * them would mean guessing a density, and a guessed number undermines the
 * fine-grained control the app exists to give.
 *
 * An item is stored in its dimension's BASE unit (grams, or whole things).
 * Events record deltas in that base unit plus what the user typed, so buying
 * 1 kg and using 30 g of it is just arithmetic.
 *
 * Pure module — no React, no Dexie, no network.
 */

export const DIMENSIONS = { WEIGHT: 'weight', COUNT: 'count' };

/**
 * Natural units: nouns you count. "14 slices", "2 containers", "half a
 * gallon". The app does not need to know what a slice weighs to track that
 * you have fourteen of them — weight is optional metadata, not the price of
 * entry. Anything here behaves as a count: one unit, whatever a unit is.
 */
export const NATURAL_UNITS = [
  'item', 'pack', 'container', 'bottle', 'can', 'jar', 'box', 'bag', 'carton', 'tub',
  'egg', 'slice', 'loaf', 'bunch', 'head', 'clove', 'stick', 'breast', 'fillet', 'steak',
  'gallon', 'quart', 'pint', 'litre', 'cup'
];

/** A handful of nouns that don't pluralise by adding an s. */
const IRREGULAR = { loaf: 'loaves', leaf: 'leaves', bunch: 'bunches', box: 'boxes' };

export function pluralize(noun, n) {
  const v = Math.abs(Number(n) || 0);
  // "1 gallon" and "½ gallon", but "0 eggs" and "1½ gallons".
  if (v === 1 || (v > 0 && v < 1)) return noun;
  return IRREGULAR[noun] || `${noun}s`;
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

export const BASE_UNIT = {
  [DIMENSIONS.WEIGHT]: 'g',
  [DIMENSIONS.COUNT]: 'count'
};

/** Multiplier to the dimension's base unit. Exact factors. */
export const UNITS = {
  g:     { dimension: DIMENSIONS.WEIGHT, factor: 1,            label: 'g' },
  kg:    { dimension: DIMENSIONS.WEIGHT, factor: 1000,         label: 'kg' },
  oz:    { dimension: DIMENSIONS.WEIGHT, factor: 28.349523125, label: 'oz' },
  lb:    { dimension: DIMENSIONS.WEIGHT, factor: 453.59237,    label: 'lb' },

  count: { dimension: DIMENSIONS.COUNT, factor: 1,  label: 'item' },
  dozen: { dimension: DIMENSIONS.COUNT, factor: 12, label: 'dozen' }
};

for (const noun of NATURAL_UNITS) {
  if (!UNITS[noun]) UNITS[noun] = { dimension: DIMENSIONS.COUNT, factor: 1, label: noun };
}

export const UNITS_BY_DIMENSION = {
  [DIMENSIONS.WEIGHT]: ['g', 'kg', 'oz', 'lb'],
  [DIMENSIONS.COUNT]: ['count', 'dozen', ...NATURAL_UNITS.filter((u) => u !== 'item')]
};

/**
 * How an item reads to a person: "8 eggs", "14 slices", "½ gallon", "1.1 kg".
 *
 * The stored shape (quantity + base unit + the noun it was bought in) is
 * never what's shown. An item counted in slices says slices; only genuinely
 * weighed things talk in grams.
 */
export function describe(item) {
  const qty = Number(item.quantity) || 0;
  if (item.base_unit === 'g') {
    const { value, unit } = humanize(qty, 'g');
    return `${value} ${unit}`;
  }
  const noun = item.display_unit && item.display_unit !== 'count' ? item.display_unit : 'item';
  return `${niceNumber(qty)} ${pluralize(noun, qty)}`;
}

/** Every recognized unit key, for quick "is this a real unit" checks. */
export const KNOWN_UNITS = new Set(Object.keys(UNITS));

export const dimensionOf = (unit) => UNITS[unit]?.dimension ?? null;
export const unitLabel = (unit) => UNITS[unit]?.label ?? unit;

export function baseUnitFor(unit) {
  const d = dimensionOf(unit);
  return d ? BASE_UNIT[d] : null;
}

/**
 * Converts an amount into an item's base unit. Always exact.
 *
 * Throws across dimensions: three eggs have no weight the app can know, and
 * inventing one would be worse than refusing.
 */
export function toBase(value, fromUnit, baseUnit) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Amount must be a number.');

  const from = UNITS[fromUnit];
  const to = UNITS[baseUnit];
  if (!from) throw new Error(`Unknown unit: ${fromUnit}`);
  if (!to) throw new Error(`Unknown base unit: ${baseUnit}`);
  if (to.factor !== 1) throw new Error(`${baseUnit} is not a base unit.`);

  if (from.dimension !== to.dimension) {
    throw new Error(
      `Cannot convert ${unitLabel(fromUnit)} to ${unitLabel(baseUnit)} — ` +
        'counted items have no weight of their own.'
    );
  }

  return n * from.factor;
}

/** A base-unit amount expressed in some other unit of the same dimension. */
export function fromBase(baseValue, baseUnit, toUnit) {
  const to = UNITS[toUnit];
  const base = UNITS[baseUnit];
  if (!to || !base) throw new Error('Unknown unit.');
  if (to.dimension !== base.dimension) {
    throw new Error('Counted items cannot be shown as a weight.');
  }
  return Number(baseValue) / to.factor;
}

/** Readable form: 1200 g reads better as 1.2 kg, 30 g should stay grams. */
export function humanize(baseValue, baseUnit) {
  const v = Number(baseValue) || 0;
  if (baseUnit === 'count') return { value: round(v, 2), unit: 'count' };
  if (baseUnit === 'g') {
    return v >= 1000
      ? { value: round(v / 1000, 2), unit: 'kg' }
      : { value: round(v, 1), unit: 'g' };
  }
  return { value: round(v, 2), unit: baseUnit };
}

export function formatBase(baseValue, baseUnit) {
  const { value, unit } = humanize(baseValue, baseUnit);
  return `${value} ${unit === 'count' ? '' : unit}`.trim();
}

export function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(Number(n) * f) / f;
}

/** Units offered when entering an amount — same dimension as the item. */
export function enterableUnits(baseUnit) {
  const dim = dimensionOf(baseUnit);
  return dim ? [...UNITS_BY_DIMENSION[dim]] : [];
}
