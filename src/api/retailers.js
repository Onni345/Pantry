/**
 * Who sells it, and what they call their own food.
 *
 * A receipt line is not a food name. "GOODGATH JASMINE RICE 5LB" is a
 * retailer's abbreviation of a brand, a product, and a package size, printed
 * by a till with a twenty-character field. Expanding that back into something
 * searchable is clerical work with a right answer — a table, not a model,
 * exactly like the rest of receipt reading.
 *
 * The payoff is large: searching "Good & Gather Jasmine Rice" against a
 * database that holds the branded product finds it outright, where
 * "GOODGATH RICE" finds nothing and falls back to generic rice.
 *
 * Pure module — no fetch, no React.
 */

/**
 * Chains, their own-brand labels, and how their tills print them.
 *
 * `brands` are in rough order of how commonly they appear on a receipt, and
 * the first is the chain's flagship grocery label. Names are written the way
 * the food databases spell them, because that is what gets searched.
 */
const RETAILERS = {
  target: {
    name: 'Target',
    match: /\btarget\b/i,
    brands: ['Good & Gather', 'Market Pantry', 'Favorite Day', 'Archer Farms', 'Simply Balanced']
  },
  costco: {
    name: 'Costco',
    match: /\bcostco\b|\bwholesale\b/i,
    brands: ['Kirkland Signature']
  },
  walmart: {
    name: 'Walmart',
    match: /\bwal-?mart\b/i,
    brands: ['Great Value', 'Marketside', 'Freshness Guaranteed', 'Equate']
  },
  kroger: {
    name: 'Kroger',
    match: /\bkroger\b/i,
    brands: ['Kroger', 'Simple Truth', 'Private Selection']
  },
  safeway: {
    name: 'Safeway',
    match: /\bsafeway\b|\balbertsons\b/i,
    brands: ['Signature Select', 'O Organics', 'Lucerne']
  },
  wholefoods: {
    name: 'Whole Foods Market',
    match: /\bwhole\s?foods\b|\bwfm\b/i,
    brands: ['365 by Whole Foods Market', '365 Everyday Value']
  },
  traderjoes: {
    name: "Trader Joe's",
    match: /\btrader\s?joe'?s?\b/i,
    brands: ["Trader Joe's"]
  },
  aldi: {
    name: 'Aldi',
    match: /\baldi\b/i,
    brands: ['Simply Nature', 'Never Any!', 'Friendly Farms', 'Millville']
  },
  publix: {
    name: 'Publix',
    match: /\bpublix\b/i,
    brands: ['Publix', 'GreenWise']
  },
  heb: {
    name: 'H-E-B',
    match: /\bh-?e-?b\b/i,
    brands: ['H-E-B', 'Hill Country Fare', 'Central Market']
  },
  wegmans: {
    name: 'Wegmans',
    match: /\bwegmans\b/i,
    brands: ['Wegmans']
  },
  meijer: {
    name: 'Meijer',
    match: /\bmeijer\b/i,
    brands: ['Meijer', 'True Goodness']
  },
  sprouts: {
    name: 'Sprouts',
    match: /\bsprouts\b/i,
    brands: ['Sprouts']
  },
  woolworths: {
    name: 'Woolworths',
    match: /\bwoolworths\b|\bwoolies\b/i,
    brands: ['Woolworths', 'Macro', 'Essentials']
  },
  coles: {
    name: 'Coles',
    match: /\bcoles\b/i,
    brands: ['Coles', 'Coles Finest']
  }
};

/**
 * How tills abbreviate brands. Keyed by the squashed, letters-only form of
 * what gets printed, so "GOODGATH", "GOOD GATH" and "GoodGath" all hit the
 * same entry.
 */
const BRAND_ABBREVIATIONS = {
  goodgath: 'Good & Gather',
  gg: 'Good & Gather',
  gdgather: 'Good & Gather',
  mktpantry: 'Market Pantry',
  mrktpntry: 'Market Pantry',
  ks: 'Kirkland Signature',
  kirk: 'Kirkland Signature',
  kirkland: 'Kirkland Signature',
  gv: 'Great Value',
  grtvalue: 'Great Value',
  mktside: 'Marketside',
  simptruth: 'Simple Truth',
  simplytruth: 'Simple Truth',
  privsel: 'Private Selection',
  sigselect: 'Signature Select',
  oorganics: 'O Organics',
  wfm: '365 by Whole Foods Market',
  tj: "Trader Joe's",
  tjs: "Trader Joe's",
  simpnature: 'Simply Nature',
  frndlyfarms: 'Friendly Farms',
  hcf: 'Hill Country Fare',
  ww: 'Woolworths'
};

