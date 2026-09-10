/**
 * Checks the food lookup against the live APIs, using the same nutrient
 * extraction the app uses. Run:  node scripts/food-lookup-probe.mjs [query]
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const KEY = env.VITE_USDA_API_KEY;
if (!KEY) { console.error('VITE_USDA_API_KEY missing from .env'); process.exit(1); }

const N = { ENERGY_KCAL: 1008, PROTEIN: 1003, FAT: 1004, CARBS: 1005 };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function usdaNutrient(food, id) {
  for (const n of food.foodNutrients || []) {
    const nid = n.nutrientId ?? n.nutrient?.id;
    if (nid === id) return num(n.value ?? n.amount);
  }
  return null;
}

const { DATASET_RANK, titleCase, isPlausible, dedupe, rankSort } =
  await import(new URL('../src/api/foodQuality.js', import.meta.url));

const query = process.argv[2] || 'whole milk';
let failures = 0;
const check = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `   (${detail})`}`);
};

console.log(`\n=== USDA: "${query}" ===`);
const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(KEY)}` +
  `&query=${encodeURIComponent(query)}&pageSize=40` +
  `&dataType=${encodeURIComponent('Foundation,SR Legacy,Branded')}`;

const res = await fetch(url);
check('USDA key accepted', res.ok, `HTTP ${res.status} ${res.statusText}`);
if (!res.ok) {
  console.log((await res.text().catch(() => '')).slice(0, 400));
  process.exit(1);
}
const data = await res.json();
check('response has a foods array', Array.isArray(data.foods), Object.keys(data).join(','));
check('at least one result', (data.foods || []).length > 0, `${(data.foods || []).length} results`);

const mapped = (data.foods || []).map((f) => {
  const dataType = f.dataType || '';
  const brand = f.brandName || f.brandOwner || '';
  const desc = dataType === 'Branded' ? titleCase(f.description) : f.description;
  return {
    name: [desc, brand && titleCase(brand)].filter(Boolean).join(' \u2014 '),
    dataType,
    rank: DATASET_RANK[dataType] ?? 4,
    macros_per_unit: {
      basis: 'per_100g',
      calories: usdaNutrient(f, N.ENERGY_KCAL),
      protein_g: usdaNutrient(f, N.PROTEIN),
      carbs_g: usdaNutrient(f, N.CARBS),
      fat_g: usdaNutrient(f, N.FAT)
    }
  };
});

const withMacros = mapped.filter((r) =>
  Object.entries(r.macros_per_unit).some(([k, v]) => k !== 'basis' && v != null && v !== 0)
).length;
check('nutrient ids parse into macros', withMacros > 0, `${withMacros}/${mapped.length} had macros`);

const kept = mapped.filter(isPlausible);
const dropped = mapped.length - kept.length;
const final = rankSort(dedupe(kept)).slice(0, 8);

console.log(`\n  raw ${mapped.length} -> implausible dropped ${dropped} -> deduped ${kept.length - dedupe(kept).length} -> showing ${final.length}\n`);
for (const r of final) {
  const m = r.macros_per_unit;
  console.log(`  ${r.dataType.padEnd(14)} ${r.name.slice(0, 46).padEnd(48)} ` +
    `kcal=${m.calories ?? '-'} p=${m.protein_g ?? '-'} c=${m.carbs_g ?? '-'} f=${m.fat_g ?? '-'}`);
}
// Same name + same macros is a duplicate; same name + different macros is a
// different product that happens to share a label.
const idKey = (r) => `${r.name.toLowerCase()}|${r.macros_per_unit.calories}|${r.macros_per_unit.protein_g}`;
check('exact duplicates collapsed', new Set(final.map(idKey)).size === final.length,
  'identical name+macros rows still present');
check('curated data ranks above branded when present',
  final.length < 2 || final[0].rank <= final[final.length - 1].rank,
  final.map((r) => r.rank).join(','));

console.log(`\n=== Open Food Facts fallback: "${query}" ===`);
try {
  const offRes = await fetch(
    `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(query)}` +
    `&fields=code,product_name,brands,nutriments&page_size=3`
  );
  check('OFF reachable', offRes.ok, `HTTP ${offRes.status}`);
  if (offRes.ok) {
    const off = await offRes.json();
    check('OFF has a products array', Array.isArray(off.products), Object.keys(off).join(','));
    for (const p of (off.products || []).slice(0, 3)) {
      const n = p.nutriments || {};
      console.log(`  ${String(p.product_name || p.code).slice(0, 50).padEnd(52)} ` +
        `kcal=${n['energy-kcal_100g'] ?? '-'} p=${n.proteins_100g ?? '-'} ` +
        `c=${n.carbohydrates_100g ?? '-'} f=${n.fat_100g ?? '-'}`);
    }
  }
} catch (e) {
  check('OFF reachable', false, e.message);
}

console.log(`\n${failures ? `${failures} check(s) failed` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
