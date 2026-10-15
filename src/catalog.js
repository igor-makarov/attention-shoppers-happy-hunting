// Tracked product and strict listing classification.
//
// Scope (owner instruction, 2026-10-15): Crema e Gusto coffee and plain
// Tnuva 5% cottage cheese in 250 g tubs. Qualità Oro,
// Qualità Rossa, Suerte and every other Lavazza line are retired: their names
// survive only as tombstones below, so a listing, a parser page or an old
// ?product= URL can never silently re-enter the board. Re-adding a product
// line requires an explicit new owner instruction.
//
// Classification stays conservative: a listing that cannot be tied to the
// tracked product is rejected instead of being merged into the board. Pack
// sizes and multipacks stay separate so different offers are never merged.
//
// Owner correction, 2026-10-12: there is no shopper-facing blend/variant
// feature. Every tracked Crema e Gusto vacuum-packed ground listing —
// including a listing that states no blend wording at all — takes part in one
// comparison for the selected quantity, locality and delivery method. The
// blend wording a vendor happens to print is kept only as raw listing identity
// metadata for evidence/offer details, never as a filter, menu entry or badge.

import { decodeEntities } from './lib/text.js';

const LINE_PATTERNS = {
  'lavazza-crema-e-gusto': [
    /crema\s*(?:e|&|and|-)?\s*gusto/i,
    /קרמה\s*(?:אה\s*)?גוסטו/
  ]
};

/**
 * Product lines that earlier iterations tracked and the 2026-10-12 owner
 * correction retired. They are not fetch targets, not catalog entries and not
 * selectable anywhere; the patterns exist only so `classifyListing()` can
 * reject those pages with an explicit reason and `resolveProductRequest()`
 * can fall back to the tracked product instead of resurrecting them.
 */
export const RETIRED_LINES = [
  {
    id: 'lavazza-qualita-oro-vacuum-ground',
    line: 'Qualità Oro',
    patterns: [
      /qualit[aàáy]\s*oro/i,
      /קוואליטה\s*אורו/,
      /קווליטה\s*אורו/
    ]
  },
  {
    id: 'lavazza-qualita-rossa-vacuum-ground',
    line: 'Qualità Rossa',
    patterns: [
      /qualit[aàáy]\s*rossa/i,
      /קוואליטה\s*רוסה/,
      /קווליטה\s*רוסה/,
      /לווצה\s*רוסה/
    ]
  },
  {
    id: 'lavazza-suerte-ground',
    line: 'Suerte',
    patterns: [
      /lavazza\s*suerte/i,
      /לווצה\s*סוארטה/
    ]
  }
];

export const RETIRED_PRODUCT_IDS = RETIRED_LINES.map(line => line.id);

