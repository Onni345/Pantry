/**
 * Gemini, for the two things in this app that genuinely need judgment:
 * suggesting recipes, and deciding which product a receipt line names.
 *
 * Everything else — reading a receipt, ranking a search, working out what one
 * egg weighs — is a table or a regex, because those have right answers and a
 * model would only make them less predictable.
 *
 * The API key is supplied by the user and kept in this browser's local
 * storage — never in .env, never in the built bundle. A bundled key would be
 * readable by anyone with the URL and would spend the owner's quota. Without
 * one the app still works; these two features simply say they need a key.
 */

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

async function requestOnce(model, parts, schema, maxOutputTokens, signal) {
  const res = await fetch(base(model), {
    method: 'POST',
    signal,
    // The key travels as a header rather than in the query string, so it does
    // not end up in browser history or any intermediary's request logs.
    headers: { 'content-type': 'application/json', 'x-goog-api-key': getApiKey() },
    body: JSON.stringify({
      contents: [{ parts }],
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
 * until one answers. Shared by recipe suggestions and receipt matching, so both
 * get the same model-fallback and error handling for free.
 *
 * `parts` is a Gemini "parts" array — `[{ text }]` for a plain prompt, or
 * `[{ text }, { inlineData: { mimeType, data } }]` to attach an image. A bare
 * string is accepted too and wrapped as a single text part, since most
 * callers only ever send text.
 */
async function callGeminiJSON(parts, schema, { maxOutputTokens = 300, signal } = {}) {
  const partsArray = typeof parts === 'string' ? [{ text: parts }] : parts;
  const remembered = rememberedModel();
  const order = remembered ? [remembered, ...MODELS.filter((m) => m !== remembered)] : MODELS;

  let lastError = null;

  for (const model of order) {
    const res = await requestOnce(model, partsArray, schema, maxOutputTokens, signal);

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

/**
 * Decides what a chunk of receipt lines actually are, choosing among food
 * database candidates the app already fetched.
 *
 * *Reading* the receipt still involves no model — regex finds the priced
 * lines, a table expands abbreviations. This is the step after: matching
 * garbled shop text to a real food is judgment over real options, with no
 * lookup that settles it, which is the kind of work a model is for.
 *
 * Chunked rather than one call per item: a twenty-line receipt would be
 * twenty calls and a quota you'd notice. Five at a time means four calls,
 * and rows still land in visible waves rather than after one long wait.
 */
export async function matchReceiptLines(rows, { signal } = {}) {
  const { buildMatchPrompt, applyMatches } = await import('../features/receipts/matching.js');
  if (rows.length === 0) return [];

  const { prompt, schema } = buildMatchPrompt(rows);
  const text = await callGeminiJSON(prompt, schema, { maxOutputTokens: 2000, signal });
  return applyMatches(rows, text);
}
