-- Sample kitchen: 20 items across fridge, freezer and pantry.
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
-- Settings -> Development -> "Load sample kitchen" in `npm run dev` instead,
-- which seeds both sides.

\set household_id '00000000-0000-0000-0000-000000000000'

begin;

-- Seed rows are tagged, so this clears exactly what the seed created and
-- nothing a person added.
delete from events where household_id = :'household_id' and device_id = 'sample-seed';
delete from items  where household_id = :'household_id' and id like 'f00d0000-0000-4000-8000-%';

insert into items
  (id, household_id, name, category, location, base_unit, display_unit, food_db_id, expiry_date, deleted, created_at, updated_at)
values
  ('f00d0000-0000-4000-8000-000000000000', :'household_id', 'Whole milk', 'dairy', 'fridge', 'g', 'gallon', 'sample:whole-milk', '2026-09-16', false, '2026-08-28T16:13:15.086Z', '2026-08-28T16:13:15.086Z'),
  ('f00d0000-0000-4000-8000-000000000001', :'household_id', 'Greek yogurt, plain', 'dairy', 'fridge', 'g', 'container', 'sample:greek-yogurt-plain', '2026-09-20', false, '2026-08-29T16:13:15.087Z', '2026-08-29T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000002', :'household_id', 'Cheddar cheese', 'dairy', 'fridge', 'g', 'slice', 'sample:cheddar-cheese', '2026-10-02', false, '2026-08-30T16:13:15.087Z', '2026-08-30T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000003', :'household_id', 'Salted butter', 'dairy', 'fridge', 'g', 'stick', 'sample:salted-butter', '2026-10-21', false, '2026-08-31T16:13:15.087Z', '2026-08-31T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000004', :'household_id', 'Chicken breast', 'meat', 'fridge', 'g', 'breast', 'sample:chicken-breast', '2026-09-12', false, '2026-09-01T16:13:15.087Z', '2026-09-01T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000005', :'household_id', 'Ground beef, 85% lean', 'meat', 'freezer', 'g', 'pack', 'sample:ground-beef-85-lean', '2027-01-09', false, '2026-09-02T16:13:15.087Z', '2026-09-02T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000006', :'household_id', 'Salmon fillet', 'seafood', 'freezer', 'g', 'fillet', 'sample:salmon-fillet', '2026-12-10', false, '2026-09-03T16:13:15.087Z', '2026-09-03T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000007', :'household_id', 'Eggs', 'eggs', 'fridge', 'g', 'egg', 'sample:eggs', '2026-09-27', false, '2026-09-04T16:13:15.087Z', '2026-09-04T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000008', :'household_id', 'Streaky bacon', 'meat', 'fridge', 'g', 'slice', 'sample:streaky-bacon', '2026-09-15', false, '2026-09-05T16:13:15.087Z', '2026-09-05T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000009', :'household_id', 'Basmati rice', 'grain', 'pantry', 'g', 'g', 'sample:basmati-rice', '2027-10-16', false, '2026-09-06T16:13:15.087Z', '2026-09-06T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000010', :'household_id', 'Rolled oats', 'grain', 'pantry', 'g', 'g', 'sample:rolled-oats', '2027-03-30', false, '2026-09-07T16:13:15.087Z', '2026-09-07T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000011', :'household_id', 'Wholemeal bread', 'grain', 'pantry', 'g', 'slice', 'sample:wholemeal-bread', '2026-09-14', false, '2026-09-08T16:13:15.087Z', '2026-09-08T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000012', :'household_id', 'Spaghetti', 'grain', 'pantry', 'g', 'g', 'sample:spaghetti', '2028-01-24', false, '2026-09-09T16:13:15.087Z', '2026-09-09T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000013', :'household_id', 'Corn tortillas', 'grain', 'fridge', 'g', 'item', 'sample:corn-tortillas', '2026-09-23', false, '2026-09-10T16:13:15.087Z', '2026-09-10T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000014', :'household_id', 'Bananas', 'produce', 'pantry', 'g', 'item', 'sample:bananas', '2026-09-13', false, '2026-08-28T16:13:15.087Z', '2026-08-28T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000015', :'household_id', 'Baby spinach', 'produce', 'fridge', 'g', 'bag', 'sample:baby-spinach', '2026-09-12', false, '2026-08-29T16:13:15.087Z', '2026-08-29T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000016', :'household_id', 'Roma tomatoes', 'produce', 'fridge', 'g', 'item', 'sample:roma-tomatoes', '2026-09-17', false, '2026-08-30T16:13:15.087Z', '2026-08-30T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000017', :'household_id', 'Brussels sprouts', 'produce', 'fridge', 'g', 'g', 'sample:brussels-sprouts', '2026-09-09', false, '2026-08-31T16:13:15.087Z', '2026-08-31T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000018', :'household_id', 'Carrots', 'produce', 'fridge', 'g', 'g', 'sample:carrots', '2026-09-29', false, '2026-09-01T16:13:15.087Z', '2026-09-01T16:13:15.087Z'),
  ('f00d0000-0000-4000-8000-000000000019', :'household_id', 'Peas, frozen', 'frozen', 'freezer', 'g', 'bag', 'sample:peas-frozen', '2027-02-08', false, '2026-09-02T16:13:15.087Z', '2026-09-02T16:13:15.087Z');

