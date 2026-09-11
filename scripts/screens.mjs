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
  '/src/features/inventory/addmenu.css',
  '/src/components/AmountEntry.css', '/src/components/FoodSearchInput.css',
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
const { ReceiptRow } = await load('/src/features/receipts/ReceiptScan.jsx');

const H = '00000000-0000-0000-0000-000000000000';
const wrap = (el) => React.createElement(InventoryProvider, { householdId: H }, el);

// A real shop, not lorem ipsum — the widths that matter are the ones real
// names produce.
const receiptRows = [
  ['Zucchini Green', 0.778, 'kg', 4.66, 'matched', 'Squash, zucchini, includes skin, raw'],
  ['Banana Cavendish', 0.442, 'kg', 1.32, 'matched', 'Bananas, raw'],
  ['Potatoes Brushed', 1.328, 'kg', 3.97, 'not_found', null],
  ['Broccoli', 0.808, 'kg', 4.84, 'matched', 'Broccoli, raw'],
  ['Brussel Sprouts', 0.322, 'kg', 5.15, 'matched', 'Brussels sprouts, raw'],
  ['Grapes Green', 1.174, 'kg', 7.03, 'not_found', null],
  ['Peas Snow', 0.218, 'kg', 3.27, 'not_found', null],
  ['Tomatoes Grape', 1, 'count', 2.99, 'not_found', null],
  ['Lettuce Iceberg', 1, 'count', 2.49, 'matched', 'Lettuce, iceberg, raw']
].map(([name, quantity, unit, price, matchStatus, food], i) => ({
  id: `r${i}`, rawName: name.toUpperCase(), name, quantity, unit, price,
  include: true, matchStatus,
  matchedFood: food ? { food_db_id: `usda:${i}`, name: food, macros_per_unit: {} } : null
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

const screens = {
  kitchen: kitchen('group'),
  'kitchen-macros': kitchen('macro'),
  sheet: wrap(React.createElement(ItemSheet, {
    item: stock.find((i) => i.name === 'Eggs'), onClose() {}
  })),
  add: wrap(React.createElement(AddMenu, { onClose() {}, onScanReceipt() {} })),
  intake: wrap(React.createElement(MacrosSummary)),
  receipt: React.createElement(
    'div', { className: 'card stack modal', style: { maxWidth: '48rem' } },
    React.createElement('div', { className: 'row', style: { justifyContent: 'space-between' } },
      React.createElement('h2', null, 'Scan a receipt'),
      React.createElement('button', { className: 'link-button' }, 'Close')),
    React.createElement('div', { className: 'receipt-rows' },
      receiptRows.map((row) =>
        React.createElement(ReceiptRow, { key: row.id, row, onChange() {} }))),
    React.createElement('div', { className: 'row receipt-footer' },
      React.createElement('label', { className: 'row receipt-destination' },
        React.createElement('span', { className: 'label muted' }, 'Put in'),
        React.createElement('select', { defaultValue: 'fridge' },
          React.createElement('option', { value: 'fridge' }, 'fridge'))),
      React.createElement('span', { className: 'label muted' }, '9 of 9'),
      React.createElement('button', { className: 'primary' }, 'Add to fridge'))
  )
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
    const page = await browser.newPage({ viewport: { width, height: 900 } });
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
