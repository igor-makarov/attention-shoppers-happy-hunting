// Tracked products and strict listing classification.
//
// The board compares one product at a time. Classification is deliberately
// conservative: a listing that cannot be tied to a tracked product (Lavazza
// ground coffee in a vacuum brick) is rejected instead of being merged into
// the board. Blend variants (Classico, Forte, ...) and pack sizes stay
// separate so different products are never mixed into one comparison.

import { decodeEntities } from './lib/text.js';

const LINE_PATTERNS = {
  'lavazza-crema-e-gusto': [
    /crema\s*(?:e|&|and|-)?\s*gusto/i,
    /קרמה\s*(?:אה\s*)?גוסטו/
  ],
  'lavazza-qualita-oro': [
    /qualit[aàáy]\s*oro/i,
    /qualit[aà]\s*oro/i,
    /קוואליטה\s*אורו/,
    /קווליטה\s*אורו/
  ]
};

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
    notes: 'Ground coffee only. Beans, capsules, pods and machines are rejected. Classico, Forte, Ricco, Risveglio and decaf remain separate variants.'
  },
  {
    id: 'lavazza-qualita-oro-vacuum-ground',
    brand: 'Lavazza',
    line: 'Qualità Oro',
    form: 'ground',
    packaging: 'vacuum brick',
    targetMarket: 'IL',
    defaultVariant: 'unspecified',
    variants: ['unspecified'],
    linePatterns: LINE_PATTERNS['lavazza-qualita-oro'],
    notes: 'Second tracked product: Lavazza Qualità Oro ground coffee in a vacuum brick. The line publishes no blend variant, so listings are stored as "Variant not stated"; beans, capsules and multipacks of another line stay separate.'
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

/** Look up a tracked product by id. */
export function productById(id) {
  return PRODUCTS.find(product => product.id === id) ?? null;
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
 * Classify a listing name against the tracked products.
 *
 * Pass `productId` to require a specific tracked product (vendor adapters do
 * this for the offer they track); without it the first matching tracked product
 * is returned. Heavy HTML entities in vendor titles are decoded first, because
 * pages publish names such as "Lavazza Qualit&#224; Oro".
 */
export function classifyListing(text, { productId = null } = {}) {
  const value = decodeEntities(String(text ?? '')).toLowerCase();
  const reasons = [];
  const candidates = productId ? [productById(productId)].filter(Boolean) : PRODUCTS;

  if (productId && candidates.length === 0) {
    reasons.push(`unknown tracked product: ${productId}`);
  }
  if (!BRAND_PATTERN.test(value)) reasons.push('brand is not Lavazza');

  const product = candidates.find(candidate => candidate.linePatterns.some(pattern => pattern.test(value)));
  if (!product) {
    const wanted = productId ? `the tracked ${productById(productId)?.line ?? productId} line` : 'a tracked Lavazza product line';
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
