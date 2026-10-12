// Reusable browser-research workflow (research/development tooling only).
//
// The interactive helper in scripts/browser-research.mjs keeps one real Chrome
// session alive; this module turns that session into a repeatable per-vendor
// recipe run:
//
//   - a recipe is vendor-specific navigation data: where the tracked listing is,
//     how to add whole packs to an anonymous cart, how to reach the public
//     estimator and which locality/postcode fields are permitted;
//   - the runner executes the steps, waits for recalculation and extracts the
//     displayed item subtotal, shipping line and final total;
//   - every run produces one record in the same evidence schema, whether it
//     ended in a quote, a public-flow blocker or a failure. Blocker records keep
//     the exact step and the rendered excerpt that stopped the flow.
//
// Evidence records are sanitized: URLs lose query strings/fragments (cart and
// session ids live there) and excerpts are collapsed and capped. The output is
// development evidence for human review; it is never imported by the Worker at
// runtime and never applied to the board automatically. A validated record can
// be promoted into a versioned policy in src/lib/policies.js by hand.

export const EVIDENCE_SCHEMA_VERSION = 1;

/**
 * Vendor recipes. `optional: true` steps are attempted and reported but do not
 * block the run; a failed required step stops that run with a blocker record.
 * `{placeholders}` are replaced from the run parameters.
 */
export const RECIPES = {
  pucks: {
    id: 'pucks',
    vendorId: 'pucks',
    vendorName: 'Pucks',
    productUrl: 'https://pucks.co.il/product/lavazza-crema-e-gusto-ground-coffee-250g',
    cartUrl: 'https://pucks.co.il/payment/request',
    allowedHosts: ['pucks.co.il', 'www.pucks.co.il'],
    packGrams: 250,
    parseTotals: parsePucksTotals,
    steps: [
      { action: 'goto', url: '{productUrl}' },
      { action: 'waitText', text: 'crema', timeout: 20000 },
      { action: 'clickText', text: 'הוסף לעגלה', optional: true },
      { action: 'clickText', text: 'הוספה לסל', optional: true },
      { action: 'goto', url: '{cartUrl}' },
      { action: 'waitText', text: 'סיכום', timeout: 20000, optional: true },
      { action: 'setQuantity', target: '{grams}', optional: true },
      { action: 'selectLabel', selector: 'select', label: '{locality}', optional: true },
      { action: 'fill', selector: 'input[name*="zip" i], input[name*="postal" i], input[id*="zip" i], input[id*="postal" i]', value: '{postcode}', optional: true },
      { action: 'sleep', ms: 1500 },
      { action: 'readTotals' }
    ]
  },
  coffeeman: {
    id: 'coffeeman',
    vendorId: 'coffeeman',
    vendorName: 'CoffeeMan (Amigo)',
    productUrl: 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico',
    cartUrl: 'https://www.coffeeman.co.il/checkout.asp',
    allowedHosts: ['www.coffeeman.co.il', 'coffeeman.co.il'],
    packGrams: 250,
    parseTotals: parseCoffeemanTotals,
    steps: [
      { action: 'goto', url: '{productUrl}' },
      { action: 'waitText', text: 'crema', timeout: 20000 },
      { action: 'clickText', text: 'הוסף לעגלה', optional: true },
      { action: 'clickText', text: 'הוספה לסל', optional: true },
      { action: 'goto', url: '{cartUrl}' },
      { action: 'waitText', text: 'סה"כ', timeout: 20000, optional: true },
      { action: 'setQuantity', target: '{grams}', optional: true },
      { action: 'selectLabel', selector: 'select', label: '{locality}', optional: true },
      { action: 'sleep', ms: 1500 },
      { action: 'readTotals' }
    ]
  },
  coffee4u: {
    id: 'coffee4u',
    vendorId: 'coffee4u',
    vendorName: 'Coffee4U',
    productUrl: 'https://www.coffee4u.co.il/product/lavazza-crema-e-gusto-250-gr-%D7%98%D7%97%D7%95%D7%9F',
    cartUrl: 'https://www.coffee4u.co.il/cart.asp',
    allowedHosts: ['www.coffee4u.co.il', 'coffee4u.co.il'],
    packGrams: 250,
    parseTotals: parseCoffee4uTotals,
    steps: [
      { action: 'goto', url: '{productUrl}' },
      { action: 'waitText', text: 'crema', timeout: 20000 },
      { action: 'clickText', text: 'הוסף לעגלה', optional: true },
      { action: 'clickText', text: 'הוספה לסל', optional: true },
      { action: 'goto', url: '{cartUrl}' },
      { action: 'waitText', text: 'סל', timeout: 20000, optional: true },
      { action: 'setQuantity', target: '{grams}', optional: true },
      { action: 'selectLabel', selector: 'select', label: '{locality}', optional: true },
      { action: 'sleep', ms: 1500 },
      { action: 'readTotals' }
    ]
  }
};

