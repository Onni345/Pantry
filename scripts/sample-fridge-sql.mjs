/**
 * Generates supabase/sample-fridge.sql from src/dev/sampleFridge.js.
 *
 * The in-app button is the better path (it seeds macros too — see the note in
 * the generated file). This exists for seeding the *server* directly, so a
 * phone or a family member's device pulls the sample kitchen down without
 * anyone opening dev tools.
 *
 * Run:  node scripts/sample-fridge-sql.mjs   ->  supabase/sample-fridge.sql
 */
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true } });
const { ITEMS, slugOf, foodIdOf, isoDaysFromNow } = await server.ssrLoadModule('/src/dev/sampleFridge.js');

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// Deterministic ids, so re-running replaces the sample kitchen instead of
// stacking a second copy on top of it.
const pad = (n) => String(n).padStart(12, '0');
const itemId = (i) => `f00d0000-0000-4000-8000-${pad(i)}`;
const eventId = (i, k) => `e7e70000-000${k}-4000-8000-${pad(i)}`;

const day = 86400000;
const lines = [];

lines.push(`-- Sample kitchen: ${ITEMS.length} items across fridge, freezer and pantry.
--
-- GENERATED from src/dev/sampleFridge.js by scripts/sample-fridge-sql.mjs.
-- Edit that file and re-run the script; don't edit this by hand.
--
-- HOW TO USE: replace the household id on the next line with your own
-- (Table Editor -> households -> copy the id), then run the whole thing in the
-- Supabase SQL editor. Safe to re-run: it deletes its own rows first, so you
-- get the same known kitchen back every time. It only touches rows it created
-- (fixed ids) — anything you added yourself is left alone.
--
-- ONE LIMITATION, worth knowing before you wonder where the macros went:
-- nutrition lives in food_cache, which is IndexedDB on each device and never
-- syncs. This seed can't reach it, so items arrive with no macros and the
-- Intake screen will show coverage but no totals. If you want macros, use
-- Settings -> Development -> "Load sample kitchen" in \`npm run dev\` instead,
-- which seeds both sides.

\\set household_id '00000000-0000-0000-0000-000000000000'

begin;

-- Seed rows are tagged, so this clears exactly what the seed created and
-- nothing a person added.
delete from events where household_id = :'household_id' and device_id = 'sample-seed';
delete from items  where household_id = :'household_id' and id like 'f00d0000-0000-4000-8000-%';
`);

const itemRows = [];
const eventRows = [];

ITEMS.forEach((spec, i) => {
  const boughtAt = Date.now() - (14 - (i % 14)) * day;
  const baseUnit = spec.unit === 'count' ? 'count' : 'g';
  const id = itemId(i);

  itemRows.push(
    `  (${q(id)}, :'household_id', ${q(spec.name)}, ${q(spec.category)}, ${q(spec.location)}, ` +
    `${q(baseUnit)}, ${q(spec.unit)}, ${q(foodIdOf(spec))}, ${q(isoDaysFromNow(spec.expiresIn).slice(0, 10))}, ` +
    `false, ${q(new Date(boughtAt).toISOString())}, ${q(new Date(boughtAt).toISOString())})`
  );

  // The purchase.
  eventRows.push(
    `  (${q(eventId(i, 0))}, :'household_id', ${q(id)}, 'add', ${spec.bought}, ${spec.bought}, ` +
    `${q(spec.unit)}, ${q(new Date(boughtAt).toISOString())}, 'sample-seed')`
  );

  const earlier = spec.used - (spec.usedToday || 0);
  if (earlier > 0) {
    eventRows.push(
      `  (${q(eventId(i, 1))}, :'household_id', ${q(id)}, 'remove', ${-earlier}, ${earlier}, ` +
      `${q(spec.unit)}, ${q(new Date(boughtAt + day).toISOString())}, 'sample-seed')`
    );
  }
  if (spec.usedToday > 0) {
    eventRows.push(
      `  (${q(eventId(i, 2))}, :'household_id', ${q(id)}, 'remove', ${-spec.usedToday}, ${spec.usedToday}, ` +
      `${q(spec.unit)}, ${q(new Date().toISOString())}, 'sample-seed')`
    );
  }
});

lines.push(`insert into items
  (id, household_id, name, category, location, base_unit, display_unit, food_db_id, expiry_date, deleted, created_at, updated_at)
values
${itemRows.join(',\n')};
`);

lines.push(`insert into events
  (id, household_id, item_id, type, quantity_delta, entered_value, entered_unit, "timestamp", device_id)
values
${eventRows.join(',\n')};

commit;
`);

await writeFile(`${root}supabase/sample-fridge.sql`, lines.join('\n'));
console.log(`supabase/sample-fridge.sql — ${ITEMS.length} items, ${eventRows.length} events`);

await server.close();
process.exit(0);
