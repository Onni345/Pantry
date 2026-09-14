/**
 * Renders each screen to a real PNG at phone and laptop widths.
 *
 * `npm run smoke` proves a screen doesn't crash. This proves it doesn't look
 * broken — the layout bugs that actually get reported (a field wrapping, a
 * column not lining up, something unreadable on a phone) are invisible to a
 * render test and obvious in a picture.
 *
 * Run:  node scripts/screens.mjs   ->  screens/*.png
 */
import 'fake-indexeddb/auto';
import { createServer } from 'vite';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

process.env.VITE_SUPABASE_URL ||= 'https://screens.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ||= 'screens-key';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}screens`;
await mkdir(out, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true } });
const load = (p) => server.ssrLoadModule(p);

const css = [
  '/src/styles/variables.css', '/src/app.css',
  '/src/features/inventory/inventory.css', '/src/features/macros/macros.css',
  '/src/features/receipts/receipts.css', '/src/features/recipes/recipes.css',
  '/src/features/inventory/groups.css', '/src/features/inventory/sheet.css',
  '/src/features/inventory/addmenu.css', '/src/features/receipts/review.css',
  '/src/components/AmountEntry.css', '/src/components/FoodSearchInput.css',
  '/src/components/FoodSearchSheet.css',
  '/src/features/onboarding/onboarding.css'
];
const styles = (await Promise.all(
  css.map((f) => readFile(root + f.slice(1), 'utf8').catch(() => ''))
)).join('\n');

const { InventoryProvider } = await load('/src/context/InventoryContext.jsx');
const ItemRow = (await load('/src/features/inventory/ItemRow.jsx')).default;
const ItemSheet = (await load('/src/features/inventory/ItemSheet.jsx')).default;
const AddMenu = (await load('/src/features/inventory/AddMenu.jsx')).default;
const CategoryRows = (await load('/src/features/inventory/CategoryRows.jsx')).default;
const { bucketize } = await load('/src/features/inventory/lenses.js');
const MacrosSummary = (await load('/src/features/macros/MacrosSummary.jsx')).default;
const Settings = (await load('/src/components/Settings.jsx')).default;
const ReceiptReview = (await load('/src/features/receipts/ReceiptReview.jsx')).default;
const FoodSearchSheet = (await load('/src/components/FoodSearchSheet.jsx')).default;
const { SearchResults, groupResults } = await load('/src/components/FoodSearchSheet.jsx');

const H = '00000000-0000-0000-0000-000000000000';
const wrap = (el) => React.createElement(InventoryProvider, { householdId: H }, el);

// A real Target shop, mid-review: some lines settled, one still resolving,
// one the resolver could not place at all. The screenshot has to show what
// the queue looks like while it is being worked through, not only when it is
// finished.
// [receipt text, name, qty, unit, price, state, food, review, decided]
const FOODS = {
  rice: {
    food_db_id: 'usda:1', name: 'Jasmine Rice', brand: 'Good & Gather',
    package_text: '5 lb', package_grams: 2267.96, serving_text: '0.25 cup', serving_grams: 45,
    macros_per_unit: { basis: 'per_100g', calories: 360, protein_g: 7.1, carbs_g: 79, fat_g: 0.6 }
  },
  yogurt: {
    food_db_id: 'usda:2', name: 'Triple Zero Greek Yogurt', brand: 'Oikos',
    package_text: '5.3 oz', package_grams: 150, serving_text: '1 container', serving_grams: 150,
    macros_per_unit: { basis: 'per_100g', calories: 63, protein_g: 10, carbs_g: 5.3, fat_g: 0 }
  },
  zucchini: {
    food_db_id: 'usda:3', name: 'Squash, zucchini, includes skin, raw',
    macros_per_unit: { basis: 'per_100g', calories: 17, protein_g: 1.2, carbs_g: 3.1, fat_g: 0.3 }
  },
  grapes: {
    food_db_id: 'usda:4', name: 'Grapes, red or green, raw',
    macros_per_unit: { basis: 'per_100g', calories: 69, protein_g: 0.7, carbs_g: 18, fat_g: 0.2 }
  },
  cheese: {
    food_db_id: 'usda:5', name: 'Sliced Sharp Cheddar', brand: 'Good & Gather',
    package_text: '8 oz', package_grams: 226.8, serving_text: '1 slice', serving_grams: 21,
    macros_per_unit: { basis: 'per_100g', calories: 404, protein_g: 23, carbs_g: 3.1, fat_g: 33 }
  }
};

