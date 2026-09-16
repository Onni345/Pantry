/**
 * Grouping food the way people think about it.
 *
 * There used to be three lenses here — food group, dominant macro, and use-by
 * date — and a switcher to move between them. Two of the three answered
 * questions nobody stood at the fridge asking, so they went; the rows below
 * the header are simply food groups now.
 *
 * Pure — no React, no Dexie.
 */

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

const BUCKET = { of: (i) => GROUP_OF[i.category] || 'Other', order: GROUP_ORDER };

/** CSS custom-property name carrying this bucket's colour. */
const toneVar = (bucket) => `--tone-${bucket.toLowerCase().replace(/[^a-z]+/g, '-')}`;

/**
 * Items bucketed by food group, in a fixed order, with a
 * `presence` figure for sizing the canvas.
 *
 * Presence is the number of *items*, deliberately not their grams or
 * calories. Two gallons of milk should not dwarf eight eggs — the canvas
 * answers "what kind of stuff is in here", not "what weighs the most". Rare
 * things stay visible; nothing computes a percentage it can't defend.
 */
export function bucketize(items) {
  const lens = BUCKET;
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
