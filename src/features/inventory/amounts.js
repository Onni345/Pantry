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
 * Pure — no Dexie, no React, no fetch.
 */
import { formatGrams, niceNumber, pluralize, round, WEIGHT_UNITS } from '../../units.js';
import { servingsFor } from '../../api/portion.js';

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