export const PRODUCTS = [
  {
    id: 'lavazza-crema-e-gusto-vacuum-ground',
    brand: 'Lavazza',
    line: 'Crema e Gusto',
    form: 'ground',
    packaging: 'vacuum brick',
    targetMarket: 'IL',
    description: 'Ground coffee · vacuum brick · 250 g packs and multipacks',
    detailDescription: 'Ground coffee · vacuum brick · delivery in Israel',
    quantity: { mode: 'weight', options: [250, 500, 750, 1000, 2000], default: 500 },
    linePatterns: LINE_PATTERNS['lavazza-crema-e-gusto'],
    notes: 'Ground coffee in a vacuum brick. All eligible Crema e Gusto vacuum-packed ground listings share one comparison; pack sizes and multipacks stay distinct offers. Any blend wording a listing prints is raw listing identity metadata only — never a shopper-selectable variant. Beans, capsules, pods and every other Lavazza product line are rejected.'
  },
  {
    id: 'tnuva-cottage-cheese-5-percent',
    brand: 'Tnuva',
    line: '5% cottage cheese',
    form: 'cottage_cheese',
    packaging: '250 g tub',
    targetMarket: 'IL',
    description: 'Plain 5% cottage cheese · 250 g tubs · delivery only',
    quantity: { mode: 'units', unitLabel: 'tubs', unitGrams: 250, options: [4, 6, 8, 10], default: 4 },
    deliveryOnly: true,
    notes: 'Compare the lowest total including delivery and mandatory fees for exact batches of 4, 6, 8 or 10 standard 250 g tubs. Other brands, fat percentages, flavoured cottage cheese and other tub sizes are excluded.',
    sourcing: {
      status: 'partial',
      note: 'Real delivered totals are ranked for the Ganei Shmuel (גן שמואל) delivery area: Duchan Ganei Shmuel’s online branch sells the exact 4/6/8/10-tub batches at ₪6.30 per 250 g tub plus a ₪28 home-delivery line (anonymous public cart quotes: ₪53.20/₪65.80/₪78.40/₪91.00) with no minimum order and free delivery only above ₪599. For the default Tel Aviv–Yafo locality no reachable permitted vendor can sell a standalone batch: Tiv Taam (₪6.10, ₪29.90 delivery, ₪300 minimum) and Super Yuda (₪6.70, ₪35 delivery, ₪150 minimum) both publish minimums above every exact batch, and the remaining reachable groceries either do not cover Tel Aviv–Yafo or are blocked by their own bot protection or terms. Totals for Tel Aviv–Yafo stay unknown until a vendor can deliver a batch at or above its minimum; see docs/evidence/tnuva-cottage-cheese-runner-research-20261015.json and docs/evidence/tnuva-cottage-cheese-duchan-cart-20261015.json.',
      sources: [
        {
          label: 'Duchan Ganei Shmuel public store API (branch 2175) — ₪6.30 per tub, in stock',
          url: 'https://www.duchan.co.il/?catalogProduct=12053'
        },
        {
          label: 'Duchan delivery area (גן שמואל: ₪28, no minimum order)',
          url: 'https://www.duchan.co.il/v2/retailers/1420/branches/2175/areas?appId=4&deliveryTypeId=1&languageId=1'
        },
        {
          label: 'Duchan anonymous cart quotes for the four batches',
          url: 'docs/evidence/tnuva-cottage-cheese-duchan-cart-20261015.json'
        },
        {
          label: 'Tiv Taam public store API (branch 924, Ramat HaHayal)',
          url: 'https://www.tivtaam.co.il/?catalogProduct=12053'
        },
        {
          label: 'Tiv Taam delivery areas (₪29.90, seven areas)',
          url: 'https://www.tivtaam.co.il/v2/retailers/1062/branches/924/areas/2446?appId=4&deliveryTypeId=1&languageId=2'
        },
        {
          label: 'Super Yuda public store API (branch 2481, ישעיהו Tel Aviv)',
          url: 'https://www.yuda.co.il/?catalogProduct=12053'
        },
        {
          label: 'Super Yuda delivery area (₪35, ₪150 minimum)',
          url: 'https://www.yuda.co.il/v2/retailers/1492/branches/2481/areas?appId=4&deliveryTypeId=1&languageId=1'
        },
        {
          label: 'Runner research record (prices, minimum orders, blocked sources)',
          url: 'docs/evidence/tnuva-cottage-cheese-runner-research-20261015.json'
        },
        {
          label: 'Bastale product listing (observed out of stock 2026-10-15)',
          url: 'https://www.bastale.co.il/product-details/75069/קוטג_5%25_תנובה_250_גרם'
        }
      ]
    }
  }
];

export const products = PRODUCTS;

/**
 * Raw blend wording a vendor may print, kept only so an offer can show its own
 * listing identity in evidence/details. These ids are never a filter, a menu
 * entry, a ranking input or a shopper-facing selection.
 */
export const STATED_VARIANTS = {
  classico: { id: 'classico', label: 'Classico', aliases: ['classico', 'classic', 'קלאסיקו', 'קלאסי'] },
  forte: { id: 'forte', label: 'Forte', aliases: ['forte', 'פורטה'] },
  ricco: { id: 'ricco', label: 'Ricco', aliases: ['ricco', 'ריקו'] },
  risveglio: { id: 'risveglio', label: 'Risveglio', aliases: ['risveglio', 'התעוררות'] },
  decaf: { id: 'decaf', label: 'Decaffeinated', aliases: ['decaf', 'decaffeinato', 'נטול קפאין', 'dek'] },
  unspecified: { id: 'unspecified', label: 'Variant not stated', aliases: [] }
};

const REJECT_FORMS = [
  // Hebrew is written without word characters, so the Hebrew bean words are matched
  // without \b (a bare \bפולי\b can never match).
  { id: 'beans', pattern: /\b(beans?|whole\s*bean|kaffeebohnen|bønner|boenner|grain)\b|פולי|פול\s*קפה/i, label: 'whole beans' },
  { id: 'capsules', pattern: /(capsul|קפסול|coffee\s*pods?|\bpods?\b|nespresso|dolce\s*gusto|senseo|a\s*modo\s*mio|\bese\b)/i, label: 'capsules or pods' },
  { id: 'machine', pattern: /(coffee\s*machin|מכונת\s*קפה|espresso\s*machine)/i, label: 'coffee machine' }
];

