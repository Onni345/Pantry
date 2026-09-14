/**
 * What one of them weighs.
 *
 * This is the join between the two number systems the app runs on. The screen
 * counts nouns — 8 eggs, 1 pack, 2 slices — because that is how people think
 * about food. Nutrition is published per 100 grams. Without a grams-per-unit
 * figure the two never meet, and every counted item contributes exactly zero
 * to the day's macros no matter how carefully it was logged.
 *
 * Three sources, best first, and the caller is told which one answered so a
 * guess is never presented as a measurement:
 *
 *   package  the database knows the packet weighs 907 g, and you bought a
 *            packet. Exact.
 *   serving  the database knows a serving is 21 g and calls that serving a
 *            slice, and you are counting slices. Exact.
 *   table    nobody knows, but a large egg is about 50 g. A guess, labelled.
 *
 * Pure module — no fetch, no Dexie, no React.
 */
import { dimensionOf, DIMENSIONS } from '../units.js';

/**
 * Nouns that mean "the whole thing as sold". Counting these means the package
 * weight is the answer.
 */
const PACKAGE_NOUNS = new Set([
  'item', 'pack', 'container', 'bottle', 'can', 'jar', 'box', 'bag',
  'carton', 'tub', 'loaf', 'count'
]);

/**
 * Typical weights for nouns the databases rarely quantify, in grams. Round
 * numbers on purpose: these are openly approximate, and a false precision
 * like 49.6 would imply someone weighed it.
 */
const UNIT_GRAMS = {
  egg: 50,
  slice: 28,
  stick: 113,
  clove: 3,
  breast: 174,
  fillet: 150,
  steak: 220,
  head: 550,
  cup: 150,
  bunch: 400
};

/**
 * Where the plain noun is too broad to be useful. A slice of sandwich cheese
 * and a slice of bread are both "a slice" and are not remotely the same
 * weight, so the food's own name breaks the tie.
 */
const OVERRIDES = [
  { unit: 'slice', match: /cheese/i, grams: 21 },
  { unit: 'slice', match: /bacon/i, grams: 12 },
  { unit: 'slice', match: /ham|turkey|salami|deli/i, grams: 28 },
  { unit: 'slice', match: /pizza/i, grams: 107 },
  { unit: 'slice', match: /bread|toast|sourdough|rye/i, grams: 28 },
  { unit: 'head', match: /garlic/i, grams: 45 },
  { unit: 'head', match: /broccoli/i, grams: 550 },
  { unit: 'head', match: /lettuce|cabbage/i, grams: 600 },
  { unit: 'cup', match: /rice|oats|flour/i, grams: 190 },
  { unit: 'cup', match: /milk|water|juice|broth/i, grams: 240 },
  { unit: 'egg', match: /quail/i, grams: 9 },
  { unit: 'egg', match: /jumbo|extra large/i, grams: 63 }
];

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** Does the database's serving description describe this noun? */
function servingIsUnit(food, unit) {
  const text = squash(food?.serving_text);
  if (!text) return false;
  const u = squash(unit);
  return Boolean(u) && (text.includes(u) || text.includes(`${u}s`));
}

/**
 * Grams for one `unit` of `food`.
 *
 * Returns { grams, basis, exact } — `basis` names the source above, `exact`
 * is false whenever the answer came from the table, so the UI can mark it as
 * an estimate and let someone correct it.
 *
 * Returns grams: null when the item is weighed anyway (no conversion needed)
 * or when nothing here can answer honestly.
 */
export function gramsPerUnit(food, unit) {
  // Already a weight. Converting a weight to a weight is arithmetic the
  // units module does, and this function has nothing to add.
  if (dimensionOf(unit) === DIMENSIONS.WEIGHT) {
    return { grams: null, basis: 'weighed', exact: true };
  }

  const noun = String(unit || '').toLowerCase();

  if (food) {
    // Counting whole packets, and the database knows what a packet weighs.
    if (PACKAGE_NOUNS.has(noun) && food.package_grams > 0) {
      return { grams: food.package_grams, basis: 'package', exact: true };
    }
    // Counting the very thing the database calls a serving.
    if (food.serving_grams > 0 && servingIsUnit(food, noun)) {
      return { grams: food.serving_grams, basis: 'serving', exact: true };
    }
    // A packet with only a serving weight: better than nothing for a noun
    // that means the whole thing, but say it is a guess.
    if (PACKAGE_NOUNS.has(noun) && food.serving_grams > 0) {
      return { grams: food.serving_grams, basis: 'serving', exact: false };
    }
  }

  const name = food?.name || '';
  const override = OVERRIDES.find((o) => o.unit === noun && o.match.test(name));
  if (override) return { grams: override.grams, basis: 'table', exact: false };

  if (UNIT_GRAMS[noun]) return { grams: UNIT_GRAMS[noun], basis: 'table', exact: false };

  return { grams: null, basis: null, exact: false };
}

/**
 * How many of `unit` a package holds, when both weights are known —
 * "1 pack = 10 slices". Lets a pack be bought whole and eaten in slices.
 */
export function unitsPerPackage(food, unit) {
  const { grams } = gramsPerUnit(food, unit);
  if (!grams || !(food?.package_grams > 0)) return null;
  const n = food.package_grams / grams;
  return n >= 1.5 ? Math.round(n) : null;
}

export { UNIT_GRAMS, PACKAGE_NOUNS };
