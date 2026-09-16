/**
 * How much of a thing there is, and how to take some.
 *
 * This is where the app's one hard idea lives. Food is stocked one way and
 * eaten another, and those two are not the same question:
 *
 *              stocked as          taken as         divides below one?
 *   potato     a 5 lb bag          one potato       no
 *   peanut     a 454 g jar         a spoonful       yes
 *   egg        12 eggs             one egg          no
 *
 * An earlier version fixed each item into "counted" or "weighed" at the
 * moment it was added, which meant the unit you bought in became the unit you
 * were stuck consuming in forever. A jar of peanut butter was one indivisible
 * jar; a bag of potatoes had no potatoes in it.
 *
 * So: grams underneath, names on top. Anything whose weight is knowable is
 * kept in grams, and the nouns — egg, potato, jar, tablespoon — are just
 * labelled gram amounts you can subtract. Items stored the old way still work
 * unchanged: a counted item with a weight per unit can be given or taken in
 * grams too, because the conversion is a division this module can do.
 *
 * It also owns the food-database side of the same question — what one unit
 * of a *catalogue entry* weighs — because keeping those apart produced two
 * functions called gramsPerUnit in two modules, with different signatures,
 * imported by different files. One module, one vocabulary.
 *
 * Pure — no Dexie, no React, no fetch.
 */
import {
  formatGrams, niceNumber, pluralize, round, WEIGHT_UNITS, dimensionOf, DIMENSIONS
} from '../../units.js';

/** Nouns that name the package itself rather than something inside it. */
const PACKAGE_NOUNS = new Set([
  'item', 'pack', 'container', 'bottle', 'can', 'jar', 'box', 'bag', 'carton', 'tub', 'loaf'
]);

/**
 * The noun this item is spoken in, or null when it has none.
 *
 * Something bought as "1.2 kg" is spoken in kilograms, which is a unit, not a
 * noun — there is no such thing as "1.2 kgs of rice" and no chip worth
 * offering for it. Those items speak in grams and nothing else.
 */
export function nounOf(item) {
  const u = item?.display_unit;
  if (!u || u === 'count') return item?.base_unit === 'g' ? null : 'item';
  return WEIGHT_UNITS[u] ? null : u;
}

/**
 * What one `display_unit` of this item weighs, or null if nobody knows.
 *
 * Two sources: a per-unit weight recorded against the item, or — for
 * something bought as a single package — the weight of the package itself.
 * A 454 g jar is 454 g per jar.
 */
export function gramsPerUnit(item) {
  const each = Number(item?.grams_each);
  if (Number.isFinite(each) && each > 0) return each;

  // The package weight stands in for the unit weight only when the noun IS
  // the package — one jar weighs the jar. A 5 lb bag is emphatically not one
  // potato, and treating it as one turns a whole bag into a single vegetable.
  const pack = Number(item?.pack_grams);
  if (Number.isFinite(pack) && pack > 0 && PACKAGE_NOUNS.has(nounOf(item))) return pack;

  return null;
}

/** Total grams currently in stock, or null when the item has no weight at all. */
export function stockGrams(item) {
  const qty = Number(item?.quantity) || 0;
  if (item?.base_unit === 'g') return qty;
  const per = gramsPerUnit(item);
  return per ? qty * per : null;
}

/**
 * The ways you can take some of this, largest first.
 *
 * Whole units come from the item itself; finer portions ("1 tbsp") come from
 * the food database via servingsFor. Both are offered on every item — the app
 * deliberately does not try to guess whether something is divisible, because
 * guessing wrong means a dead end, and offering both costs one extra chip.
 */
export function portionsFor(item, food = null) {
  const out = [];
  const per = gramsPerUnit(item);
  const noun = nounOf(item);

  // The item's own unit, always first: this is what it is counted in. An
  // item with no noun (bought by weight) simply has no such chip.
  if (noun) out.push({ label: noun, grams: per, source: 'item' });

  // The whole package, when it differs from one unit.
  const pack = Number(item?.pack_grams);
  if (pack > 0 && (!per || Math.abs(pack - per) > 0.5)) {
    out.push({ label: 'whole package', grams: pack, source: 'pack' });
  }

  // Finer named portions the database knows about — a tablespoon of peanut
  // butter, a cup of rice.
  for (const s of servingsFor(food)) {
    if (!(s.grams > 0)) continue;
    if (out.some((o) => o.grams && Math.abs(o.grams - s.grams) < 0.5)) continue;
    if (per && s.grams >= per) continue; // no point offering something bigger than a unit
    out.push({ label: s.label, grams: s.grams, source: 'food' });
  }

  return out;
}

