/**
 * Lenses: the same food, grouped three ways.
 *
 * The canvas and the list below it are one UI primitive seen through a
 * different lens — not three dashboards. A lens says which bucket an item
 * falls into, what that bucket is called, and what colour it wears.
 *
 * Pure — no React, no Dexie.
 */

export const LENSES = [
  { key: 'group', label: 'Food group' },
  { key: 'macro', label: 'Macros' },
  { key: 'expiry', label: 'Use by' }
];

/** The app's storage categories, folded into the groups people actually think in. */
const GROUP_OF = {
  produce: 'Produce',
  dairy: 'Dairy',
  meat: 'Protein',
  seafood: 'Protein',
  eggs: 'Protein',
  grain: 'Grains',
  canned: 'Pantry staples',
  condiment: 'Pantry staples',
  frozen: 'Frozen',
  snack: 'Snacks',
  beverage: 'Drinks',
  other: 'Other'
};

const GROUP_ORDER = [
  'Protein', 'Produce', 'Dairy', 'Grains', 'Frozen', 'Pantry staples', 'Snacks', 'Drinks', 'Other'
];

/**
 * Which macro an item mostly is, by whichever of the three contributes most
 * of its calories. Items with no macro data sit in their own bucket rather
 * than being guessed into one — the app would rather say "unknown" than
 * invent a number (see principle: missing information is acceptable).
 */
function macroOf(item) {
  const m = item.macros;
  if (!m) return 'Unknown';
  const cals = { Protein: (m.protein_g ?? 0) * 4, Carbs: (m.carbs_g ?? 0) * 4, Fat: (m.fat_g ?? 0) * 9 };
  const total = cals.Protein + cals.Carbs + cals.Fat;
  if (total <= 0) return 'Unknown';
  return Object.entries(cals).sort((a, b) => b[1] - a[1])[0][0];
}

const MACRO_ORDER = ['Protein', 'Carbs', 'Fat', 'Unknown'];

function expiryOf(item) {
  if (!item.expiry_date) return 'No date';
  const days = Math.round((Date.parse(item.expiry_date) - Date.now()) / 86400000);
  if (days < 0) return 'Past date';
  if (days <= 3) return 'Use now';
  if (days <= 10) return 'This week';
  return 'Keeps';
}

const EXPIRY_ORDER = ['Past date', 'Use now', 'This week', 'Keeps', 'No date'];

const BUCKETS = {
  group: { of: (i) => GROUP_OF[i.category] || 'Other', order: GROUP_ORDER },
  macro: { of: macroOf, order: MACRO_ORDER },
  expiry: { of: expiryOf, order: EXPIRY_ORDER }
};

/** CSS custom-property name carrying this bucket's colour. */
export const toneVar = (bucket) => `--tone-${bucket.toLowerCase().replace(/[^a-z]+/g, '-')}`;

/**
 * Items bucketed by the given lens, in the lens's own order, with a
 * `presence` figure for sizing the canvas.
 *
 * Presence is the number of *items*, deliberately not their grams or
 * calories. Two gallons of milk should not dwarf eight eggs — the canvas
 * answers "what kind of stuff is in here", not "what weighs the most". Rare
 * things stay visible; nothing computes a percentage it can't defend.
 */
export function bucketize(items, lensKey) {
  const lens = BUCKETS[lensKey] || BUCKETS.group;
  const found = new Map();

  for (const item of items) {
    const name = lens.of(item);
    if (!found.has(name)) found.set(name, []);
    found.get(name).push(item);
  }

  const ordered = [...found.keys()].sort((a, b) => {
    const ai = lens.order.indexOf(a);
    const bi = lens.order.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
  });

  return ordered.map((name) => ({
    name,
    items: found.get(name),
    presence: found.get(name).length,
    tone: toneVar(name)
  }));
}
