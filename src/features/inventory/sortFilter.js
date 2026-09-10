/**
 * Pure sort/filter logic for the inventory list. No React, no Dexie — so it
 * can be tested directly.
 */

export const SORTS = [
  { key: 'recent', label: 'Recently added' },
  { key: 'name', label: 'Name' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'location', label: 'Location' },
  { key: 'category', label: 'Category' },
  { key: 'expiry', label: 'Expiring first' },
  { key: 'protein', label: 'Most protein' }
];

export const defaultView = {
  sort: 'recent',
  location: 'all',
  category: 'all',
  search: '',
  hideEmpty: false
};

/** Nulls always sort last, whichever direction the column runs. */
function nullsLast(a, b, cmp) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return cmp(a, b);
}

const byText = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });

const comparators = {
  recent: (a, b) => byText(b.created_at, a.created_at),
  name: (a, b) => byText(a.name, b.name),
  quantity: (a, b) => b.quantity - a.quantity,
  location: (a, b) => byText(a.location, b.location) || byText(a.name, b.name),
  category: (a, b) => byText(a.category, b.category) || byText(a.name, b.name),
  expiry: (a, b) => nullsLast(a.expiry_date, b.expiry_date, byText),
  protein: (a, b) =>
    nullsLast(a.macros?.protein_g ?? null, b.macros?.protein_g ?? null, (x, y) => y - x)
};

export function applyView(items, view) {
  const v = { ...defaultView, ...view };
  const needle = v.search.trim().toLowerCase();

  const filtered = items.filter((i) => {
    if (v.location !== 'all' && i.location !== v.location) return false;
    if (v.category !== 'all' && i.category !== v.category) return false;
    if (v.hideEmpty && i.quantity === 0) return false;
    if (needle && !String(i.name).toLowerCase().includes(needle)) return false;
    return true;
  });

  const cmp = comparators[v.sort] || comparators.recent;
  // Stable tiebreak so equal keys don't reshuffle between renders.
  return [...filtered].sort((a, b) => cmp(a, b) || byText(a.id, b.id));
}

/** Only offer filter values that actually appear in this household's items. */
export function presentValues(items, field) {
  return [...new Set(items.map((i) => i[field]).filter(Boolean))].sort();
}