const GROUND_PATTERN = /(ground|טחון|macinato|molido|moulu|gemahlen|malet|filtro|filter\s*coffee)/i;
const BRAND_PATTERN = /(lavazza|לוואצה|לבאצה)/i;

/** Look up a tracked product by id. Retired ids return null by design. */
export function productById(id) {
  return PRODUCTS.find(product => product.id === id) ?? null;
}

/** Look up a retired line definition by id, or null when it was never tracked. */
export function retiredProductById(id) {
  return RETIRED_LINES.find(line => line.id === id) ?? null;
}

export function isRetiredProductId(id) {
  return retiredProductById(id) !== null;
}

/**
 * Resolve a requested product id to the tracked product.
 *
 * Unknown ids — including the retired Qualità Oro, Qualità Rossa and Suerte
 * ids that older shared links and bookmarks still carry — fall back to the
 * one tracked product. The retired definition is returned alongside so callers
 * (the Worker and the offline QA server) can say plainly what happened
 * instead of quietly showing a different product.
 */
export function resolveProductRequest(id) {
  const requested = id ?? null;
  if (!requested) return { product: PRODUCTS[0], retired: null, known: true };
  const product = productById(requested);
  if (product) return { product, retired: null, known: true };
  return { product: PRODUCTS[0], retired: retiredProductById(requested), known: false };
}

/**
 * Extract the blend wording a listing prints, for provenance only. An unstated
 * listing returns the `unspecified` definition; it is never relabelled as
 * Classico and never withheld from the comparison.
 */
export function variantOf(text) {
  const value = String(text || '').toLowerCase();
  for (const variant of Object.values(STATED_VARIANTS)) {
    if (variant.id === 'unspecified') continue;
    if (variant.aliases.some(alias => value.includes(alias))) return variant;
  }
  return STATED_VARIANTS.unspecified;
}

/**
 * Classify a listing name against the tracked product.
 *
 * Pass `productId` to require a specific tracked product (vendor adapters do
 * this for the offer they track); without it the first matching tracked product
 * is returned. Heavy HTML entities in vendor titles are decoded first, because
 * pages publish names such as "Lavazza Qualit&#224; Oro". Retired lines are
 * rejected with an explicit reason so historical pages can never re-enter the
 * comparison.
 */
export function classifyListing(text, { productId = null } = {}) {
  const value = decodeEntities(String(text ?? '')).toLowerCase();
  const reasons = [];
  const requestedProduct = productId ? productById(productId) : null;
  const requestedRetired = productId ? retiredProductById(productId) : null;
  const cheese = PRODUCTS.find(product => product.form === 'cottage_cheese');
  if (requestedProduct === cheese || (!productId && /tnuva|תנובה|cottage|קוטג/i.test(value))) {
    return classifyCottageCheese(value, cheese);
  }
  const candidates = requestedProduct ? [requestedProduct] : (productId ? [] : PRODUCTS.filter(product => product.form === 'ground'));

  if (productId && !requestedProduct && !requestedRetired) reasons.push(`unknown tracked product: ${productId}`);
  if (requestedRetired) reasons.push(`product line ${requestedRetired.line} was retired; only Lavazza Crema e Gusto is tracked`);
  if (!BRAND_PATTERN.test(value)) reasons.push('brand is not Lavazza');

  const retiredLine = RETIRED_LINES.find(line => line.patterns.some(pattern => pattern.test(value)));
  if (retiredLine) reasons.push(`listing belongs to the retired Lavazza ${retiredLine.line} line; only Lavazza Crema e Gusto is tracked`);

  const product = candidates.find(candidate => candidate.linePatterns.some(pattern => pattern.test(value)));
  if (!product && !retiredLine) {
    const wanted = productId ? `the tracked ${productById(productId)?.line ?? requestedRetired?.line ?? productId} line` : 'the tracked Lavazza Crema e Gusto line';
    reasons.push(`listing is not ${wanted}`);
  }

  const rejected = REJECT_FORMS.find(form => form.pattern.test(value));
  if (rejected) reasons.push(`listing is ${rejected.label}`);
  const ground = GROUND_PATTERN.test(value);
  if (!ground) reasons.push('listing does not state ground coffee');

  const variant = variantOf(value);
  const pack = parsePackSize(text);
  const matched = reasons.length === 0;

  return {
    matched,
    productId: matched ? product.id : null,
    productLine: matched ? product.line : null,
    variantId: variant.id,
    variantLabel: variant.label,
    form: matched ? 'ground' : (rejected ? rejected.id : 'unknown'),
    packGrams: pack.grams,
    packCount: pack.count,
    totalGrams: pack.grams != null ? pack.grams * pack.count : null,
    retiredLine: retiredLine ? { id: retiredLine.id, line: retiredLine.line } : null,
    reasons: matched
      ? (pack.grams == null ? ['pack weight not stated; offer can be shown but not normalized'] : [])
      : reasons
  };
}

