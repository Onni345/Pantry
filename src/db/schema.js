import Dexie from 'dexie';

export const db = new Dexie('pantry');

// All tables are declared up front so later features don't need a version bump.
// Only the fields listed here are indexed; every other field still round-trips.
db.version(1).stores({
  items: 'id, household_id, name, category, location, updated_at, deleted',
  events: 'id, household_id, item_id, timestamp',
  food_cache: 'food_db_id, name',
  expiry_cache: 'food_name_or_category',
  pending_sync: 'local_id, target_table, created_at'
});

/**
 * v2 moves quantities to canonical base units (g / ml / count). Old rows
 * stored deltas in each item's own display unit, which cannot be converted
 * without knowing intent, so items and events are cleared. food_cache is
 * reference data and survives untouched.
 */
db.version(2)
  .stores({
    items: 'id, household_id, name, category, location, base_unit, updated_at, deleted',
    events: 'id, household_id, item_id, timestamp',
    food_cache: 'food_db_id, name',
    expiry_cache: 'food_name_or_category',
    pending_sync: 'local_id, target_table, created_at'
  })
  .upgrade(async (tx) => {
    await tx.table('items').clear();
    await tx.table('events').clear();
    await tx.table('pending_sync').clear();
  });

/**
 * v3 drops volume units. Any item stored with a millilitre base has no
 * meaningful weight equivalent, so items and events are cleared once more.
 */
db.version(3)
  .stores({
    items: 'id, household_id, name, category, location, base_unit, updated_at, deleted',
    events: 'id, household_id, item_id, timestamp',
    food_cache: 'food_db_id, name',
    expiry_cache: 'food_name_or_category',
    pending_sync: 'local_id, target_table, created_at'
  })
  .upgrade(async (tx) => {
    await tx.table('items').clear();
    await tx.table('events').clear();
    await tx.table('pending_sync').clear();
  });

export const LOCATIONS = ['fridge', 'freezer', 'pantry'];

export const CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'seafood',
  'grain',
  'canned',
  'frozen',
  'condiment',
  'snack',
  'beverage',
  'other'
];

export const EVENT_TYPES = {
  ADD: 'add',
  REMOVE: 'remove',
  CONSUMED_REMAINDER: 'consumed_remainder',
  UNDO: 'undo'
};
