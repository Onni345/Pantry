/**
 * Cheap keyword guess so a category field is usually already right before
 * the user touches it. Pure — no React, no Dexie.
 *
 * Shared by the manual add form and receipt-scan staging, so the guess is
 * defined once rather than drifting between two copies.
 */
const RULES = [
  ['dairy', /milk|cheese|yogurt|yoghurt|butter|cream|kefir/],
  ['produce', /apple|banana|lettuce|spinach|tomato|onion|potato|carrot|pepper|berry|berries|orange|grape|broccoli|cucumber/],
  ['meat', /chicken|beef|pork|turkey|lamb|bacon|sausage|ham/],
  ['seafood', /salmon|tuna|shrimp|cod|tilapia|fish|crab/],
  ['grain', /bread|rice|pasta|oat|cereal|flour|tortilla|quinoa|noodle/],
  ['beverage', /juice|soda|coffee|tea|water|beer|wine/],
  ['condiment', /sauce|ketchup|mustard|mayo|dressing|vinegar|syrup/],
  ['snack', /chip|cracker|cookie|candy|chocolate|granola bar/],
  ['canned', /canned|can of|tinned/],
  ['frozen', /frozen/]
];

export function guessCategory(name) {
  const n = String(name).toLowerCase();
  for (const [cat, re] of RULES) if (re.test(n)) return cat;
  return null;
}