/**
 * Turns "take this many grams" into a delta in the item's own base unit.
 *
 * A grams-based item takes it directly. A counted item divides by what one
 * unit weighs — which is how a jar counted as "1 jar" can still give up a
 * 32 g spoonful and end up at 0.93 jars, displayed as "¾ jar".
 *
 * Returns null when the item has no weight, which is the honest answer: you
 * cannot take 30 g of something nobody has weighed.
 */
export function gramsToDelta(item, grams) {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return null;
  if (item?.base_unit === 'g') return g;

  const per = gramsPerUnit(item);
  return per ? g / per : null;
}

/** And back the other way, for showing what a delta was worth. */
export function deltaToGrams(item, delta) {
  const d = Number(delta);
  if (!Number.isFinite(d)) return null;
  if (item?.base_unit === 'g') return d;
  const per = gramsPerUnit(item);
  return per ? d * per : null;
}

/** Can this item be given or taken in grams at all? */
export const supportsGrams = (item) =>
  item?.base_unit === 'g' || gramsPerUnit(item) !== null;

/**
 * How much is left, in the words you would use out loud.
 *
 * Returns { main, aside } — the natural reading, and the figure behind it.
 * A bag of potatoes reads "13 potatoes" with "2.3 kg" underneath, because
 * the first is what you want and the second is what was actually stored.
 */
export function describe(item) {
  const qty = Number(item?.quantity) || 0;
  const noun = nounOf(item);
  const per = gramsPerUnit(item);
  const pack = Number(item?.pack_grams) || 0;

  // Counted, the old way and still the right way for eggs.
  if (item?.base_unit !== 'g') {
    const grams = per ? per * qty : null;
    // Part of one, with a known weight: "390 g · 86% of the jar" beats
    // "0.86 jar", which is a number nobody says out loud.
    if (per && qty > 0 && qty < 1) {
      return {
        main: formatGrams(grams),
        aside: `${Math.round(qty * 100)}% of the ${noun || 'package'}`
      };
    }
    return {
      main: `${niceNumber(qty)} ${pluralize(noun || 'item', qty)}`,
      aside: grams ? formatGrams(grams) : null
    };
  }

  // Stored in grams. If we know what one of them weighs, say how many there
  // are — that is the sentence someone actually wants.
  // When the noun names the package itself, one unit IS the package, so
  // there is only ever one of them and rounding 0.86 up to "1 jar" hides
  // that it has been opened. Those fall through to the fraction reading.
  const packIsUnit = pack > 0 && per && Math.abs(pack - per) < 0.5;

  // A full, unopened package is simply one of them.
  if (packIsUnit && noun && qty >= pack) {
    const whole = Math.round(qty / pack);
    return { main: `${whole} ${pluralize(noun, whole)}`, aside: formatGrams(qty) };
  }

  if (per && noun && qty > 0 && !packIsUnit) {
    const units = qty / per;
    // Below three-quarters of one, counting them is silly: say the weight.
    // Above it, round to a whole — "0.9 potato" is not a sentence anyone
    // says, and the exact grams are right there in the aside.
    if (units >= 0.75) {
      const whole = Math.max(1, Math.round(units));
      return { main: `${whole} ${pluralize(noun, whole)}`, aside: formatGrams(qty) };
    }
  }

  // A part-used package reads best as a fraction of itself.
  if (pack > 0 && qty > 0 && qty < pack) {
    // The fraction is of the *package*, which is only the noun when the noun
    // names the package. A part-used bag of potatoes is a fraction of the
    // bag, not "4% of the potato".
    const of = PACKAGE_NOUNS.has(noun) ? noun : 'package';
    return { main: formatGrams(qty), aside: `${Math.round((qty / pack) * 100)}% of the ${of}` };
  }

  return { main: formatGrams(qty), aside: null };
}

/* ==========================================================================
 * The food-database side: what a CATALOGUE entry says about portions.
 * ====================================================================== */

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
 * Grams for one `unit` of a FOOD — a database record, not an item in your
 * kitchen. `gramsPerUnit` above answers the same question for an item you
 * own. They used to share a name, in separate modules, and different files
 * imported different ones; that is a mistake waiting to happen rather than a
 * naming style.
 *
 * Grams for one `unit` of `food`.
 *
 * Returns { grams, basis, exact } — `basis` names the source above, `exact`
 * is false whenever the answer came from the table, so the UI can mark it as
 * an estimate and let someone correct it.
 *
 * Returns grams: null when the item is weighed anyway (no conversion needed)
 * or when nothing here can answer honestly.
 */
export function foodUnitGrams(food, unit) {
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

export { UNIT_GRAMS };
