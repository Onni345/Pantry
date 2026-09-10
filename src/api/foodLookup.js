/**
 * Food lookup. USDA FoodData Central is the primary source; Open Food Facts
 * is the fallback, since it carries store brands and barcodes that USDA does
 * not. Results are normalised to one shape and cached in Dexie, so a food is
 * only ever fetched once per device.
 *
 * Macros are always stored per 100 g / 100 ml. Both sources report on that
 * basis, and keeping one basis means macro maths later never has to ask which
 * source a number came from.
 */
import { cacheFood, getCachedFood, searchCachedFoods } from '../db/queries.js';
import { DATASET_RANK, titleCase, isPlausible, dedupe, rankSort } from './foodQuality.js';

const USDA_KEY = import.meta.env.VITE_USDA_API_KEY || 'DEMO_KEY';
const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const OFF_SEARCH = 'https://world.openfoodfacts.org/api/v2/search';
const OFF_PRODUCT = 'https://world.openfoodfacts.org/api/v2/product';

/** USDA nutrient ids. Stable across datasets. */
const N = { ENERGY_KCAL: 1008, PROTEIN: 1003, FAT: 1004, CARBS: 1005 };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * USDA returns nutrients in two different shapes depending on endpoint:
 * search gives {nutrientId, value}, detail gives {nutrient:{id}, amount}.
 */
function usdaNutrient(food, id) {
  const list = food.foodNutrients || [];
  for (const n of list) {
    const nid = n.nutrientId ?? n.nutrient?.id;
    if (nid === id) return num(n.value ?? n.amount);
  }
  return null;
}

function fromUsda(food) {
  const dataType = food.dataType || '';
  const brand = food.brandName || food.brandOwner || '';
  // Branded descriptions arrive SHOUTED. Generic ones are already sentence case.
  const desc = dataType === 'Branded' ? titleCase(food.description) : food.description;

  return {
    food_db_id: `usda:${food.fdcId}`,
    name: [desc, brand && titleCase(brand)].filter(Boolean).join(' — '),
    source: 'usda',
    detail: dataType === 'Branded' ? 'Branded' : `USDA ${dataType}`,
    rank: DATASET_RANK[dataType] ?? 4,
    macros_per_unit: {
      basis: 'per_100g',
      calories: usdaNutrient(food, N.ENERGY_KCAL),
      protein_g: usdaNutrient(food, N.PROTEIN),
      carbs_g: usdaNutrient(food, N.CARBS),
      fat_g: usdaNutrient(food, N.FAT)
    }
  };
}

function fromOff(product) {
  const nut = product.nutriments || {};
  return {
    rank: 3,
    food_db_id: `off:${product.code}`,
    name: [product.product_name, product.brands].filter(Boolean).join(' — ') ||
      String(product.code),
    source: 'off',
    detail: 'Open Food Facts',
    macros_per_unit: {
      basis: 'per_100g',
      calories: num(nut['energy-kcal_100g']),
      protein_g: num(nut.proteins_100g),
      carbs_g: num(nut.carbohydrates_100g),
      fat_g: num(nut.fat_100g)
    }
  };
}

/** A result with no macros at all is not worth showing or caching. */
const hasMacros = (r) =>
  Object.entries(r.macros_per_unit).some(
    ([k, v]) => k !== 'basis' && v !== null && v !== 0
  );

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Over-fetches, then re-ranks locally. USDA sorts by its own relevance score,
 * which buries the curated datasets; asking for 40 and sorting ourselves costs
 * one request and puts real food first.
 */
async function searchUsda(query, signal, limit) {
  const url =
    `${USDA_SEARCH}?api_key=${encodeURIComponent(USDA_KEY)}` +
    `&query=${encodeURIComponent(query)}` +
    `&pageSize=40` +
    `&dataType=${encodeURIComponent('Foundation,SR Legacy,Branded')}`;

  const data = await getJson(url, signal);
  const mapped = (data.foods || []).map(fromUsda).filter(isPlausible);

  return rankSort(dedupe(mapped)).slice(0, limit);
}

async function searchOff(query, signal, limit) {
  const url =
    `${OFF_SEARCH}?search_terms=${encodeURIComponent(query)}` +
    `&fields=code,product_name,brands,nutriments&page_size=${limit}`;
  const data = await getJson(url, signal);
  return (data.products || []).map(fromOff);
}

const isBarcode = (q) => /^\d{8,14}$/.test(q.trim());

async function lookupBarcode(code, signal) {
  const data = await getJson(`${OFF_PRODUCT}/${encodeURIComponent(code)}.json`, signal);
  if (!data.product) return [];
  return [fromOff({ ...data.product, code })];
}

/**
 * Search-as-you-type entry point.
 *
 * Returns { results, offline, error }. A failed network call is never fatal:
 * previously cached foods still match, so the form keeps working on a plane.
 * `signal` should come from an AbortController so stale keystrokes are dropped.
 */
export async function lookupFood(query, { signal, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return { results: [], offline: false, error: '' };

  const cached = await searchCachedFoods(q, limit);

  let results = [];
  let error = '';
  let offline = false;

  try {
    results = isBarcode(q)
      ? await lookupBarcode(q, signal)
      : await searchUsda(q, signal, limit);

    // USDA is thin on store brands; fall back rather than show nothing.
    if (results.filter(hasMacros).length === 0) {
      results = (await searchOff(q, signal, limit)).filter(isPlausible);
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    offline = true;
    error =
      e.status === 429
        ? 'Food lookup is rate-limited right now. Cached results only.'
        : e.status === 403
          ? 'The USDA API key was rejected. Check VITE_USDA_API_KEY in .env.'
          : e.status === 400
            ? 'USDA rejected the search request. This is a bug, not a network issue — check the request URL in devtools.'
            : 'Could not reach the food database. Cached results only.';
  }

  const fresh = results.filter(hasMacros);
  await Promise.all(fresh.map(cacheFood));

  // Cached hits first — they are foods this household has actually used.
  const seen = new Set();
  const merged = [];
  for (const r of [...cached, ...fresh]) {
    if (seen.has(r.food_db_id)) continue;
    seen.add(r.food_db_id);
    merged.push(r);
  }

  return { results: merged.slice(0, limit), offline, error };
}

export { getCachedFood };
