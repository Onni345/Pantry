/**
 * LLM-backed shelf-life estimation.
 *
 * The API key is supplied by the user and kept in this browser's local
 * storage — never in .env, never in the built bundle. A bundled key would be
 * readable by anyone with the URL and would spend the owner's quota.
 *
 * Every estimate is cached by food name, so a given food costs one call ever
 * per device. Without a key the app still works: expiry simply stays manual.
 */
import { db } from '../db/schema.js';

const KEY_STORAGE = 'pantry.llm_api_key';
/**
 * Tried in order. Google retires model names on its own schedule — the ones
 * hardcoded here in September stopped resolving for new keys — so a 404 moves
 * to the next rather than failing the feature. The first that works is
 * remembered, so this costs one extra call ever, not one per lookup.
 */
const MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest'
];
const MODEL_STORAGE = 'pantry.llm_model';
const base = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

function rememberedModel() {
  try { return localStorage.getItem(MODEL_STORAGE) || null; } catch { return null; }
}
function rememberModel(m) {
  try { localStorage.setItem(MODEL_STORAGE, m); } catch { /* storage blocked */ }
}

/**
 * Storage access is wrapped because it is not always available: absent during
 * server rendering, and it throws outright in browsers configured to block
 * site data. Neither should take the app down — the only cost of failing to
 * read the key is that expiry estimation stays off.
 */
export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export const hasApiKey = () => Boolean(getApiKey());