export function recipeById(id) {
  return RECIPES[id] ?? null;
}

export function listRecipes() {
  return Object.values(RECIPES).map(recipe => ({
    id: recipe.id,
    vendorId: recipe.vendorId,
    vendorName: recipe.vendorName,
    productUrl: recipe.productUrl,
    cartUrl: recipe.cartUrl,
    packGrams: recipe.packGrams,
    steps: recipe.steps.length
  }));
}

/** Substitute {placeholders} from the run parameters. */
export function expandValue(value, params) {
  return String(value).replace(/\{(\w+)\}/g, (match, key) => (params[key] != null ? String(params[key]) : match));
}

export function expandSteps(recipe, params) {
  return recipe.steps.map(step => {
    const expanded = {};
    for (const [key, value] of Object.entries(step)) {
      expanded[key] = typeof value === 'string' ? expandValue(value, params) : value;
    }
    return expanded;
  });
}

/** Strip query strings and fragments: cart/session identifiers live there. */
export function sanitizeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url).split(/[?#]/)[0];
  }
}

const TOKEN_LIKE = /\b[A-Za-z0-9_-]{24,}\b/g;
const SESSION_LIKE = /\b(?:sess(?:ion)?|sid|token|cart_?id|PHPSESSID|JSESSIONID|cf_clearance)\b\s*[=:]\s*\S+/gi;

