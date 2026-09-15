/**
 * The canonical food catalogue.
 *
 * There is exactly one of these. The receipt resolver and the search box the
 * user types into both call `lookupFood` and both get back the same food
 * objects — a receipt match and a hand-picked food are the same kind of
 * thing, so anything true of one is true of the other.
 *
 *                      CANONICAL FOOD
 *                            |
 *              +-------------+-------------+
 *        receipt resolver            user search
 *              +-------------+-------------+
 *                            |
 *                    the same food objects
 *
 * Sources, in the order they contribute:
 *   USDA FoodData Central — every dataset, Branded included. Branded carries
 *     brand, brand owner, UPC, package weight and serving size, which is what
 *     makes exact grammage possible.
 *   Open Food Facts — searched in parallel, not as a fallback. Three million
 *     products, strong on store brands, and the only source here with product
 *     photographs. Open data: it can be cached on the device indefinitely,
 *     which a local-first pantry requires and most commercial nutrition APIs
 *     forbid.
 *
 * Macros are always per 100 g. Both sources publish on that basis, so nothing
 * downstream ever has to ask where a number came from.
 */
import { cacheFood, getCachedFood, searchCachedFoods } from '../db/queries.js';
import {
  DATASET_RANK, PREFER, titleCase, isPlausible, dedupe, rankResults
} from './foodQuality.js';
import { ALL_STORE_BRANDS } from './retailers.js';

const USDA_KEY = import.meta.env.VITE_USDA_API_KEY || 'DEMO_KEY';
const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_FOOD = 'https://api.nal.usda.gov/fdc/v1/food';
const OFF_SEARCH = 'https://world.openfoodfacts.org/api/v2/search';
const OFF_PRODUCT = 'https://world.openfoodfacts.org/api/v2/product';

/** USDA nutrient ids. Stable across datasets. */
const N = { ENERGY_KCAL: 1008, PROTEIN: 1003, FAT: 1004, CARBS: 1005 };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Mass units only. Volume is deliberately absent — see units.js. */
const TO_GRAMS = { g: 1, gram: 1, grams: 1, grm: 1, kg: 1000, oz: 28.349523125, lb: 453.59237, lbs: 453.59237 };

/**
 * "5 lb", "907g", "1.5 kg" -> grams. Returns null for anything measured by
 * volume: converting millilitres to grams needs a density, and a guessed
 * density is exactly the kind of invented number this app refuses to store.
 */
export function parseWeight(text) {
  const m = String(text || '').trim().match(/^([\d.]+)\s*([a-zA-Z]+)/);
  if (!m) return null;
  const value = Number(m[1]);
  const factor = TO_GRAMS[m[2].toLowerCase()];
  return Number.isFinite(value) && factor ? Math.round(value * factor * 100) / 100 : null;
}

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

/** USDA writes serving units as 'g'/'GRM' and 'ml'/'MLT'. */
function usdaServingGrams(food) {
  const size = num(food.servingSize);
  const unit = String(food.servingSizeUnit || '').toLowerCase();
  if (size == null) return null;
  const factor = TO_GRAMS[unit];
  return factor ? Math.round(size * factor * 100) / 100 : null;
}