/**
 * Words a till prints that are not part of the food's name. Stripped before
 * searching, because "ORG" and "LB" only ever dilute a query.
 */
const NOISE = new Set([
  'org', 'orgnc', 'organic', 'nat', 'natrl', 'natural', 'fz', 'frz', 'frzn', 'frozen',
  'fresh', 'rfg', 'refrig', 'pk', 'pkg', 'ct', 'cnt', 'ea', 'each', 'lb', 'lbs', 'oz',
  'kg', 'g', 'ml', 'l', 'qt', 'gal', 'sm', 'md', 'lg', 'xl', 'reg', 'wt', 'net',
  'item', 'no', 'item#', 'upc', 'sku'
]);

/** Everyday shorthand that should be expanded rather than dropped. */
const WORD_EXPANSIONS = {
  chkn: 'chicken', chk: 'chicken', bf: 'beef', prk: 'pork',
  chz: 'cheese', chse: 'cheese', mlk: 'milk', yog: 'yogurt', yogrt: 'yogurt',
  brd: 'bread', btr: 'butter', bttr: 'butter', egg: 'eggs',
  tom: 'tomato', tmto: 'tomato', pot: 'potato', ptato: 'potato',
  bnls: 'boneless', sknls: 'skinless', brst: 'breast', grnd: 'ground',
  shrd: 'shredded', slcd: 'sliced', whl: 'whole', unswt: 'unsweetened',
  strwbry: 'strawberry', blubry: 'blueberry', bnna: 'banana', avo: 'avocado',
  brocc: 'broccoli', cauli: 'cauliflower', spin: 'spinach', letc: 'lettuce'
};

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which chain printed this receipt, from its header.
 *
 * Only the first few lines are considered: a receipt footer often thanks you
 * for shopping at a competitor's loyalty partner, and the header is where the
 * shop's own name reliably sits.
 */
export function detectRetailer(ocrText, { headerLines = 8 } = {}) {
  const head = String(ocrText || '').split(/\r?\n/).slice(0, headerLines).join('\n');
  for (const [key, r] of Object.entries(RETAILERS)) {
    if (r.match.test(head)) return { key, ...r };
  }
  return null;
}

/**
 * A receipt line turned into something worth searching for.
 *
 * Returns the expanded query plus the brand it believes it found, so the
 * ranker can reward a result whose brand actually matches rather than one
 * that merely shares words.
 */
export function expandReceiptText(rawName, retailer = null) {
  const tokens = String(rawName || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s&]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let brand = null;
  const words = [];

  for (const token of tokens) {
    // A pure number, or a size like "5lb", carries no search value.
    if (/^\d+(\.\d+)?[a-z]*$/.test(token)) continue;

    const key = squash(token);
    if (!key) continue;

    const asBrand = BRAND_ABBREVIATIONS[key];
    // A store-brand abbreviation only counts if this chain actually sells
    // that brand. "KS" on a Target receipt is a misread, not Kirkland.
    if (asBrand && (!retailer || retailer.brands.includes(asBrand))) {
      brand = brand || asBrand;
      continue;
    }

    if (NOISE.has(key)) continue;

    words.push(WORD_EXPANSIONS[key] || token);
  }

  // The chain's own brands, spelled out, also appear verbatim on some
  // receipts — catch those before falling back to the chain's flagship label.
  if (!brand && retailer) {
    const line = squash(rawName);
    brand = retailer.brands.find((b) => line.includes(squash(b))) || null;
  }

  const product = words.join(' ').trim();
  const query = [brand, product].filter(Boolean).join(' ').trim();

  return {
    query: query || String(rawName || '').trim(),
    brand,
    product,
    retailer: retailer?.name || null
  };
}

/** Every own-brand name we know, for the ranker's brand-hit check. */
export const ALL_STORE_BRANDS = [
  ...new Set(Object.values(RETAILERS).flatMap((r) => r.brands))
];