const receiptRows = [
  ['GOODGATH JASMINE RICE 5LB', 'Jasmine Rice', 1, 'pack', 6.49, 'done', FOODS.rice, {}, false],
  ['2 X OIKOS GREEK YOGURT', 'Oikos Greek Yogurt', 2, 'container', 2.58, 'done', FOODS.yogurt, {}, true],
  ['ZUCCHINI GREEN', 'Zucchini', 0.778, 'kg', 4.66, 'done', FOODS.zucchini, {}, true],
  ['GOODGATH SHRP CHDR SLCD', 'Sharp Cheddar Sliced', 1, 'pack', 3.99, 'done', FOODS.cheese, {}, true],
  ['GRAPES GREEN', 'Grapes Green', 1.174, 'kg', 7.03, 'done', FOODS.grapes, { quantity: true }, true],
  ['SPECIAL ITEM 18492', 'Item 18492', 1, 'item', 0.99, 'done', null, { name: true, match: true, quantity: true }, false],
  ['BANANA CAVENDISH', 'Banana Cavendish', 0.442, 'kg', 1.32, 'deciding', null, {}, false]
].map(([rawName, name, quantity, unit, price, state, food, review, decided], i) => ({
  id: `r${i}`, rawName, name, quantity, unit, price, state, review, decided,
  query: name.toLowerCase(), brand: rawName.startsWith('GOODGATH') ? 'Good & Gather' : null,
  retailer: 'Target', include: true, candidates: [], matchedFood: food
}));

// SSR can't reach Dexie, so the inventory screen is assembled from real
// ItemCards over the sample kitchen — the same table the in-app fixture and
// the SQL seed use, so a screenshot can't show a fridge the app wouldn't.
const { asItems } = await load('/src/dev/sampleFridge.js');
const stock = asItems(H);

const fridge = stock.filter((i) => i.location === 'fridge');
const shelfSection = (bucket) =>
  React.createElement('section', { key: bucket.name, className: 'bucket' },
    React.createElement('h3', { className: 'bucket-head' },
      React.createElement('span', { className: 'bucket-dot', style: { background: `var(${bucket.tone}, var(--tone-other))` } }),
      bucket.name,
      React.createElement('span', { className: 'bucket-count label' }, bucket.items.length)),
    React.createElement('ul', { className: 'item-list' },
      bucket.items.map((item) =>
        React.createElement(ItemRow, { key: item.id, item, onOpen() {} }))));

const kitchen = (lens) => wrap(React.createElement('div', { className: 'stack' },
  React.createElement('header', { className: 'app-header' },
    React.createElement('div', null,
      React.createElement('span', { className: 'wordmark' }, 'Pantry'),
      React.createElement('h1', null, 'Seattle Apartment')),
    React.createElement('div', { className: 'row' },
      React.createElement('span', { className: 'label muted' }, 'Synced'),
      React.createElement('button', { className: 'link-button' }, 'Settings'))),
  React.createElement('nav', { className: 'tabs row' },
    React.createElement('button', { className: 'is-current' }, 'Kitchen'),
    React.createElement('button', null, 'Intake'),
    React.createElement('button', null, 'Recipes')),
  React.createElement('div', { className: 'stack kitchen' },
    React.createElement('header', { className: 'place-head' },
      React.createElement('button', { className: 'place-arrow' }, '\u2039'),
      React.createElement('h2', { className: 'place-name' }, 'fridge',
        React.createElement('span', { className: 'place-count' }, fridge.length)),
      React.createElement('button', { className: 'place-arrow' }, '\u203a')),
    React.createElement('div', { className: 'place-dots' },
      ['fridge', 'freezer', 'pantry'].map((l, i) =>
        React.createElement('button', { key: l, className: `place-dot${i === 0 ? ' is-current' : ''}` }))),
    React.createElement(CategoryRows, {
      buckets: bucketize(fridge, lens), lens, onLensChange() {}, onPick() {}
    }),
    React.createElement('div', { className: 'stack food-list' },
      React.createElement('h2', { className: 'food-list-head' }, 'Your food'),
      ...bucketize(fridge, lens).map(shelfSection)))
));