export function setApiKey(key) {
  const trimmed = String(key || '').trim();
  try {
    if (trimmed) localStorage.setItem(KEY_STORAGE, trimmed);
    else localStorage.removeItem(KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

/** Cache key: the food, not the shopping trip. Two bags of carrots share one. */
export const shelfLifeKey = (name, category) =>
  `${String(name || '').toLowerCase().trim().replace(/\s+/g, ' ')}|${category || ''}`;

const LOCATIONS = ['unopened_fridge', 'opened_fridge', 'freezer', 'pantry'];

/**
 * Validates the model's answer before it is trusted.
 *
 * A language model can return prose, wrong keys, negative numbers or a decade
 * of shelf life for milk. Anything that fails these checks is discarded rather
 * than stored, because a wrong expiry date is worse than no expiry date — it
 * gets acted on.
 */
export function parseShelfLife(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in the response.');
    data = JSON.parse(match[0]);
  }
  if (!data || typeof data !== 'object') throw new Error('Response was not an object.');

  const out = {};
  for (const loc of LOCATIONS) {
    const v = data[loc];
    if (v === null || v === undefined) { out[loc] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) { out[loc] = null; continue; }
    // Ten years is generous for salt and absurd for anything perishable.
    out[loc] = n > 3650 ? null : Math.round(n);
  }

  if (LOCATIONS.every((l) => out[l] === null)) {
    throw new Error('No usable shelf-life figures in the response.');
  }
  return out;
}

const PROMPT = (name, category) =>
  `Estimate typical shelf life in DAYS for this food, for home storage.

Food: ${name}
Category: ${category || 'unknown'}

Use null where storing it that way makes no sense (e.g. pantry for raw fish).
Base the figures on common food-safety guidance for a domestic fridge at 4C.`;

/**
 * Asks Gemini for the figures with a response schema attached, so the model
 * returns typed JSON rather than prose that has to be scraped. The validation
 * in parseShelfLife still runs: a schema constrains the shape, not the sense —
 * it will happily return 7300 days for milk.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    unopened_fridge: { type: 'integer', nullable: true },
    opened_fridge: { type: 'integer', nullable: true },
    freezer: { type: 'integer', nullable: true },
    pantry: { type: 'integer', nullable: true }
  },
  required: ['unopened_fridge', 'opened_fridge', 'freezer', 'pantry']
};

async function requestOnce(model, prompt, schema, maxOutputTokens, signal) {
  const res = await fetch(base(model), {
    method: 'POST',
    signal,
    // The key travels as a header rather than in the query string, so it does
    // not end up in browser history or any intermediary's request logs.
    headers: { 'content-type': 'application/json', 'x-goog-api-key': getApiKey() },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
        maxOutputTokens
      }
    })
  });
  return res;
}

/**
 * Runs a structured-output request against Gemini, trying MODELS in order
 * until one answers. Shared by shelf-life estimation and recipe suggestions
 * so both get the same model-fallback and error handling for free.
 */
export async function callGeminiJSON(prompt, schema, { maxOutputTokens = 300, signal } = {}) {
  const remembered = rememberedModel();
  const order = remembered ? [remembered, ...MODELS.filter((m) => m !== remembered)] : MODELS;

  let lastError = null;

  for (const model of order) {
    const res = await requestOnce(model, prompt, schema, maxOutputTokens, signal);

    if (res.ok) {
      const data = await res.json();
      const finish = data?.candidates?.[0]?.finishReason;
      if (finish && finish !== 'STOP') throw new Error(`Gemini stopped early (${finish}).`);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini returned no content.');
      rememberModel(model);
      return text;
    }

    const body = await res.text().catch(() => '');

    // A retired or unknown model: try the next one.
    if (res.status === 404) {
      lastError = new Error(`No usable Gemini model (last tried ${model}).`);
      continue;
    }

    // Busy right now, but the model itself is fine — another model may be
    // free, so keep going rather than giving up on the whole feature.
    if (res.status === 503) {
      lastError = new Error('Gemini is busy. Try again shortly.');
      continue;
    }

    // Anything else is about the key or the quota, not the model. Trying
    // further models would just burn more of an already-exhausted quota.
    const err = new Error(
      res.status === 429
        ? 'Gemini quota exceeded for now. Try again later.'
        : res.status === 403 || /API key not valid/i.test(body)
          ? 'That API key was rejected. Check it in Settings.'
          : res.status === 400
            ? `Gemini rejected the request (${res.status}). This is a bug, not a quota issue.`
            : `Gemini request failed (${res.status}).`
    );
    err.status = res.status;
    throw err;
  }

  throw lastError || new Error('Gemini request failed.');
}

/**
 * Shelf life for a food, in days per storage location.
 * Returns null when there is no key and nothing cached — never guesses.
 */
export async function getShelfLife(name, category, { signal } = {}) {
  const key = shelfLifeKey(name, category);

  const cached = await db.expiry_cache.get(key);
  if (cached) return cached.estimated_shelf_life_days;

  if (!hasApiKey()) return null;

  const text = await callGeminiJSON(PROMPT(name, category), RESPONSE_SCHEMA, { signal });
  const parsed = parseShelfLife(text);

  await db.expiry_cache.put({
    food_name_or_category: key,
    estimated_shelf_life_days: parsed,
    cached_at: new Date().toISOString()
  });

  return parsed;
}

/**
 * Which shelf-life figure applies to an item sitting in a given place.
 * Unopened is assumed, since an item is logged when it is bought.
 */
export function daysForLocation(shelfLife, location) {
  if (!shelfLife) return null;
  if (location === 'freezer') return shelfLife.freezer ?? shelfLife.unopened_fridge ?? null;
  if (location === 'fridge') return shelfLife.unopened_fridge ?? shelfLife.opened_fridge ?? null;
  if (location === 'pantry') return shelfLife.pantry ?? shelfLife.unopened_fridge ?? null;
  return null;
}

export function expiryDateFrom(days, from = new Date()) {
  if (!days) return null;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Best-effort estimate for a newly added item. Never throws into the UI. */
export async function estimateExpiryFor(item) {
  try {
    const shelfLife = await getShelfLife(item.name, item.category);
    const days = daysForLocation(shelfLife, item.location);
    return expiryDateFrom(days, new Date(item.created_at));
  } catch (e) {
    console.warn('expiry: estimate failed', e.message);
    return null;
  }
}


/**
 * Asks Gemini for recipe ideas grounded in the current inventory.
 * Costs one real call every time — this has no cache, since a recipe result
 * is only valid for the exact stock it was generated from, and a cache key
 * that changes on every use/add would essentially never hit.
 */
export async function suggestRecipes(items, { signal } = {}) {
  const { buildPrompt, parseRecipes, eligibleItems } = await import('../features/recipes/recipes.js');

  const stock = eligibleItems(items);
  if (stock.length === 0) {
    throw new Error('Nothing weighed and in stock to build a recipe from yet.');
  }

  const { prompt, schema } = buildPrompt(stock);
  const text = await callGeminiJSON(prompt, schema, { maxOutputTokens: 2000, signal });
  return parseRecipes(text, stock);
}