function classifyCottageCheese(value, product) {
  const reasons = [];
  if (!/tnuva|תנובה/i.test(value)) reasons.push('brand is not Tnuva');
  if (!/cottage(?:\s+cheese)?|קוטג[׳'`]?/i.test(value)) reasons.push('listing does not state cottage cheese');
  const fat = [...value.matchAll(/(\d+(?:[.,]\d+)?)\s*%|%\s*(\d+(?:[.,]\d+)?)/g)]
    .map(match => Number((match[1] ?? match[2]).replace(',', '.')));
  if (fat.length !== 1 || fat[0] !== 5) reasons.push('listing must state exactly 5% fat');
  if (/olives?|garlic|dill|chives?|flavou?red|זיתים|שום|שמיר|בצל|מופחת\s*נתרן/i.test(value)) {
    reasons.push('listing is not plain cottage cheese');
  }
  const pack = parsePackSize(value);
  if (pack.grams !== 250) reasons.push('listing must state a 250 g tub');
  return {
    matched: reasons.length === 0,
    productId: reasons.length ? null : product.id,
    productLine: reasons.length ? null : product.line,
    form: reasons.length ? 'unknown' : product.form,
    packGrams: pack.grams,
    packCount: pack.count,
    totalGrams: pack.grams == null ? null : pack.grams * pack.count,
    retiredLine: null,
    reasons
  };
}

/** Resolve exact tub batches; preserve weight-based coffee links. */
export function productQuantity(product, { quantity = null, grams = null } = {}) {
  const config = product?.quantity;
  if (config?.mode !== 'units') return { targetQuantity: null, targetGrams: grams ?? config?.default ?? 500 };
  const requested = quantity == null && grams != null ? Number(grams) / config.unitGrams : Number(quantity);
  const count = config.options.includes(requested) ? requested : config.default;
  return { targetQuantity: count, targetGrams: count * config.unitGrams };
}

const OZ_TO_GRAMS = 28.349523125;

/** Parse grams per pack and pack count from a listing name. */
export function parsePackSize(text) {
  const value = decodeEntities(String(text ?? ''));
  let grams = null;

  const ounce = /(\d+(?:[.,]\d+)?)\s*(?:-|\s)?(?:ounce|oz)\b/i.exec(value);
  if (ounce) {
    grams = round(Math.round(parseDecimalValue(ounce[1]) * OZ_TO_GRAMS));
  }
  if (grams == null) {
    const gram = /(\d{2,4}(?:[.,]\d+)?)\s*(?:גרם|גר'|ג'|ג׳|gr\b|g\b|grams?\b|grs\b|gramos\b)/i.exec(value);
    if (gram) grams = round(parseDecimalValue(gram[1]));
  }
  if (grams == null) {
    const kg = /(\d+(?:[.,]\d+)?)\s*(?:kg|ק"ג|קג|קילו)/i.exec(value);
    if (kg) grams = round(parseDecimalValue(kg[1]) * 1000);
  }

  let count = 1;
  const packOf = /pack\s*of\s*(\d{1,3})/i.exec(value);
  const multiply = /(\d{1,3})\s*(?:x|×)\s*\d{2,4}\s*(?:גרם|gr\b|g\b|grams?\b|oz\b|ounce)/i.exec(value);
  const hebrewPacks = /(\d{1,3})\s*(?:אריזות|חבילות|יחידות)/.exec(value);
  if (packOf) count = Number(packOf[1]);
  else if (multiply) count = Number(multiply[1]);
  else if (hebrewPacks) count = Number(hebrewPacks[1]);
  else if (grams == null) {
    const bareCount = /^(\d{1,3})\s*(?:אריזות|חבילות)/.exec(value.trim());
    if (bareCount) count = Number(bareCount[1]);
  }
  if (!Number.isFinite(count) || count < 1 || count > 99) count = 1;
  return { grams, count };
}

function parseDecimalValue(raw) {
  return Number(String(raw).replace(',', '.'));
}

function round(value) {
  return Math.round(value * 10) / 10;
}
