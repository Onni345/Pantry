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

  count: { dimension: DIMENSIONS.COUNT, factor: 1,  label: 'count' },
  dozen: { dimension: DIMENSIONS.COUNT, factor: 12, label: 'dozen' }
};

export const UNITS_BY_DIMENSION = {
  [DIMENSIONS.WEIGHT]: ['g', 'kg', 'oz', 'lb'],
  [DIMENSIONS.COUNT]: ['count', 'dozen']
};

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