insert into events
  (id, household_id, item_id, type, quantity_delta, entered_value, entered_unit, "timestamp", device_id)
values
  ('e7e70000-0000-4000-8000-000000000000', :'household_id', 'f00d0000-0000-4000-8000-000000000000', 'add', 1, 1, 'gallon', '2026-08-28T16:13:15.086Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000000', :'household_id', 'f00d0000-0000-4000-8000-000000000000', 'remove', -0.25, 0.25, 'gallon', '2026-08-29T16:13:15.086Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000000', :'household_id', 'f00d0000-0000-4000-8000-000000000000', 'remove', -0.25, 0.25, 'gallon', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000001', :'household_id', 'f00d0000-0000-4000-8000-000000000001', 'add', 4, 4, 'container', '2026-08-29T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000001', :'household_id', 'f00d0000-0000-4000-8000-000000000001', 'remove', -1, 1, 'container', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000002', :'household_id', 'f00d0000-0000-4000-8000-000000000002', 'add', 20, 20, 'slice', '2026-08-30T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000002', :'household_id', 'f00d0000-0000-4000-8000-000000000002', 'remove', -4, 4, 'slice', '2026-08-31T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000002', :'household_id', 'f00d0000-0000-4000-8000-000000000002', 'remove', -2, 2, 'slice', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000003', :'household_id', 'f00d0000-0000-4000-8000-000000000003', 'add', 4, 4, 'stick', '2026-08-31T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000003', :'household_id', 'f00d0000-0000-4000-8000-000000000003', 'remove', -2.25, 2.25, 'stick', '2026-09-01T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000003', :'household_id', 'f00d0000-0000-4000-8000-000000000003', 'remove', -0.25, 0.25, 'stick', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000004', :'household_id', 'f00d0000-0000-4000-8000-000000000004', 'add', 4, 4, 'breast', '2026-09-01T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000004', :'household_id', 'f00d0000-0000-4000-8000-000000000004', 'remove', -1, 1, 'breast', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000005', :'household_id', 'f00d0000-0000-4000-8000-000000000005', 'add', 2, 2, 'pack', '2026-09-02T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000005', :'household_id', 'f00d0000-0000-4000-8000-000000000005', 'remove', -1, 1, 'pack', '2026-09-03T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000006', :'household_id', 'f00d0000-0000-4000-8000-000000000006', 'add', 4, 4, 'fillet', '2026-09-03T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000006', :'household_id', 'f00d0000-0000-4000-8000-000000000006', 'remove', -1, 1, 'fillet', '2026-09-04T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000007', :'household_id', 'f00d0000-0000-4000-8000-000000000007', 'add', 12, 12, 'egg', '2026-09-04T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000007', :'household_id', 'f00d0000-0000-4000-8000-000000000007', 'remove', -2, 2, 'egg', '2026-09-05T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000007', :'household_id', 'f00d0000-0000-4000-8000-000000000007', 'remove', -2, 2, 'egg', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000008', :'household_id', 'f00d0000-0000-4000-8000-000000000008', 'add', 12, 12, 'slice', '2026-09-05T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000008', :'household_id', 'f00d0000-0000-4000-8000-000000000008', 'remove', -9, 9, 'slice', '2026-09-06T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000008', :'household_id', 'f00d0000-0000-4000-8000-000000000008', 'remove', -3, 3, 'slice', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000009', :'household_id', 'f00d0000-0000-4000-8000-000000000009', 'add', 5000, 5000, 'g', '2026-09-06T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000009', :'household_id', 'f00d0000-0000-4000-8000-000000000009', 'remove', -3020, 3020, 'g', '2026-09-07T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000009', :'household_id', 'f00d0000-0000-4000-8000-000000000009', 'remove', -180, 180, 'g', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000010', :'household_id', 'f00d0000-0000-4000-8000-000000000010', 'add', 1000, 1000, 'g', '2026-09-07T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000010', :'household_id', 'f00d0000-0000-4000-8000-000000000010', 'remove', -300, 300, 'g', '2026-09-08T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000010', :'household_id', 'f00d0000-0000-4000-8000-000000000010', 'remove', -80, 80, 'g', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000011', :'household_id', 'f00d0000-0000-4000-8000-000000000011', 'add', 22, 22, 'slice', '2026-09-08T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000011', :'household_id', 'f00d0000-0000-4000-8000-000000000011', 'remove', -9, 9, 'slice', '2026-09-09T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000011', :'household_id', 'f00d0000-0000-4000-8000-000000000011', 'remove', -2, 2, 'slice', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000012', :'household_id', 'f00d0000-0000-4000-8000-000000000012', 'add', 500, 500, 'g', '2026-09-09T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000012', :'household_id', 'f00d0000-0000-4000-8000-000000000012', 'remove', -250, 250, 'g', '2026-09-10T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000013', :'household_id', 'f00d0000-0000-4000-8000-000000000013', 'add', 10, 10, 'item', '2026-09-10T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000013', :'household_id', 'f00d0000-0000-4000-8000-000000000013', 'remove', -2, 2, 'item', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000013', :'household_id', 'f00d0000-0000-4000-8000-000000000013', 'remove', -2, 2, 'item', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000014', :'household_id', 'f00d0000-0000-4000-8000-000000000014', 'add', 7, 7, 'item', '2026-08-28T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000014', :'household_id', 'f00d0000-0000-4000-8000-000000000014', 'remove', -3, 3, 'item', '2026-08-29T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000014', :'household_id', 'f00d0000-0000-4000-8000-000000000014', 'remove', -1, 1, 'item', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000015', :'household_id', 'f00d0000-0000-4000-8000-000000000015', 'add', 1, 1, 'bag', '2026-08-29T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000015', :'household_id', 'f00d0000-0000-4000-8000-000000000015', 'remove', -0.5, 0.5, 'bag', '2026-08-30T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000015', :'household_id', 'f00d0000-0000-4000-8000-000000000015', 'remove', -0.25, 0.25, 'bag', '2026-09-11T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000016', :'household_id', 'f00d0000-0000-4000-8000-000000000016', 'add', 8, 8, 'item', '2026-08-30T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000016', :'household_id', 'f00d0000-0000-4000-8000-000000000016', 'remove', -2, 2, 'item', '2026-08-31T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000017', :'household_id', 'f00d0000-0000-4000-8000-000000000017', 'add', 500, 500, 'g', '2026-08-31T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000017', :'household_id', 'f00d0000-0000-4000-8000-000000000017', 'remove', -178, 178, 'g', '2026-09-01T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000018', :'household_id', 'f00d0000-0000-4000-8000-000000000018', 'add', 1000, 1000, 'g', '2026-09-01T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000018', :'household_id', 'f00d0000-0000-4000-8000-000000000018', 'remove', -300, 300, 'g', '2026-09-02T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0000-4000-8000-000000000019', :'household_id', 'f00d0000-0000-4000-8000-000000000019', 'add', 2, 2, 'bag', '2026-09-02T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0001-4000-8000-000000000019', :'household_id', 'f00d0000-0000-4000-8000-000000000019', 'remove', -0.25, 0.25, 'bag', '2026-09-03T16:13:15.087Z', 'sample-seed'),
  ('e7e70000-0002-4000-8000-000000000019', :'household_id', 'f00d0000-0000-4000-8000-000000000019', 'remove', -0.25, 0.25, 'bag', '2026-09-11T16:13:15.087Z', 'sample-seed');

commit;
