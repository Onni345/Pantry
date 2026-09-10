/**
 * Pure ranking and sanity helpers for food-database results. Kept free of
 * Dexie and fetch so it can be unit-tested directly.
 */

/**
 * Dataset quality order. Foundation and SR Legacy are lab-analysed and curated
 * by USDA; Branded is manufacturer-submitted and unvetted, full of duplicates.
 * USDA's own relevance ranking puts Branded on top, which is how a search for
 * "whole milk" returns five indistinguishable rows.
 */
export const DATASET_RANK = { Foundation: 0, 'SR Legacy': 1, 'Survey (FNDDS)': 2, Branded: 3 };

export function titleCase(s) {
  return String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

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

/** Collapses near-identical rows, keeping the best-ranked copy of each. */
export function dedupe(results) {
  const seen = new Map();
  for (const r of results) {
    const m = r.macros_per_unit || {};
    const key = [
      String(r.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      Math.round(m.calories ?? -1),
      Math.round((m.protein_g ?? -1) * 10)
    ].join('|');
    const prior = seen.get(key);
    if (!prior || r.rank < prior.rank) seen.set(key, r);
  }
  return [...seen.values()];
}

export function rankSort(results) {
  return [...results].sort((a, b) => a.rank - b.rank || a.name.length - b.name.length);
}