/** Collapse whitespace, drop session/token-like runs and cap the excerpt length. */
export function sanitizeExcerpt(text, max = 600) {
  const value = String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(SESSION_LIKE, '[redacted]')
    .replace(TOKEN_LIKE, '[redacted]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function toAmount(value) {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function freeLine(value) {
  return /חינם|free/i.test(String(value ?? ''));
}

/** Pucks summary: סכום ביניים / משלוח / סך הכל and the free-shipping sentence. */
export function parsePucksTotals(text) {
  const value = String(text ?? '');
  const subtotal = /סכום ביניים[^\d]{0,12}([\d.,]+)/.exec(value)?.[1] ?? null;
  const shippingMatch = /משלוח[^\S\n]*(?:עד הבית[^\S\n]*)?([\d.,]+|חינם|free)/i.exec(value);
  const total = /סך הכל[^\d]{0,12}([\d.,]+)/.exec(value)?.[1] ?? null;
  const threshold = /משלוח חינם בהזמנה מעל\s*([\d.,]+)/.exec(value)?.[1] ?? null;
  const shipping = shippingMatch?.[1] ?? null;
  return {
    itemSubtotalIls: toAmount(subtotal),
    shippingIls: freeLine(shipping) ? 0 : toAmount(shipping),
    shippingLabel: freeLine(shipping) ? 'free' : shipping,
    deliveredTotalIls: toAmount(total),
    freeThresholdIls: toAmount(threshold),
    freeThresholdText: threshold ? `Free shipping above ₪${toAmount(threshold)}` : null,
    currency: 'ILS'
  };
}

/** CoffeeMan summary: סכום ביניים / משלוח / סה"כ. */
export function parseCoffeemanTotals(text) {
  const value = String(text ?? '');
  const subtotal = /סכום ביניים[^\d]{0,12}([\d.,]+)/.exec(value)?.[1] ?? null;
  const shippingMatch = /(?:משלוח|דמי משלוח)[^\S\n]*([\d.,]+|חינם|free)/i.exec(value);
  const total = /(?:סה"כ|סך הכל)[^\d]{0,12}([\d.,]+)/.exec(value)?.[1] ?? null;
  const shipping = shippingMatch?.[1] ?? null;
  return {
    itemSubtotalIls: toAmount(subtotal),
    shippingIls: freeLine(shipping) ? 0 : toAmount(shipping),
    shippingLabel: freeLine(shipping) ? 'free' : shipping,
    deliveredTotalIls: toAmount(total),
    freeThresholdIls: null,
    freeThresholdText: null,
    currency: 'ILS'
  };
}

/** Coffee4U summary: item total / delivery / final total. */
export function parseCoffee4uTotals(text) {
  const value = String(text ?? '');
  const subtotal = /(?:סכום ביניים|סה"כ מוצרים)[^\d]{0,12}([\d.,]+)/.exec(value)?.[1] ?? null;
  const shippingMatch = /(?:משלוח|דמי משלוח|הובלה)[^\S\n]*([\d.,]+|חינם|free)/i.exec(value);
  const total = /(?:סה"כ לתשלום|סך הכל)[^\d]{0,12}([\d.,]+)/.exec(value)?.[1] ?? null;
  const shipping = shippingMatch?.[1] ?? null;
  return {
    itemSubtotalIls: toAmount(subtotal),
    shippingIls: freeLine(shipping) ? 0 : toAmount(shipping),
    shippingLabel: freeLine(shipping) ? 'free' : shipping,
    deliveredTotalIls: toAmount(total),
    freeThresholdIls: null,
    freeThresholdText: null,
    currency: 'ILS'
  };
}

/**
 * Build one common evidence record from a recipe run. `status` is one of
 * `quoted` (displayed item subtotal, shipping and final total agree),
 * `partial` (a rate was read but not all three values agree),
 * `blocked` (the public flow could not produce a quote; `blocker` says where)
 * or `failed` (tooling/step error).
 */
export function buildEvidenceRecord({
  recipe,
  params = {},
  status,
  totals = {},
  pageUrl = null,
  blocker = null,
  steps = [],
  actualPacks = null,
  now = Date.now()
} = {}) {
  const grams = Number(params.grams) > 0 ? Number(params.grams) : recipe.packGrams;
  const requestedPacks = Math.max(1, Math.ceil(grams / recipe.packGrams));
  const packs = Number.isFinite(actualPacks) && actualPacks > 0 ? actualPacks : requestedPacks;
  const arithmeticOk = totals.itemSubtotalIls != null && totals.shippingIls != null && totals.deliveredTotalIls != null
    && Math.abs(totals.itemSubtotalIls + totals.shippingIls - totals.deliveredTotalIls) <= 0.05;
  const resolvedStatus = status === 'quoted' && !arithmeticOk ? 'partial' : status;
  return {
    kind: 'browser-research-quote',
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    vendorId: recipe.vendorId,
    vendorName: recipe.vendorName,
    productUrl: sanitizeUrl(recipe.productUrl),
    cartUrl: sanitizeUrl(pageUrl ?? recipe.cartUrl),
    pack: `${packs} × ${recipe.packGrams} g = ${packs * recipe.packGrams} g`,
    requestedGrams: grams,
    observedPacks: Number.isFinite(actualPacks) ? actualPacks : null,
    locality: params.locality ?? null,
    postcode: params.postcode ?? null,
    service: params.service ?? null,
    status: resolvedStatus,
    itemSubtotalIls: totals.itemSubtotalIls ?? null,
    shippingIls: totals.shippingIls ?? null,
    shippingLabel: totals.shippingLabel ?? null,
    deliveredTotalIls: totals.deliveredTotalIls ?? null,
    freeThresholdIls: totals.freeThresholdIls ?? null,
    freeThresholdText: totals.freeThresholdText ?? null,
    currency: totals.currency ?? 'ILS',
    arithmeticOk,
    qualification: totals.qualification ?? null,
    blocker: blocker ? sanitizeExcerpt(blocker, 300) : null,
    excerpt: totals.excerpt ? sanitizeExcerpt(totals.excerpt) : null,
    steps: steps.map(step => ({ step: step.step, ok: step.ok, optional: Boolean(step.optional), error: step.error ? sanitizeExcerpt(step.error, 200) : null })),
    observedAt: new Date(now).toISOString(),
    note: 'Anonymous cart quote recorded by interactive browser research. No order, payment, login, account or street address was involved. Cart/session identifiers are stripped from this record.'
  };
}

/** Structural validation of one evidence record before it can inform a policy. */
export function validateEvidence(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return { ok: false, errors: ['record is not an object'] };
  if (record.kind !== 'browser-research-quote') errors.push('kind must be browser-research-quote');
  if (record.schemaVersion !== EVIDENCE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${EVIDENCE_SCHEMA_VERSION}`);
  if (!record.vendorId) errors.push('vendorId is required');
  if (!['quoted', 'partial', 'blocked', 'failed'].includes(record.status)) errors.push('status is unknown');
  if (!record.observedAt || Number.isNaN(Date.parse(record.observedAt))) errors.push('observedAt must be an ISO date');
  for (const key of ['itemSubtotalIls', 'shippingIls', 'deliveredTotalIls']) {
    const value = record[key];
    if (value != null && !Number.isFinite(value)) errors.push(`${key} must be a number or null`);
  }
  if (record.status === 'quoted') {
    if (record.itemSubtotalIls == null || record.shippingIls == null || record.deliveredTotalIls == null) {
      errors.push('a quoted record needs item subtotal, shipping and delivered total');
    }
    if (record.arithmeticOk !== true) errors.push('a quoted record must have consistent arithmetic');
    if (!record.locality) errors.push('a quoted record must name the destination it was observed for');
  }
  if (record.status === 'blocked' && !record.blocker) errors.push('a blocked record must explain the blocker');
  if (record.blocker && /[?&](?:sess|session|token|sid|cart_id|PHPSESSID)=/i.test(record.blocker)) {
    errors.push('blocker contains a session-like parameter');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The exact steps a runner must provide. Kept as a documented interface so the
 * WebDriver adapter in scripts/browser-research.mjs stays the only browser code.
 */
export const DRIVER_INTERFACE = [
  'goto(url)',
  'clickText(text)',
  'selectLabel(selector, label)',
  'fill(selector, value)',
  'setQuantity(grams)',
  'waitText(text, timeoutMs)',
  'sleep(ms)',
  'getText()',
  'currentUrl()'
];

/**
 * Execute one recipe against a driver and return a sanitized evidence record.
 * A failed required step stops the run with `blocked`; optional steps are
 * reported but skipped. Extraction happens after the steps so a blocker still
 * captures what the page displayed.
 */
export async function runRecipe({ recipe, driver, params = {}, now = Date.now(), logger = null } = {}) {
  const runParams = { packGrams: recipe.packGrams, ...params };
  const steps = [];
  let status = 'quoted';
  let blocker = null;
  let actualPacks = null;
  const recordStep = (step, ok, error) => {
    steps.push({ step: step.action, ok, optional: Boolean(step.optional), error: error ? String(error.message ?? error) : null });
  };
  for (const step of expandSteps(recipe, runParams)) {
    try {
      const result = await executeStep(step, driver, runParams);
      if (step.action === 'setQuantity' && Number.isFinite(result)) actualPacks = result;
      recordStep(step, true);
    } catch (error) {
      recordStep(step, false, error);
      if (step.optional) continue;
      status = 'blocked';
      blocker = `Required step "${step.action}" failed: ${error?.message ?? error}`;
      break;
    }
  }
  let text = '';
  try {
    text = await driver.getText();
  } catch (error) {
    logger?.warn?.(`research: could not read page text: ${error?.message ?? error}`);
    if (status === 'quoted') {
      status = 'failed';
      blocker = `Could not read the rendered page: ${error?.message ?? error}`;
    }
  }
  let pageUrl = null;
  try {
    pageUrl = await driver.currentUrl();
  } catch {
    pageUrl = null;
  }
  let totals = {};
  if (typeof recipe.parseTotals === 'function') {
    totals = recipe.parseTotals(text) ?? {};
  }
  if (status === 'quoted' && totals.shippingIls == null) {
    status = 'blocked';
    blocker = blocker ?? 'The rendered flow did not display a shipping line for this quantity and destination.';
  }
  if (status === 'quoted' && totals.itemSubtotalIls == null) {
    status = 'blocked';
    blocker = blocker ?? 'The rendered flow did not display an item subtotal.';
  }
  if (status === 'quoted' && totals.itemSubtotalIls === 0) {
    status = 'blocked';
    blocker = blocker ?? 'The cart appears empty: no item subtotal was displayed for the tracked product.';
  }
  // A quote read without a verified whole-pack quantity is not a quoted cart:
  // keep it visible as partial evidence instead of attributing it to a cart
  // size that was never confirmed.
  const hasQuantityStep = recipe.steps.some(step => step.action === 'setQuantity');
  let qualification = totals.qualification ?? null;
  if (status === 'quoted' && hasQuantityStep && !Number.isFinite(actualPacks)) {
    status = 'partial';
    qualification = [qualification, 'Cart quantity was not verified by the recipe, so the pack size is the requested target, not a confirmed cart.'].filter(Boolean).join(' ');
  }
  return buildEvidenceRecord({
    recipe,
    params: runParams,
    status,
    totals: { ...totals, qualification, excerpt: text.slice(0, 1200) },
    pageUrl,
    blocker,
    steps,
    actualPacks,
    now
  });
}

async function executeStep(step, driver, params) {
  switch (step.action) {
    case 'goto':
      return driver.goto(step.url);
    case 'clickText':
      return driver.clickText(step.text);
    case 'selectLabel':
      return driver.selectLabel(step.selector, step.label);
    case 'fill':
      return driver.fill(step.selector, step.value);
    case 'setQuantity':
      return driver.setQuantity(Number(step.target) || params.grams, params.packGrams);
    case 'waitText':
      return driver.waitText(step.text, step.timeout ?? 15000);
    case 'sleep':
      return driver.sleep(step.ms ?? 1000);
    case 'readTotals':
      return undefined;
    default:
      throw new Error(`unknown recipe action "${step.action}"`);
  }
}
