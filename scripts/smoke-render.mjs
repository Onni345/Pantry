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
const AddItemForm = (await load('/src/features/inventory/AddItemForm.jsx')).default;
const ItemCard = (await load('/src/features/inventory/ItemCard.jsx')).default;
const AmountEntry = (await load('/src/components/AmountEntry.jsx')).default;
const InventoryControls = (await load('/src/features/inventory/InventoryControls.jsx')).default;
const SignIn = (await load('/src/features/onboarding/SignIn.jsx')).default;
const HouseholdPicker = (await load('/src/features/onboarding/HouseholdPicker.jsx')).default;
const { SORTS, defaultView } = await load('/src/features/inventory/sortFilter.js');

const H = '00000000-0000-0000-0000-000000000000';
const wrap = (el) => React.createElement(InventoryProvider, { householdId: H }, el);

const weightItem = {
  id: 'i1', household_id: H, name: 'Oranges, raw, Florida', category: 'produce',
  location: 'fridge', base_unit: 'g', display_unit: 'kg', quantity: 1200,
  expiry_date: null, macros: { protein_g: 0.7 }, deleted: 0, created_at: '2026-01-01'
};
const countItem = { ...weightItem, id: 'i2', name: 'Eggs', base_unit: 'count', display_unit: 'dozen', quantity: 12, macros: null };
const emptyItem = { ...weightItem, id: 'i3', name: 'Milk', quantity: 0 };

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
check('add-item form — collapsed', () => renderToString(wrap(React.createElement(AddItemForm))));
// Expanded is where the unit dropdown lives; the collapsed form renders almost
// nothing, so checking only that would prove nothing.
check('add-item form — expanded (unit dropdown)', () =>
  renderToString(wrap(React.createElement(AddItemForm, { defaultOpen: true }))));

// The bug that shipped: an item card renders differently per sort.
for (const s of SORTS) {
  check(`item card sorted by "${s.key}"`, () =>
    renderToString(wrap(React.createElement(ItemCard, { item: weightItem, sort: s.key })))
  );
}
check('item card — counted item', () => renderToString(wrap(React.createElement(ItemCard, { item: countItem, sort: 'recent' }))));
check('item card — finished item', () => renderToString(wrap(React.createElement(ItemCard, { item: emptyItem, sort: 'recent' }))));

check('amount entry — weight item', () =>
  renderToString(React.createElement(AmountEntry, { item: weightItem, direction: 'remove', onSubmit() {}, onCancel() {} })));
check('amount entry — counted item', () =>
  renderToString(React.createElement(AmountEntry, { item: countItem, direction: 'add', onSubmit() {}, onCancel() {} })));

const MacrosSummary = (await load('/src/features/macros/MacrosSummary.jsx')).default;
check('macros summary', () => renderToString(wrap(React.createElement(MacrosSummary))));

const Settings = (await load('/src/components/Settings.jsx')).default;
check('settings panel', () =>
  renderToString(React.createElement(Settings, {
    email: 'a@b.com', households: [{ id: H, label: 'Apartment' }], householdId: H,
    onSwitch() {}, onClose() {}
  })));

const soon = { ...weightItem, id: 'i4', expiry_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), expiry_estimated: 1 };
const expired = { ...weightItem, id: 'i5', expiry_date: '2020-01-01' };
check('item card — expiring soon', () => renderToString(wrap(React.createElement(ItemCard, { item: soon, sort: 'recent' }))));
check('item card — already expired', () => renderToString(wrap(React.createElement(ItemCard, { item: expired, sort: 'expiry' }))));

check('inventory controls', () =>
  renderToString(React.createElement(InventoryControls, { items: [weightItem, countItem], view: defaultView, onChange() {} })));

await server.close();
console.log(`\n${failures ? `${failures} screen(s) failed to render` : 'all screens rendered'}`);
process.exit(failures ? 1 : 0);
