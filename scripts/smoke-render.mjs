/**
 * Server-renders every screen with realistic data.
 *
 * A Vite build only checks that modules resolve — it will happily ship
 * `UNITS_BY_DIMENSION[undefined].map(...)`, which throws at render time and
 * leaves a white page. This actually renders each component, so that class of
 * mistake fails here instead of in the browser.
 *
 * Run:  node scripts/smoke-render.mjs
 */
import './node-compat.mjs';
import 'fake-indexeddb/auto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { renderToString } from 'react-dom/server';
import React from 'react';

process.env.VITE_SUPABASE_URL ||= 'https://smoke.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ||= 'smoke-key';

const root = new URL('..', import.meta.url).pathname;
const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  plugins: [react()]
});

let failures = 0;
const check = (name, fn) => {
  try {
    const html = fn();
    if (!html || html.length < 10) throw new Error('rendered nothing');
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n        ${e.message}`);
  }
};

const load = (p) => server.ssrLoadModule(p);

const { InventoryProvider } = await load('/src/context/InventoryContext.jsx');
const ItemRow = (await load('/src/features/inventory/ItemRow.jsx')).default;
const ItemSheet = (await load('/src/features/inventory/ItemSheet.jsx')).default;
const AddMenu = (await load('/src/features/inventory/AddMenu.jsx')).default;
const CategoryRows = (await load('/src/features/inventory/CategoryRows.jsx')).default;
const { bucketize } = await load('/src/features/inventory/lenses.js');
const SignIn = (await load('/src/features/onboarding/SignIn.jsx')).default;
const HouseholdPicker = (await load('/src/features/onboarding/HouseholdPicker.jsx')).default;

const H = '00000000-0000-0000-0000-000000000000';
const wrap = (el) => React.createElement(InventoryProvider, { householdId: H }, el);

const { asItems } = await load('/src/dev/sampleFridge.js');
const stock = asItems(H);
const weightItem = stock.find((i) => i.base_unit === 'g');
const countItem = stock.find((i) => i.base_unit === 'count');
const emptyItem = { ...weightItem, id: 'i3', quantity: 0 };

check('sign-in screen', () => renderToString(React.createElement(SignIn)));
check('household picker — two households', () =>
  renderToString(React.createElement(HouseholdPicker, {
    households: [{ id: H, name: 'Apartment' }, { id: 'x', name: 'Family home' }],
    email: 'a@b.com', onPick() {}
  })));
check('household picker — not on any list', () =>
  renderToString(React.createElement(HouseholdPicker, {
    households: [], email: 'a@b.com', onPick() {}
  })));

for (const lens of ['group', 'macro', 'expiry']) {
  check(`group rows — ${lens} lens`, () =>
    renderToString(React.createElement(CategoryRows, {
      buckets: bucketize(stock.filter((i) => i.location === 'fridge'), lens),
      lens, onLensChange() {}, onPick() {}
    })));
}

check('food row — weighed', () => renderToString(React.createElement(ItemRow, { item: weightItem, onOpen() {} })));
check('food row — counted', () => renderToString(React.createElement(ItemRow, { item: countItem, onOpen() {} })));
check('food row — finished', () => renderToString(React.createElement(ItemRow, { item: emptyItem, onOpen() {} })));
check('food row — expired', () =>
  renderToString(React.createElement(ItemRow, { item: { ...weightItem, expiry_date: '2020-01-01' }, onOpen() {} })));

check('item sheet — counted', () => renderToString(wrap(React.createElement(ItemSheet, { item: countItem, onClose() {} }))));
check('item sheet — weighed', () => renderToString(wrap(React.createElement(ItemSheet, { item: weightItem, onClose() {} }))));
check('item sheet — finished', () => renderToString(wrap(React.createElement(ItemSheet, { item: emptyItem, onClose() {} }))));

check('add menu', () => renderToString(wrap(React.createElement(AddMenu, { onClose() {}, onScanReceipt() {} }))));

const MacrosSummary = (await load('/src/features/macros/MacrosSummary.jsx')).default;
check('macros summary', () => renderToString(wrap(React.createElement(MacrosSummary))));

const RecipeSuggestions = (await load('/src/features/recipes/RecipeSuggestions.jsx')).default;
check('recipe suggestions (idle)', () => renderToString(wrap(React.createElement(RecipeSuggestions))));

const ReceiptScan = (await load('/src/features/receipts/ReceiptScan.jsx')).default;
const ReceiptReview = (await load('/src/features/receipts/ReceiptReview.jsx')).default;
const { ItemCard } = await load('/src/features/receipts/ReceiptReview.jsx');
const FoodSearchSheet = (await load('/src/components/FoodSearchSheet.jsx')).default;
check('receipt scan (idle)', () => renderToString(wrap(React.createElement(ReceiptScan, { onClose() {} }))));

const receiptRow = {
  id: 'r1', rawName: 'GOODGATH JASMINE RICE 5LB', name: 'Jasmine Rice',
  query: 'Good & Gather jasmine rice', brand: 'Good & Gather', retailer: 'Target',
  quantity: 1, unit: 'pack', price: 6.49, include: true, decided: false,
  state: 'done', candidates: [], review: {},
  matchedFood: {
    food_db_id: 'usda:1', name: 'Jasmine Rice', brand: 'Good & Gather',
    package_text: '5 lb', package_grams: 2267.96, serving_text: '0.25 cup', serving_grams: 45,
    macros_per_unit: { basis: 'per_100g', calories: 360, protein_g: 7.1, carbs_g: 79, fat_g: 0.6 }
  }
};

check('item card — high confidence', () =>
  renderToString(React.createElement(ItemCard, { row: receiptRow, onEdit() {} })));
check('item card — check product', () =>
  renderToString(React.createElement(ItemCard, { row: { ...receiptRow, review: { match: true } }, onEdit() {} })));
check('item card — check quantity', () =>
  renderToString(React.createElement(ItemCard, { row: { ...receiptRow, review: { quantity: true } }, onEdit() {} })));
check('item card — unidentified', () =>
  renderToString(React.createElement(ItemCard, {
    row: { ...receiptRow, matchedFood: null, review: { name: true, match: true, quantity: true } }, onEdit() {}
  })));
check('item card — still working', () =>
  renderToString(React.createElement(ItemCard, { row: { ...receiptRow, state: 'searching', matchedFood: null }, onEdit() {} })));
check('item card — weighed line, no product', () =>
  renderToString(React.createElement(ItemCard, {
    row: { ...receiptRow, unit: 'kg', quantity: 0.778, matchedFood: null, brand: null, review: { match: true } }, onEdit() {}
  })));

check('receipt review — queue and card', () =>
  renderToString(React.createElement(ReceiptReview, {
    rows: [receiptRow, { ...receiptRow, id: 'r2', name: 'Bananas', decided: true }],
    onChange() {}, onSave() {}, onClose() {},
    location: 'pantry', onLocationChange() {}, saving: false, note: '', error: ''
  })));
check('receipt review — everything decided', () =>
  renderToString(React.createElement(ReceiptReview, {
    rows: [{ ...receiptRow, decided: true }],
    onChange() {}, onSave() {}, onClose() {},
    location: 'pantry', onLocationChange() {}, saving: false, note: '', error: ''
  })));
// An empty receipt renders nothing rather than an empty frame. The point of
// this check is that it does that instead of throwing.
check('receipt review — no rows renders nothing, quietly', () => {
  const html = renderToString(React.createElement(ReceiptReview, {
    rows: [], onChange() {}, onSave() {}, onClose() {},
    location: 'fridge', onLocationChange() {}, saving: false, note: '', error: ''
  }));
  if (html !== '') throw new Error(`expected nothing, got ${html.slice(0, 40)}`);
  return 'rendered nothing, as intended';
});

check('food search sheet', () =>
  renderToString(React.createElement(FoodSearchSheet, { onPick() {}, onClose() {} })));

const Settings = (await load('/src/components/Settings.jsx')).default;
check('settings panel', () =>
  renderToString(wrap(React.createElement(Settings, {
    email: 'a@b.com', households: [{ id: H, name: 'Apartment' }], householdId: H,
    onSwitch() {}, onClose() {}
  }))));

// esbuild logs "The build was canceled" when Vite's dev server is torn down
// while a transform is still in flight. It is teardown noise, not a failure,
// and printing it under thirty PASS lines makes a green run look broken.
await server.close().catch(() => {});
console.log(`\n${failures ? `${failures} screen(s) failed to render` : 'all screens rendered'}`);
process.exit(failures ? 1 : 0);
