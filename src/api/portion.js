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


/* ------------------------------------------------------------- servings
 *
 * Named portions, the way Cronometer offers them: you pick "large" and the
 * app knows that means 50 g. You never type a gram figure and never see one
 * unless you want to.
 *
 * The rule that keeps this honest: **the picker only appears when we are
 * actually confident.** Two things qualify —
 *
 *   1. portions the food database published for this specific food, and
 *   2. the small table below, for staples where every source agrees and the
 *      sizes are a legal grading standard rather than someone's estimate.
 *
 * The `UNIT_GRAMS` guesses above never appear here. A guess is fine as a
 * silent fallback for one hidden number; it is not fine as a menu that looks
 * like knowledge.
 */

/**
 * Staples whose portion sizes are standardised, not estimated. US egg
 * weights are the USDA grading minimums; a stick of butter is a defined
 * quarter-pound. These are the cases where offering a menu is safe.
 */
const STAPLE_SERVINGS = [
  {
    match: /\begg/i,
    exclude: /white|yolk|substitute|noodle|plant/i,
    unit: 'egg',
    servings: [
      { label: 'jumbo', grams: 63 },
      { label: 'extra large', grams: 56 },
      { label: 'large', grams: 50 },
      { label: 'medium', grams: 44 },
      { label: 'small', grams: 38 }
    ]
  },
  {
    match: /\bbutter\b/i,
    exclude: /peanut|almond|cashew|cocoa|body/i,
    unit: 'stick',
    servings: [
      { label: 'stick', grams: 113 },
      { label: 'tablespoon', grams: 14 },
      { label: 'teaspoon', grams: 5 }
    ]
  },
  {
    match: /\bbread\b|\btoast\b|sourdough|\brye\b|\bbagel\b/i,
    exclude: /crumb|pudding|stuffing/i,
    unit: 'slice',
    servings: [
      { label: 'thick slice', grams: 38 },
      { label: 'slice', grams: 28 },
      { label: 'thin slice', grams: 22 }
    ]
  },
  {
    // Cheeses are usually named by variety, not by the word "cheese", so the
    // common sliceable ones are listed outright.
    match: /cheese|cheddar|swiss|provolone|gouda|havarti|mozzarella|munster|monterey|colby|american singles/i,
    exclude: /cake|cream cheese|cottage|powder|sauce|shred|grated|crumbl/i,
    unit: 'slice',
    servings: [
      { label: 'slice', grams: 21 },
      { label: 'thick slice', grams: 28 }
    ]
  }
];

const near = (a, b) => Math.abs(a - b) < 0.5;

/**
 * Every named portion we are confident about for this food, largest first.
 *
 * Returns [] when we are not confident — which is the signal to the UI that
 * there should be no dropdown at all, rather than a dropdown of guesses.
 */
export function servingsFor(food) {
  const out = [];
  const name = food?.name || '';

  // 1. What the database published for this exact food. Most trustworthy:
  //    it is about this product, not about the category.
  for (const s of food?.servings || []) {
    const grams = Number(s.grams);
    if (grams > 0 && s.label) out.push({ label: String(s.label), grams, basis: 'database' });
  }

  // 2. The single serving the search result carried, if the detail fetch
  //    never happened or added nothing.
  if (food?.serving_grams > 0 && food?.serving_text) {
    out.push({ label: String(food.serving_text), grams: Number(food.serving_grams), basis: 'database' });
  }

  // 3. Standardised sizes for staples.
  if (name) {
    for (const rule of STAPLE_SERVINGS) {
      if (!rule.match.test(name)) continue;
      if (rule.exclude?.test(name)) continue;
      for (const s of rule.servings) out.push({ ...s, basis: 'standard' });
      break;
    }
  }

  // 4. The whole packet, when its weight is known — "1 pack — 227 g" belongs
  //    in the same menu as "1 slice — 21 g".
  if (food?.package_grams > 0) {
    out.push({
      label: food.package_text ? `package (${food.package_text})` : 'package',
      grams: Number(food.package_grams),
      basis: 'database'
    });
  }

  // Same weight twice under different words helps nobody; the database's own
  // wording wins over ours.
  const seen = [];
  for (const s of out) {
    const dup = seen.find((k) => near(k.grams, s.grams));
    if (dup) continue;
    seen.push(s);
  }

  return seen.sort((a, b) => b.grams - a.grams);
}

/** Should a picker be offered at all? */
export const hasConfidentServings = (food) => servingsFor(food).length > 0;

/**
 * The portion to select by default. "large" for eggs rather than the biggest
 * or the first — the common case should need no interaction.
 */
export function defaultServing(food, unit = null) {
  const list = servingsFor(food);
  if (!list.length) return null;

  // If the item is already counted in a noun, honour it — but pick the plain
  // one. Counting "slices" means a slice, not the thick-cut variant that also
  // happens to contain the word.
  if (unit) {
    const u = String(unit).toLowerCase();
    const hits = list
      .filter((s) => s.label.toLowerCase().includes(u))
      .sort((a, b) =>
        (a.basis === 'database' ? 0 : 1) - (b.basis === 'database' ? 0 : 1) ||
        a.label.length - b.label.length);
    if (hits.length) return hits[0];
  }

  return list.find((s) => /\blarge\b/.test(s.label) && !/extra/.test(s.label)) ||
    list.find((s) => s.basis === 'standard') ||
    list[0];
}

export { STAPLE_SERVINGS };

export { UNIT_GRAMS, PACKAGE_NOUNS };