function fromUsda(food) {
  const dataType = food.dataType || '';
  const branded = dataType === 'Branded';
  const brand = food.brandName || food.brandOwner || '';
  // Branded descriptions arrive SHOUTED. Generic ones are already sentence case.
  const desc = branded ? titleCase(food.description) : food.description;

  return {
    food_db_id: `usda:${food.fdcId}`,
    name: desc,
    brand: branded && food.brandName ? titleCase(food.brandName) : '',
    brand_owner: food.brandOwner ? titleCase(food.brandOwner) : '',
    upc: food.gtinUpc || '',
    source: 'usda',
    dataset: dataType,
    detail: branded ? 'Branded' : `USDA ${dataType}`,
    rank: DATASET_RANK[dataType] ?? 4,
    image: null,
    // What the whole package weighs, and what one serving of it weighs. Both
    // optional, both the difference between "1 pack of cheese" meaning
    // something nutritionally and meaning nothing.
    package_text: food.packageWeight || '',
    package_grams: parseWeight(food.packageWeight),
    serving_text: food.householdServingFullText || '',
    serving_grams: usdaServingGrams(food),
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
  const brand = String(product.brands || '').split(',')[0].trim();

  return {
    food_db_id: `off:${product.code}`,
    name: product.product_name || String(product.code),
    brand: brand ? titleCase(brand) : '',
    brand_owner: product.brand_owner ? titleCase(product.brand_owner) : '',
    upc: String(product.code || ''),
    source: 'off',
    dataset: 'off',
    detail: 'Open Food Facts',
    rank: 3,
    // The only source here with photographs, and a picture of the actual
    // packet is worth more on a confirmation card than any amount of text.
    image: product.image_front_small_url || product.image_small_url || null,
    package_text: product.quantity || '',
    package_grams: num(product.product_quantity) ?? parseWeight(product.quantity),
    serving_text: product.serving_size || '',
    serving_grams: num(product.serving_quantity) ?? parseWeight(product.serving_size),
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
  Object.entries(r.macros_per_unit || {}).some(
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
 * Searches every USDA dataset.
 *
 * `dataType` is deliberately absent: with it, the API only looks inside the
 * datasets named, and anything living in the ones you left out is invisible
 * no matter how well it matches. Omitting it searches the lot — Foundation,
 * SR Legacy, Survey (FNDDS) and Branded — and the ranking sorts it out.
 */
async function searchUsda(query, signal) {
  const url =
    `${USDA_SEARCH}?api_key=${encodeURIComponent(USDA_KEY)}` +
    `&query=${encodeURIComponent(query)}&pageSize=50`;
  const data = await getJson(url, signal);
  return (data.foods || []).map(fromUsda);
}

/**
 * Open Food Facts asks callers to identify themselves. A browser cannot set
 * User-Agent — it is a forbidden header for fetch — so their own app_name /
 * app_version parameters are the compliant equivalent, and being identifiable
 * is what keeps the app from being treated as a bot and rate-limited.
 *
 * Read limits are 15 requests a minute PER IP, which is an argument for
 * calling from the browser rather than proxying: every user brings their own
 * IP instead of sharing one ceiling.
 */
const OFF_ID = 'app_name=Pantry&app_version=0.1';

const OFF_FIELDS = [
  'code', 'product_name', 'brands', 'brand_owner', 'quantity', 'product_quantity',
  'serving_size', 'serving_quantity', 'nutriments', 'image_front_small_url', 'image_small_url'
].join(',');

async function searchOff(query, signal) {
  const url =
    `${OFF_SEARCH}?search_terms=${encodeURIComponent(query)}` +
    `&fields=${OFF_FIELDS}&page_size=25&${OFF_ID}`;
  const data = await getJson(url, signal);
  return (data.products || []).map(fromOff);
}

const isBarcode = (q) => /^\d{8,14}$/.test(q.trim());

/**
 * A barcode is the only exact key this app has.
 *
 * Everything else — a receipt line, a typed name — is a guess that has to be
 * ranked, and sometimes judged by a model. A GTIN is the manufacturer's own
 * identifier for one specific packet, so matching it is a lookup with a right
 * answer and none of that machinery runs at all.
 *
 * Both sources are asked, because neither has everything: USDA Branded is
 * US-focused with manufacturer-submitted nutrition, Open Food Facts is
 * broader and carries the product photograph.
 */
async function lookupBarcode(code, signal) {
  const settled = await Promise.allSettled([
    lookupBarcodeOff(code, signal),
    lookupBarcodeUsda(code, signal)
  ]);

  const found = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') found.push(...r.value);
    else if (r.reason?.name === 'AbortError') throw r.reason;
  }
  return found;
}

async function lookupBarcodeOff(code, signal) {
  const data = await getJson(
    `${OFF_PRODUCT}/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}&${OFF_ID}`, signal
  );
  return data?.product ? [fromOff({ ...data.product, code })] : [];
}

/**
 * FDC stores every GTIN zero-padded to fourteen digits, and its search
 * tokenizer does not normalise lengths. A scanner reading a UPC-A hands you
 * twelve digits, and those twelve digits match nothing at all — not a
 * ranking problem, a flat zero. So each plausible width is tried, widest
 * first, and the first that hits wins.
 *
 * `gtinUpc:` is a fielded query, which FDC supports. It is used rather than a
 * bare number so a barcode cannot accidentally match a serving size or an
 * unrelated description. Note that an unknown field name returns zero hits
 * rather than an error, so a typo here fails silently.
 */
async function lookupBarcodeUsda(code, signal) {
  const digits = String(code).replace(/\D/g, '');
  const widths = [14, 13, 12].filter((w) => w >= digits.length);

  for (const width of widths) {
    const padded = digits.padStart(width, '0');
    const url =
      `${USDA_SEARCH}?api_key=${encodeURIComponent(USDA_KEY)}` +
      `&query=${encodeURIComponent(`gtinUpc:${padded}`)}&dataType=Branded&pageSize=5`;
    const data = await getJson(url, signal);
    const foods = (data.foods || []).map(fromUsda);
    if (foods.length) return foods;
  }
  return [];
}

/** Runs the sources together; one source failing must not sink the search. */
async function gather(query, signal) {
  const settled = await Promise.allSettled([
    searchUsda(query, signal),
    searchOff(query, signal)
  ]);
  const results = [];
  let lastError = null;

  for (const s of settled) {
    if (s.status === 'fulfilled') results.push(...s.value);
    else if (s.reason?.name === 'AbortError') throw s.reason;
    else lastError = s.reason;
  }

  // Every source failed — that is a real outage, and the caller should say so.
  if (results.length === 0 && lastError) throw lastError;
  return results;
}

/* ---------------------------------------------------------------- portions
 *
 * The search endpoint returns one serving size at most. The detail endpoint
 * returns `foodPortions` — the full list, "1 large egg", "1 cup, chopped",
 * each with its gram weight. That list is what lets someone pick a portion
 * by name instead of typing grams.
 *
 * It costs one call, so it is fetched when a food is actually chosen rather
 * than for every row of a search, and cached with the food afterwards.
 */

/** USDA writes a portion as amount + measureUnit + modifier, any of which may be blank. */
function portionLabel(p) {
  const amount = Number(p.amount);
  const unit = p.measureUnit?.name && p.measureUnit.name !== 'undetermined'
    ? p.measureUnit.name : '';
  const words = [unit, p.modifier, p.portionDescription]
    .map((w) => String(w || '').trim())
    .filter(Boolean)
    .filter((w, i, a) => a.indexOf(w) === i)
    .join(', ');
  if (!words) return null;
  return amount && amount !== 1 ? `${amount} ${words}` : words;
}

/**
 * Fills in `servings` for one food. Safe to call on anything: a food with no
 * portions, an Open Food Facts row, or an offline device comes back unchanged
 * rather than failing.
 */
export async function loadServings(food, { signal } = {}) {
  if (!food?.food_db_id?.startsWith('usda:')) return food;
  if (food.servings?.length) return food;

  const fdcId = food.food_db_id.slice(5);
  try {
    const data = await getJson(
      `${USDA_FOOD}/${encodeURIComponent(fdcId)}?api_key=${encodeURIComponent(USDA_KEY)}`,
      signal
    );

    const servings = [];
    for (const p of data.foodPortions || []) {
      const grams = num(p.gramWeight);
      const label = portionLabel(p);
      if (grams > 0 && label) servings.push({ label, grams });
    }

    // Branded foods carry the label serving instead of a portion list.
    const labelGrams = usdaServingGrams(data);
    if (labelGrams > 0 && data.householdServingFullText) {
      servings.push({ label: data.householdServingFullText, grams: labelGrams });
    }

    const enriched = {
      ...food,
      servings,
      package_text: food.package_text || data.packageWeight || '',
      package_grams: food.package_grams ?? parseWeight(data.packageWeight)
    };
    await cacheFood(enriched);
    return enriched;
  } catch {
    // Portions are an enrichment, never a requirement. Without them the food
    // still works; there is just no menu of named sizes for it.
    return food;
  }
}

/**
 * Search-as-you-type entry point, and the receipt resolver's candidate source.
 *
 * Returns { results, offline, error }. A failed network call is never fatal:
 * previously cached foods still match, so the form keeps working on a plane.
 * `signal` should come from an AbortController so stale keystrokes are dropped.
 *
 * `prefer` decides which way ties break — 'branded' when the caller knows a
 * brand was asked for, 'generic' for a plain ingredient, 'auto' to infer it.
 * `brand` is the brand the caller believes the query names; the receipt
 * resolver expands it from the till's abbreviation and passes it in.
 */
export async function lookupFood(
  query, { signal, limit = 8, prefer = PREFER.AUTO, brand = null } = {}
) {
  const q = String(query || '').trim();
  if (q.length < 2) return { results: [], offline: false, error: '' };

  const cached = await searchCachedFoods(q, limit);

  let results = [];
  let error = '';
  let offline = false;

  try {
    results = isBarcode(q) ? await lookupBarcode(q, signal) : await gather(q, signal);
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

  const fresh = results.filter(hasMacros).filter(isPlausible);
  await Promise.all(fresh.map(cacheFood));

  const ranked = rankResults(
    dedupe([...cached, ...fresh]), q,
    { prefer, brand, knownBrands: ALL_STORE_BRANDS }
  );

  return { results: ranked.slice(0, limit), offline, error };
}

export { getCachedFood, PREFER };
