// Tracked product and strict listing classification.
//
// Scope (owner correction, 2026-10-12): exactly one product is tracked —
// Lavazza Crema e Gusto ground coffee in a vacuum brick. Qualità Oro,
// Qualità Rossa, Suerte and every other Lavazza line are retired: their names
// survive only as tombstones below, so a listing, a parser page or an old
// ?product= URL can never silently re-enter the board. Re-adding a product
// line requires an explicit new owner instruction.
//
// Classification stays conservative: a listing that cannot be tied to the
// tracked product is rejected instead of being merged into the board. Blend
// variants (Classico, Forte, ...) and pack sizes stay separate so different
// products are never mixed into one comparison.

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
    defaultVariant: 'classico',
    variants: ['classico', 'forte', 'ricco', 'risveglio', 'decaf', 'unspecified'],
    linePatterns: LINE_PATTERNS['lavazza-crema-e-gusto'],
    notes: 'The only tracked product line (owner correction, 2026-10-12). Ground coffee in a vacuum brick; Classico, Forte, Ricco, Risveglio and decaf remain separate variants, and pack sizes and multipacks stay separate. Beans, capsules, pods and every other Lavazza product line are rejected.'
  }
];

export const products = PRODUCTS;

export const VARIANTS = {
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

/** Look up a blend variant definition by id. */
export function variantById(id) {
  return VARIANTS[id] ?? VARIANTS.unspecified;
}

/**
 * Resolve a requested variant id for a product. An id that is not a tracked
 * variant at all (a typo or an old shared link) falls back to the product's
 * default, exactly like an unknown product or destination. A real variant of
 * another line is returned unchanged so it stays strict and matches no offer on
 * this product's board instead of being silently rewritten.
 */
export function resolveVariantId(product, requested) {
  return requested && Object.hasOwn(VARIANTS, requested) ? requested : product.defaultVariant;
}

/** Variants a product can be compared under, with their display labels. */
export function variantCatalog(product = PRODUCTS[0]) {
  return (product?.variants ?? ['unspecified']).map(id => ({ id, label: variantById(id).label }));
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
  const candidates = requestedProduct ? [requestedProduct] : (productId ? [] : PRODUCTS);

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

export function variantOf(text) {
  const value = String(text || '').toLowerCase();
  for (const variant of Object.values(VARIANTS)) {
    if (variant.id === 'unspecified') continue;
    if (variant.aliases.some(alias => value.includes(alias))) return variant;
  }
  return VARIANTS.unspecified;
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
