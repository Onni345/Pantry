/**
 * Produce codes — the barcode for things that have no barcode.
 *
 * Loose fruit and veg carry a PLU sticker instead: four digits for
 * conventionally grown, five beginning with 9 for organic. 94011 is an
 * organic banana; strip the 9 and 4011 is an ordinary one. The codes are
 * assigned by IFPS and there are about fifteen hundred of them, so this is a
 * table, not a service — no network, no key, no rate limit, works in a
 * basement.
 *
 * Two rules are derivable and everything else is a lookup. IFPS is explicit
 * that "there is no intelligence built into the code": the digits do not
 * encode the commodity, the variety or the size, they are simply assigned.
 *
 *   length 5 and starts with 9  ->  organic; the remaining four are the code
 *   length 4                    ->  conventionally grown
 *
 * A leading 8 does NOT mean genetically modified. That range was reserved for
 * it, never used at retail, and formally reassigned in 2015 to ordinary
 * conventional and organic produce as the 3000/4000 series fills up. Several
 * popular open datasets still document the old meaning and are wrong.
 *
 * ---------------------------------------------------------------------------
 * THIS TABLE IS A STARTER SET, NOT THE FULL FIFTEEN HUNDRED.
 *
 * It holds the codes that actually turn up in a weekly shop. A code that
 * isn't here resolves to nothing and the app falls back to searching by name,
 * which is a mild inconvenience — whereas a code mapped to the WRONG food
 * would silently attach wrong nutrition, so only entries worth vouching for
 * are included.
 *
 * To extend it: ifpsglobal.com/plu-codes-search, press Search with every
 * field blank, and export the full list to a spreadsheet. Free, no account.
 * Retailers also assign their own in-store codes outside the IFPS ranges, so
 * an unrecognised four-digit code is not necessarily invalid.
 * ---------------------------------------------------------------------------
 *
 * Pure module — no fetch, no React, no Dexie.
 */

/**
 * code -> the plainest name for the thing, which is then searched for in the
 * food database like any other name. Deliberately not macros: this table says
 * what you are holding, and the food databases say what is in it.
 */
export const PLU_CODES = {
  // Fruit
  4011: 'Banana',
  4225: 'Avocado, Hass',
  4046: 'Avocado, small',
  4030: 'Kiwifruit',
  4032: 'Watermelon, seedless',
  4050: 'Cantaloupe',
  4033: 'Lemon',
  4048: 'Lime',
  4012: 'Orange, navel',
  4013: 'Orange, Valencia',
  4383: 'Mango',
  4038: 'Strawberries',
  4240: 'Blueberries',
  4239: 'Raspberries',
  4022: 'Grapes, white seedless',
  4023: 'Grapes, red seedless',
  4041: 'Peach',
  4044: 'Pear, Bartlett',
  4409: 'Pineapple',
  4432: 'Plum, red',

  // Apples
  4015: 'Apple, Red Delicious',
  4017: 'Apple, Granny Smith',
  4020: 'Apple, Golden Delicious',
  4129: 'Apple, Fuji',
  4133: 'Apple, Gala',
  4130: 'Apple, Braeburn',
  4173: 'Apple, Honeycrisp',

  // Vegetables
  4060: 'Broccoli',
  4062: 'Cucumber',
  4064: 'Tomato',
  4087: 'Tomato, Roma',
  4664: 'Tomato, grape',
  4065: 'Pepper, green bell',
  4088: 'Pepper, red bell',
  4688: 'Pepper, yellow bell',
  4080: 'Asparagus',
  4081: 'Eggplant',
  4067: 'Squash, zucchini',
  4078: 'Corn, sweet',
  4069: 'Cabbage, green',
  4079: 'Celery',
  4082: 'Lettuce, iceberg',
  4640: 'Ginger root',
  4061: 'Lettuce, green leaf',
  4562: 'Spinach',
  4614: 'Kale',
  4089: 'Mushrooms, white',
  4650: 'Onion, yellow',
  4663: 'Onion, red',
  4072: 'Potato, sweet',
  4073: 'Potato, red',
  4083: 'Potato, russet',
  4091: 'Potato, white',
  4094: 'Carrot',
  4068: 'Onion, green',
  4677: 'Garlic',
  4599: 'Squash, butternut'
};

/**
 * Reads a sticker.
 *
 * Returns { code, name, organic } for something recognised, or null. The
 * organic flag comes from the leading 9 and is reported separately because it
 * changes what to search for ("Organic Banana") without changing what the
 * thing is.
 */
export function readPlu(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length !== 4 && digits.length !== 5) return null;

  let organic = false;
  let code = digits;

  if (digits.length === 5) {
    if (digits[0] !== '9') return null; // a 5-digit code not starting with 9 is not a PLU
    organic = true;
    code = digits.slice(1);
  }

  const name = PLU_CODES[code];
  if (!name) return null;

  return { code, name, organic };
}

/** What to search the food database for, given a sticker. */
export function pluQuery(input) {
  const hit = readPlu(input);
  if (!hit) return null;
  return hit.organic ? `Organic ${hit.name}` : hit.name;
}

/** Does this look like a produce sticker rather than a barcode? */
export const isPluCode = (s) => /^\d{4,5}$/.test(String(s || '').trim());
