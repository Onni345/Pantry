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
const AmountEntry = (await load('/src/components/AmountEntry.jsx')).default;
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
    households: [{ id: H, label: 'Apartment' }, { id: 'x', label: 'Family home' }],
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

check('amount entry — weight item', () =>
  renderToString(React.createElement(AmountEntry, { item: weightItem, direction: 'remove', onSubmit() {}, onCancel() {} })));
check('amount entry — counted item', () =>
  renderToString(React.createElement(AmountEntry, { item: countItem, direction: 'add', onSubmit() {}, onCancel() {} })));

const MacrosSummary = (await load('/src/features/macros/MacrosSummary.jsx')).default;
check('macros summary', () => renderToString(wrap(React.createElement(MacrosSummary))));

const RecipeSuggestions = (await load('/src/features/recipes/RecipeSuggestions.jsx')).default;
check('recipe suggestions (idle)', () => renderToString(wrap(React.createElement(RecipeSuggestions))));

const receiptScanModule = await load('/src/features/receipts/ReceiptScan.jsx');
const ReceiptScan = receiptScanModule.default;
const { ReceiptRow } = receiptScanModule;
check('receipt scan (idle)', () => renderToString(wrap(React.createElement(ReceiptScan, { onClose() {} }))));
const receiptRow = {
  id: 'r1', rawName: 'GRAPES GREEN', name: 'Grapes Green', quantity: 1.174, unit: 'kg',
  price: 7.03, include: true, matchStatus: 'matched',
  matchedFood: { food_db_id: 'usda:1', name: 'Grapes, green', macros_per_unit: {} }
};
check('receipt row — matched', () => renderToString(React.createElement(ReceiptRow, { row: receiptRow, onChange() {} })));
check('receipt row — not found', () =>
  renderToString(React.createElement(ReceiptRow, { row: { ...receiptRow, matchStatus: 'not_found', matchedFood: null }, onChange() {} })));

const Settings = (await load('/src/components/Settings.jsx')).default;
check('settings panel', () =>
  renderToString(wrap(React.createElement(Settings, {
    email: 'a@b.com', households: [{ id: H, label: 'Apartment' }], householdId: H,
    onSwitch() {}, onClose() {}
  }))));

await server.close();
console.log(`\n${failures ? `${failures} screen(s) failed to render` : 'all screens rendered'}`);
process.exit(failures ? 1 : 0);
