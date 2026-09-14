/**
 * Drives the real app in a real browser: mount, click every screen, and
 * report anything the console complains about.
 *
 * SSR smoke proves a component renders once. This proves the app actually
 * runs — effects, handlers, Dexie, the lot.
 */
import './node-compat.mjs';
import { createServer } from 'vite';
import { launchChromium } from './chromium.mjs';


process.env.VITE_SUPABASE_URL = 'https://drive.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'drive-key';
process.env.VITE_USDA_API_KEY = 'DRIVE_KEY';

const root = new URL('..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { port: 5199 } });
await server.listen();

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

// Fake out the network the sandbox can't reach, so a lookup returns something
// realistic instead of hanging. Supabase is stubbed to "signed in".
await page.route('**/api.nal.usda.gov/**', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ foods: [{
    fdcId: 748967, description: 'Egg, whole, raw, fresh', dataType: 'Foundation',
    foodNutrients: [
      { nutrientId: 1008, value: 143 }, { nutrientId: 1003, value: 12.6 },
      { nutrientId: 1005, value: 0.72 }, { nutrientId: 1004, value: 9.51 }
    ]
  }] })
}));
await page.route('**/openfoodfacts.org/**', (r) => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ products: [] })
}));
await page.route('**/drive.supabase.co/**', (r) => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({})
}));

// Sign-in is a Supabase round trip we can't make from here, so a session is
// planted where supabase-js looks for one and the two calls the gate makes
// are answered below. Everything past the gate is the real app.
const H = '00000000-0000-0000-0000-000000000000';
const SESSION = {
  access_token: 'drive-token', refresh_token: 'drive-refresh', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'u1', email: 'drive@test.local', aud: 'authenticated', role: 'authenticated' }
};
await page.addInitScript(({ session, h }) => {
  localStorage.setItem('sb-drive-auth-token', JSON.stringify(session));
  localStorage.setItem('pantry.household_id', h);
}, { session: SESSION, h: H });

await page.route('**/auth/v1/**', (r) => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(SESSION.user)
}));
// Playwright tries the most recently registered route first, so the catch-all
// is registered before the specific one that must beat it.
await page.route('**/rest/v1/**', (r) => r.fulfill({
  status: 200, contentType: 'application/json', body: '[]'
}));
await page.route('**/rest/v1/household_allowlist**', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify([{ household_id: H, households: { id: H, name: 'Seattle Apartment' } }])
}));

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const shot = async (name) => {
  await page.screenshot({ path: `${root}screens/drive-${name}.png`, fullPage: false });
  console.log(`  screens/drive-${name}.png`);
};

const text = async () => (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
let failures = 0;
const step = async (name, fn) => {
  const before = problems.length;
  try {
    await fn();
    await page.waitForTimeout(500);
    const errs = problems.slice(before);
    if (errs.length) failures++;
    console.log(`${errs.length ? 'FAIL ' : 'PASS '} ${name}`);
    if (errs.length) errs.forEach((e) => console.log('        ' + e));
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
  }
};

console.log('\n── driving the app ' + '─'.repeat(40));

await step('kitchen mounts', async () => {
  if (!(await text()).includes('Fridge')) throw new Error('no fridge heading');
});

await step('settings opens and seeds the sample kitchen', async () => {
  await page.getByRole('button', { name: /settings/i }).click();
  await page.waitForTimeout(300);
  const seed = page.getByRole('button', { name: /load sample kitchen/i }).first();
  if (await seed.count() === 0) throw new Error('no sample-fridge button in settings');
  await seed.click();                       // arms it
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /replace|yes|load/i }).first().click();  // confirms
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /^close$/i }).first().click();
});
await shot('kitchen');

await step('the fridge now lists food', async () => {
  const t = await text();
  if (!/eggs/i.test(t)) throw new Error('sample food not on screen: ' + t.slice(0, 200));
});

await step('an item opens its sheet', async () => {
  await page.getByRole('button', { name: /eggs/i }).first().click();
  await page.waitForTimeout(600);
  if (!(await page.getByRole('dialog').count())) throw new Error('no sheet opened');
});
await shot('sheet');

await step('the sheet shows per-unit macros', async () => {
  const t = await text();
  if (!/kcal|calorie/i.test(t)) throw new Error('NO MACROS ON THE ITEM SHEET: ' + t.slice(0, 300));
});

await step('consuming one changes the quantity', async () => {
  const before = await text();
  const minus = page.getByRole('button', { name: /^−1$|^-1$/ }).first();
  if (await minus.count() === 0) throw new Error('no decrement button');
  await minus.click();
  await page.waitForTimeout(900);
  if ((await text()) === before) throw new Error('quantity did not move');
  await page.getByRole('button', { name: /^close$/i }).first().click();
});

await step('the intake tab shows calories', async () => {
  await page.getByRole('button', { name: /^intake$/i }).click();
  await page.waitForTimeout(1200);
  const t = await text();
  if (/nothing logged/i.test(t)) throw new Error('INTAKE SAYS NOTHING LOGGED after consuming');
  if (!/kcal/i.test(t)) throw new Error('NO CALORIES ON INTAKE: ' + t.slice(0, 300));
  console.log('        intake reads: ' + t.slice(0, 220));
});
await shot('intake');

await step('the add menu opens and offers every route', async () => {
  await page.getByRole('button', { name: /^kitchen$/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^\+$|add/i }).last().click();
  await page.waitForTimeout(500);
  const t = await text();
  for (const route of ['Scan a receipt', 'Add from recent', 'Add by hand', 'Add by barcode']) {
    if (!t.includes(route)) throw new Error(`missing route: ${route}`);
  }
});
await shot('add');

await step('adding by hand actually adds', async () => {
  await page.getByRole('button', { name: /add by hand/i }).click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder('Eggs').fill('Test Yoghurt');
  await page.getByRole('button', { name: /add it/i }).click();
  await page.waitForTimeout(1200);
  if (!(await text()).includes('Test Yoghurt')) throw new Error('item not in the list after adding');
});

await step('locations cycle with the arrows', async () => {
  const before = await text();
  await page.locator('.place-arrow').last().click();
  await page.waitForTimeout(700);
  if ((await text()) === before) throw new Error('arrow did not change the location');
});
await shot('freezer');

await step('the recipes tab mounts', async () => {
  await page.getByRole('button', { name: /^recipes$/i }).click();
  await page.waitForTimeout(700);
});

console.log('\nALL CONSOLE PROBLEMS:');
console.log(problems.length ? [...new Set(problems)].slice(0, 20).join('\n') : '  (none)');

await browser.close();
await server.close();
console.log(failures ? `\n${failures} step(s) failed` : '\nevery screen worked');
process.exit(failures ? 1 : 0);
