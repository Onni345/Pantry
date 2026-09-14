/**
 * Scoring and sanity checks for food-database results. Pure — no Dexie, no
 * fetch — so it can be tested directly.
 *
 * The important idea here is that *dataset quality and relevance are
 * different questions*, and an earlier version of this file confused them.
 * It sorted strictly by dataset, so a search for "Good & Gather Jasmine Rice"
 * put USDA's curated "Rice, white, long-grain, raw" above the actual product,
 * every time. The database was never generic; the sort was.
 *
 * Now relevance leads and the dataset is a tiebreaker whose direction depends
 * on what was asked for. Someone typing a brand wants that brand. Someone
 * typing "chicken breast" wants the lab-analysed generic entry.
 */

/**
 * Dataset standing, used only to break ties between results that matched the
 * query equally well. Foundation and SR Legacy are lab-analysed and curated;
 * Branded is manufacturer-submitted, unvetted and full of near-duplicates.
 */
export const DATASET_RANK = { Foundation: 0, 'SR Legacy': 1, 'Survey (FNDDS)': 2, Branded: 3 };

/** What a caller is looking for. `auto` decides from the query itself. */
export const PREFER = { BRANDED: 'branded', GENERIC: 'generic', AUTO: 'auto' };

/**
 * Dataset bonuses, by what the caller wants. These are deliberately small
 * next to the relevance score below: they settle ties, they don't overturn a
 * better match.
 */
const PRIOR = {
  [PREFER.GENERIC]: { Foundation: 18, 'SR Legacy': 16, 'Survey (FNDDS)': 10, Branded: 0, off: 0 },
  [PREFER.BRANDED]: { Foundation: 4, 'SR Legacy': 3, 'Survey (FNDDS)': 2, Branded: 16, off: 14 }
};

export function titleCase(s) {
  return String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

const words = (s) =>
  String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Rejects rows whose macros cannot be true — not rows that merely look odd.
 *
 * Grams per 100 g cannot sum past 100, nothing exceeds ~900 kcal/100 g (pure
 * fat), and stated calories should sit near the 4/4/9 figure implied by the
 * grams. The band is deliberately wide: fibre, sugar alcohols and rounding all
 * move real products legitimately, and throwing away good data is worse than
 * showing one strange row.
 */
export function isPlausible(r) {
  const m = r?.macros_per_unit || {};
  const p = m.protein_g ?? 0;
  const c = m.carbs_g ?? 0;
  const f = m.fat_g ?? 0;
  const kcal = m.calories;

  if ([p, c, f].some((v) => v < 0)) return false;
  if (kcal != null && (kcal < 0 || kcal > 900)) return false;
  if (p + c + f > 100.5) return false;

  if (kcal != null && p + c + f > 0) {
    const implied = 4 * p + 4 * c + 9 * f;
    if (kcal > implied * 1.75 + 60) return false;
    if (kcal < implied * 0.45 - 30) return false;
  }
  return true;
}

/** Collapses near-identical rows, keeping the best-scoring copy of each. */
export function dedupe(results) {
  const seen = new Map();
  for (const r of results) {
    const m = r.macros_per_unit || {};
    const key = [
      squash(r.brand),
      String(r.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      Math.round(m.calories ?? -1),
      Math.round((m.protein_g ?? -1) * 10)
    ].join('|');
    const prior = seen.get(key);
    if (!prior || (r.score ?? -Infinity) > (prior.score ?? -Infinity)) seen.set(key, r);
  }
  return [...seen.values()];
}

/**
 * Does this query name a brand? Used by `auto` to decide which way to lean,
 * and by the receipt resolver, which already knows the brand it expanded.
 */
export function looksBranded(query, knownBrands = []) {
  const q = squash(query);
  return knownBrands.some((b) => b && q.includes(squash(b)));
}

/**
 * How well one result answers one query, as a number. Higher is better.
 *
 * The components, in the order they matter:
 *  - coverage: what share of the query's words appear in this food at all.
 *    A result missing half the words the user typed is not the answer,
 *    whatever dataset it lives in.
 *  - brand: an exact brand hit, when the query named a brand. This is the
 *    single strongest signal a receipt gives us and it is scored that way.
 *  - prefix: the name starting with the query reads as the obvious answer.
 *  - prior: dataset standing, pointed whichever way the caller asked for.
 *  - brevity: among equally good matches the shorter name is the cleaner
 *    record; branded dumps are full of forty-word descriptions.
 */
export function scoreResult(result, { queryWords, brand, prefer }) {
  const hay = new Set([
    ...words(result.name),
    ...words(result.brand),
    ...words(result.brand_owner)
  ]);

  const hits = queryWords.filter((w) => hay.has(w)).length;
  const coverage = queryWords.length ? hits / queryWords.length : 0;

  let score = 100 * coverage;

  if (brand) {
    const want = squash(brand);
    const got = squash(result.brand) || squash(result.brand_owner);
    if (got && (got.includes(want) || want.includes(got))) score += 45;
    else if (result.detail === 'Branded' || result.source === 'off') score -= 8;
  }

  const name = String(result.name || '').toLowerCase();
  if (queryWords.length && name.startsWith(queryWords[0])) score += 12;

  const table = PRIOR[prefer] || PRIOR[PREFER.GENERIC];
  score += table[result.detail === 'Branded' ? 'Branded' : result.dataset] ??
    (result.source === 'off' ? table.off : 0);

  score -= Math.min(10, name.length / 20);

  return score;
}

/**
 * Scores and sorts results against the query that produced them.
 *
 * `brand` is what the caller believes the query's brand is — the receipt
 * resolver knows this outright, a typed search infers it.
 */
export function rankResults(results, query, { prefer = PREFER.AUTO, brand = null, knownBrands = [] } = {}) {
  const queryWords = words(query);
  const mode = prefer === PREFER.AUTO
    ? (brand || looksBranded(query, knownBrands) ? PREFER.BRANDED : PREFER.GENERIC)
    : prefer;

  return results
    .map((r) => ({ ...r, score: scoreResult(r, { queryWords, brand, prefer: mode }) }))
    .sort((a, b) => b.score - a.score);
}
