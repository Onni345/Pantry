/**
 * Recipe suggestions: prompt building and response validation.
 *
 * Pure — no fetch, no Dexie, no React. `suggestRecipes` (in ../../api/llm.js
 * caller below) does the network call; this module decides what to ask and
 * whether to trust what comes back.
 */

/** Only weighed items with something left can go into a recipe. */
export function eligibleItems(items) {
  return items.filter((i) => i.base_unit === 'g' && i.quantity > 0);
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          uses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                item: { type: 'string' },
                grams: { type: 'number' }
              },
              required: ['item', 'grams']
            }
          },
          extra_ingredients: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string' }
        },
        required: ['name', 'uses', 'instructions']
      }
    }
  },
  required: ['recipes']
};

export function buildPrompt(items) {
  const stock = items.map((i) => `- ${i.name}: ${Math.round(i.quantity)} g (${i.location})`).join('\n');

  return {
    schema: RESPONSE_SCHEMA,
    prompt: `Suggest up to 5 recipes using mainly what is in stock below. Prefer recipes
that use more of the stock, and that use items closer to running out.

Stock (grams currently on hand):
${stock}

For each recipe: which stocked items it uses and roughly how many grams of
each (do not exceed what is in stock), a short list of common pantry staples
it also needs that are NOT in the stock list above (salt, oil, water, and
similar — keep this short), and brief instructions as plain text.

Reply as JSON matching the given schema. Use exact item names from the stock
list above in "item" fields — do not invent or rename items.`
  };
}

/**
 * Validates and grounds the model's answer against the real inventory.
 *
 * A recipe is only as trustworthy as its ingredients are real: an invented
 * item name is worse than no suggestion, because it would send someone
 * looking for something that isn't there. So every "uses" entry is matched
 * against the stock list by name; entries that don't match are dropped, and
 * a recipe left with no real ingredients is dropped entirely rather than
 * shown as if it were grounded in what's on hand.
 */
export function parseRecipes(raw, items) {
  let data = raw;
  if (typeof raw === 'string') {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in the response.');
    data = JSON.parse(match[0]);
  }
  if (!data || !Array.isArray(data.recipes)) {
    throw new Error('Response had no recipes array.');
  }

  const byName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));
  const seen = new Set();
  const out = [];

  for (const r of data.recipes) {
    const name = String(r?.name || '').trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue; // duplicate suggestion, keep the first

    const uses = [];
    for (const u of Array.isArray(r.uses) ? r.uses : []) {
      const item = byName.get(String(u?.item || '').trim().toLowerCase());
      const grams = Number(u?.grams);
      // item.quantity <= 0 matters here, not just grams > 0: a citation of
      // something with nothing left in stock is not grounded in anything
      // real, whatever number the model attached to it.
      if (!item || !Number.isFinite(grams) || grams <= 0 || item.quantity <= 0) continue;
      // The model is not trusted to respect the stock it was given — clamp
      // rather than reject, since "use all of it" is still a valid recipe.
      uses.push({ item: item.name, grams: Math.min(grams, item.quantity), stocked: item.quantity });
    }
    if (uses.length === 0) continue; // not grounded in anything real — drop it

    const extra = Array.isArray(r.extra_ingredients)
      ? r.extra_ingredients.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
      : [];

    const instructions = String(r.instructions || '').trim();
    if (!instructions) continue;

    seen.add(key);
    out.push({ name, uses, extra, instructions });
    if (out.length >= 5) break;
  }

  return out;
}