const searchFixture = [
  { food_db_id: 'c1', name: 'Jasmine Rice', brand: 'Good & Gather', cached_at: '2026-09-01',
    detail: 'Branded', macros_per_unit: { calories: 360, protein_g: 7.1, carbs_g: 79, fat_g: 0.6 } },
  { food_db_id: 'b1', name: 'Jasmine Rice, Long Grain, 5 Lb Bag', brand: 'Good & Gather',
    detail: 'Branded', macros_per_unit: { calories: 360, protein_g: 7.1, carbs_g: 79, fat_g: 0.6 } },
  { food_db_id: 'b2', name: 'Kirkland Signature Jasmine Rice', brand: 'Kirkland Signature',
    detail: 'Branded', macros_per_unit: { calories: 350, protein_g: 7, carbs_g: 77, fat_g: 0.5 } },
  { food_db_id: 'b3', name: 'Organic Thai Hom Mali Jasmine Rice', brand: "Trader Joe's",
    detail: 'Open Food Facts', source: 'off',
    macros_per_unit: { calories: 355, protein_g: 6.5, carbs_g: 78, fat_g: 1 } },
  { food_db_id: 'g1', name: 'Rice, white, long-grain, regular, raw, unenriched',
    detail: 'USDA Foundation', dataset: 'Foundation',
    macros_per_unit: { calories: 365, protein_g: 7.1, carbs_g: 80, fat_g: 0.7 } },
  { food_db_id: 'g2', name: 'Rice, white, long-grain, regular, cooked, unenriched, without salt',
    detail: 'USDA SR Legacy', dataset: 'SR Legacy',
    macros_per_unit: { calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 } }
];

const screens = {
  kitchen: kitchen('group'),
  'kitchen-macros': kitchen('macro'),
  sheet: wrap(React.createElement(ItemSheet, {
    item: stock.find((i) => i.name === 'Eggs'), onClose() {}
  })),
  add: wrap(React.createElement(AddMenu, { onClose() {}, onScanReceipt() {} })),
  intake: wrap(React.createElement(MacrosSummary)),
  receipt: React.createElement(ReceiptReview, {
    rows: receiptRows, onChange() {}, onSave() {}, onClose() {},
    location: 'pantry', onLocationChange() {}, saving: false, note: '', error: ''
  }),
  'receipt-done': React.createElement(ReceiptReview, {
    rows: receiptRows.map((r) => ({ ...r, decided: true, include: r.name !== 'Item 18492' })),
    onChange() {}, onSave() {}, onClose() {},
    location: 'pantry', onLocationChange() {}, saving: false, note: '', error: ''
  }),
  // The card that matters most: the one the resolver could not place. It has
  // to look like an honest "I don't know", not like an error.
  'receipt-unsure': React.createElement(ReceiptReview, {
    rows: [receiptRows.find((r) => r.matchedFood === null && r.state === 'done'),
           ...receiptRows.filter((r) => !(r.matchedFood === null && r.state === 'done'))],
    onChange() {}, onSave() {}, onClose() {},
    location: 'pantry', onLocationChange() {}, saving: false, note: '', error: ''
  }),
  // SSR can't fetch, so the populated list is rendered from fixture rows that
  // match the real result shape — including the awkward ones: a long branded
  // description, a row with no photo, a generic entry with no brand at all.
  search: React.createElement('div', { className: 'sheet-backdrop' },
    React.createElement('div', { className: 'sheet search-sheet' },
      React.createElement('div', { className: 'sheet-grip' }),
      React.createElement('div', { className: 'sheet-head' },
        React.createElement('h2', null, 'Find product'),
        React.createElement('button', { className: 'link-button' }, 'Close')),
      React.createElement('input', {
        className: 'search-field', readOnly: true, defaultValue: 'jasmine rice'
      }),
      React.createElement(SearchResults, {
        sections: groupResults(searchFixture),
        flat: searchFixture, active: 0, onHover() {}, onPick() {}
      })))
};

// The sandbox ships Chromium at a fixed path rather than in Playwright's
// own cache, so point at it instead of downloading one.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox']
});
const sizes = { phone: 390, laptop: 1000 };

for (const [name, el] of Object.entries(screens)) {
  const body = renderToString(el);
  for (const [size, width] of Object.entries(sizes)) {
    // Animations are captured mid-flight otherwise, which makes a healthy
    // card look washed out. The CSS already honours this preference.
    const page = await browser.newPage({
      viewport: { width, height: 900 }, reducedMotion: 'reduce'
    });
    await page.setContent(
      `<style>${styles}</style><body style="background:var(--bg)">
       <div class="shell stack">${body}</div></body>`,
      { waitUntil: 'load' }
    );
    const file = `${out}/${name}-${size}.png`;
    await page.screenshot({ path: file, fullPage: true });
    await page.close();
    console.log(`  ${file.replace(root, '')}`);
  }
}

await browser.close();
await server.close();
process.exit(0);
