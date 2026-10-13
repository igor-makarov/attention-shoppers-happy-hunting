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
      // Pucks uses a stepper on the product page; set the whole-pack quantity
      // before adding so the cart starts with the researched cart size.
      { action: 'setQuantity', target: '{grams}', optional: true },
      { action: 'clickText', text: 'הוסף לעגלה', optional: true },
      { action: 'clickText', text: 'הוספה לסל', optional: true },
      // The estimator keeps the anonymous cart only when it is reached through
      // the cart widget's checkout link; direct navigation loses the cart.
      { action: 'clickSelector', selectors: ['a.slide_cart__btn-checkout', 'a[href*="payment/request"]'], optional: true },
      { action: 'gotoUnlessText', url: '{cartUrl}', text: 'דרכי משלוח', optional: true },
      { action: 'waitText', text: 'דרכי משלוח', timeout: 20000, optional: true },
      { action: 'setQuantity', target: '{grams}', optional: true },
      // The estimator's destination fields are text inputs (ישוב / מיקוד), not a
      // select: the language dropdown is the only <select> on the page, so a
      // generic select step would silently record a locality that was never
      // set. Fill the named fields and require them, so a run that cannot set
      // the destination is blocked instead of attributed to it.
      { action: 'fill', selector: '#city', value: '{locality}', optional: false, verifies: 'destination' },
      { action: 'fill', selector: '#zip', value: '{postcode}', optional: false, verifies: 'destination' },
      // The ₪30 home-delivery fee reaches the summary only after the delivery
      // card is selected, so the recipe must choose the actual method; the
      // successful step also confirms which method the quote belongs to.
      { action: 'clickAnyText', texts: ['משלוח עד הבית'], optional: false, confirmsService: 'home_delivery' },
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
      // The live add-to-cart control is an anchor labelled "קנה עכשיו" whose
      // onclick calls the site's own addme_cart; the older labels stay listed
      // for page variants, but only one control matches. A native WebDriver
      // click on it is intercepted by a page overlay, so clickAnyText falls
      // back to the element's own click() (recorded in the step detail).
      { action: 'clickAnyText', texts: ['קנה עכשיו', 'הוסף לעגלה', 'הוספה לסל'], optional: false },
      { action: 'goto', url: '{cartUrl}', optional: true },
      { action: 'waitText', text: 'סה"כ', timeout: 20000, optional: true },
      { action: 'setQuantity', target: '{grams}', optional: true },
      // The checkout exposes the home-delivery locality list as a closed select
      // (#hfd_cities, 264 localities observed 2026-10-13). Selecting the
      // requested locality is required, so a run that cannot set the
      // destination is blocked instead of attributed to it.
      { action: 'selectLabel', selector: '#hfd_cities', label: '{locality}', optional: false, verifies: 'destination' },
      // The published home-courier method is an option in #delivery (₪25.00);
      // the successful step confirms the method the displayed rate belongs to.
      { action: 'selectLabel', selector: '#delivery', label: 'משלוח לבית הלקוח', optional: false, confirmsService: 'home_delivery' },
      { action: 'sleep', ms: 1500 },
      { action: 'readTotals' }
    ]
  },
  coffee4u: {
    id: 'coffee4u',
    vendorId: 'coffee4u',
    vendorName: 'Coffee4U',
    productUrl: 'https://www.coffee4u.co.il/product/lavazza-crema-e-gusto-250-gr-%D7%98%D7%97%D7%95%D7%9F',
    cartUrl: 'https://www.coffee4u.co.il/Checkout.asp',
    allowedHosts: ['www.coffee4u.co.il', 'coffee4u.co.il'],
    packGrams: 250,
    parseTotals: parseCoffee4uTotals,
    steps: [
      { action: 'goto', url: '{productUrl}' },
      { action: 'waitText', text: 'crema', timeout: 20000 },
      // The live add-to-cart control is a#Product_AddToCart_Button labelled
      // "הוסף לסל" (not "הוספה לסל"), and clicking it navigates straight to the
      // public checkout estimator. A run that cannot add the item is blocked
      // with the exact step instead of quoting an empty cart.
      { action: 'clickAnyText', texts: ['הוסף לסל', 'הוספה לסל'], optional: false },
      { action: 'gotoUnlessText', url: '{cartUrl}', text: 'שיטת משלוח', optional: true },
      { action: 'waitText', text: 'שיטת משלוח', timeout: 20000, optional: true },
      { action: 'setQuantity', target: '{grams}', optional: true },
      // Destination: the checkout renders one closed locality list
      // (select#u_city, 1,269 options on 2026-10-12). It is a required step so a
      // run that cannot set the locality is blocked instead of attributed to it.
      { action: 'selectLabel', selector: '#u_city', label: '{locality}', optional: false, verifies: 'destination' },
      // The delivery methods are a select (#delivery): pickup point ₪15,
      // door-to-door courier ₪30, self-pickup ₪0. The ranked method is the
      // door-to-door courier; the fee reaches the summary only after it is
      // selected, so the step is required. The successful step also confirms
      // the method the displayed shipping line belongs to.
      { action: 'selectLabel', selector: '#delivery', label: 'שליחות מדלת', optional: false, confirmsService: 'home_delivery' },
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
  // The free-shipping sentence is not a charged shipping line: strip it before
  // looking for the summary fee, otherwise its "חינם" would be read as free
  // delivery on a cart that is actually below the threshold.
  const withoutThreshold = value
    .replace(/משלוח חינם בהזמנה מעל[^\n]*/g, '')
    .replace(/free shipping (?:above|over)[^\n]*/gi, '');
  const subtotal = /סכום ביניים[^\d]{0,12}([\d.,]+)/.exec(withoutThreshold)?.[1] ?? null;
  // The rendered summary prints the label and the amount on separate lines
  // ("משלוח" then "30 ₪"). Only a bare "משלוח" summary label counts: the
  // delivery-methods card ("משלוח עד הבית") and the "calculated at payment"
  // disclaimer must not be read as the applied charge.
  const shippingMatch = /(?:^|\n)[ \t]*משלוח[ \t]*\n[ \t]*([\d.,]+|חינם|free)/i.exec(withoutThreshold)
    ?? /משלוח[^\S\n]+([\d.,]+|חינם|free)/i.exec(withoutThreshold);
  const total = /סך הכל[^\d]{0,12}([\d.,]+)/.exec(withoutThreshold)?.[1] ?? null;
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

/** Coffee4U summary: product-line total, delivery line and final total. */
export function parseCoffee4uTotals(text) {
  const value = String(text ?? '');
  // The item subtotal is the amount printed on the tracked product line
  // ("Lavazza Crema e gusto 250 gr טחון" then "₪ 76"); the checkout has no
  // separate "סכום ביניים" label. The rendered label and amount can sit on two
  // lines, so the product-line match may cross one line break (bounded).
  const subtotal = /(?:Lavazza\s+)?Crema\s*e\s*gusto[\s\S]{0,80}?₪\s*([\d.,]+)/i.exec(value)?.[1] ?? null;
  // After a method is selected the summary shows a bare "משלוח" label and then
  // the amount ("₪30"), often on the next line; before that the method card
  // shows option prices ("... - 15 ₪"), which must not be read as the applied
  // charge. The shekel sign sits before the amount on this page. A bare
  // "משלוח" summary line is required so the method-card sentences cannot match.
  const shippingMatch = /(?:^|\n)[ \t]*(?:משלוח|דמי משלוח|הובלה)[ \t]*\n[ \t]*₪\s*([\d.,]+)/i.exec(value)
    ?? /(?:^|\n)[ \t]*(?:משלוח|דמי משלוח|הובלה)[ \t]*₪\s*([\d.,]+)/i.exec(value)
    ?? /(?:^|\n)[ \t]*(?:משלוח|דמי משלוח|הובלה)[ \t]*\n[ \t]*([\d.,]+|חינם|free)/i.exec(value);
  const total = /(?:סה"כ לתשלום|סך הכל|סכום כולל מע["״]?מ)[^\d]{0,12}([\d.,]+)/.exec(value)?.[1] ?? null;
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
  destinationVerified = null,
  service = null,
  serviceConfirmed = null,
  now = Date.now()
} = {}) {
  const grams = Number(params.grams) > 0 ? Number(params.grams) : recipe.packGrams;
  const requestedPacks = Math.max(1, Math.ceil(grams / recipe.packGrams));
  const packs = Number.isFinite(actualPacks) && actualPacks > 0 ? actualPacks : requestedPacks;
  const arithmeticOk = totals.itemSubtotalIls != null && totals.shippingIls != null && totals.deliveredTotalIls != null
    && Math.abs(totals.itemSubtotalIls + totals.shippingIls - totals.deliveredTotalIls) <= 0.05;
  const resolvedStatus = status === 'quoted' && !arithmeticOk ? 'partial' : status;
  // A requested locality/postcode that the recipe could not set on the page must
  // not read as a destination quote: keep the requested values but say plainly
  // that the destination was not verified.
  const destinationNote = destinationVerified === false && (params.locality || params.postcode)
    ? 'The destination (locality/postcode) was requested but could not be verified on the rendered page, so the displayed quote is not confirmed for that destination.'
    : null;
  // The displayed shipping line belongs to a named method only when the recipe's
  // method-selection step succeeded on the page; otherwise the record must say
  // the method is unconfirmed instead of implying one.
  const serviceNote = serviceConfirmed === false
    ? 'The delivery method could not be confirmed on the rendered page, so the displayed shipping line is not attributed to a named method.'
    : null;
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
    destinationVerified: destinationVerified === true ? true : destinationVerified === false ? false : null,
    service: service ?? null,
    serviceConfirmed: serviceConfirmed === true ? true : serviceConfirmed === false ? false : null,
    status: resolvedStatus,
    itemSubtotalIls: totals.itemSubtotalIls ?? null,
    shippingIls: totals.shippingIls ?? null,
    shippingLabel: totals.shippingLabel ?? null,
    deliveredTotalIls: totals.deliveredTotalIls ?? null,
    freeThresholdIls: totals.freeThresholdIls ?? null,
    freeThresholdText: totals.freeThresholdText ?? null,
    currency: totals.currency ?? 'ILS',
    arithmeticOk,
    qualification: [totals.qualification, destinationNote, serviceNote].filter(Boolean).join(' ') || null,
    blocker: blocker ? sanitizeExcerpt(blocker, 300) : null,
    excerpt: totals.excerpt ? sanitizeExcerpt(totals.excerpt) : null,
    steps: steps.map(step => ({ step: step.step, ok: step.ok, optional: Boolean(step.optional), error: step.error ? sanitizeExcerpt(step.error, 200) : null, detail: step.detail ? sanitizeExcerpt(step.detail, 120) : null })),
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
    if (record.destinationVerified === false && !/destination .*could not be verified/i.test(record.qualification ?? '')) {
      errors.push('a quoted record with an unverified destination must say so in qualification');
    }
  }
  // The method a shipping line belongs to is part of the reusable evidence: a
  // record may only claim a confirmed method when the page step selected it,
  // and a quoted record that could not confirm the method must say so.
  if (record.service != null && typeof record.service !== 'string') errors.push('service must be a string or null');
  if (record.serviceConfirmed === true && !record.service) errors.push('a confirmed service must record the method name');
  if (record.serviceConfirmed === false && record.status === 'quoted' && !/method .*could not be confirmed/i.test(record.qualification ?? '')) {
    errors.push('a quoted record with an unconfirmed method must say so in qualification');
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
  'gotoUnlessText(url, text)',
  'clickText(text)',
  'clickAnyText(texts)',
  'clickSelector(selectors)',
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
  // Recipe URLs are part of the run parameters: a placeholder left unexpanded
  // would navigate to the literal "{productUrl}" instead of the vendor page.
  const runParams = { packGrams: recipe.packGrams, productUrl: recipe.productUrl, cartUrl: recipe.cartUrl, ...params };
  const steps = [];
  let status = 'quoted';
  let blocker = null;
  let actualPacks = null;
  // Destination verification: a step marked `verifies: 'destination'` must set
  // the requested locality/postcode and the page must hold it afterwards. The
  // flag stays null when a recipe has no destination steps, and turns false as
  // soon as one fails or sets something else, so the evidence record can say the
  // quote is not confirmed for the requested destination.
  let destinationVerified = null;
  // The delivery method is confirmed only by a successful method-selection step
  // on the rendered page; a requested parameter alone is never a confirmation.
  let confirmedService = null;
  let serviceStepSeen = false;
  const isDestinationStep = step => step.verifies === 'destination';
  const destinationMatches = (step, result) => {
    const expected = step.action === 'fill' ? step.value : step.label;
    const actual = step.action === 'fill' ? result?.value : result;
    if (expected == null) return true;
    return actual != null && String(actual).includes(String(expected));
  };
  const recordStep = (step, ok, error, detail = null) => {
    steps.push({
      step: step.action,
      ok,
      optional: Boolean(step.optional),
      error: error ? String(error.message ?? error) : null,
      detail: detail ? sanitizeExcerpt(String(detail), 120) : null
    });
  };
  for (const step of expandSteps(recipe, runParams)) {
    try {
      const result = await executeStep(step, driver, runParams);
      if (step.action === 'setQuantity' && Number.isFinite(result)) actualPacks = result;
      if (step.confirmsService) {
        serviceStepSeen = true;
        confirmedService = step.confirmsService;
      }
      if (isDestinationStep(step)) {
        if (!destinationMatches(step, result)) {
          const actual = step.action === 'fill' ? result?.value ?? null : result ?? null;
          const expected = step.action === 'fill' ? step.value : step.label;
          throw new Error(`destination verification failed: the page holds ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`);
        }
        destinationVerified = destinationVerified === false ? false : true;
      }
      recordStep(step, true, null, stepDetail(step, result));
    } catch (error) {
      recordStep(step, false, error);
      if (step.confirmsService) {
        serviceStepSeen = true;
        confirmedService = null;
      }
      if (isDestinationStep(step)) destinationVerified = false;
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
  // A cart that does not hold the requested number of packs must not be
  // recorded as a quote for the requested quantity.
  const requestedPacks = Math.max(1, Math.ceil((Number(runParams.grams) || recipe.packGrams) / recipe.packGrams));
  if (status === 'quoted' && Number.isFinite(actualPacks) && actualPacks !== requestedPacks) {
    status = 'partial';
    qualification = [qualification, `The page held ${actualPacks} pack(s), not the requested ${requestedPacks}, so the displayed amounts are recorded for ${actualPacks} pack(s).`].filter(Boolean).join(' ');
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
    destinationVerified,
    service: confirmedService,
    serviceConfirmed: serviceStepSeen ? confirmedService != null : null,
    now
  });
}

async function executeStep(step, driver, params) {
  switch (step.action) {
    case 'goto':
      return driver.goto(step.url);
    case 'gotoUnlessText':
      return driver.gotoUnlessText(step.url, step.text);
    case 'clickText':
      return driver.clickText(step.text);
    case 'clickAnyText':
      return driver.clickAnyText(step.texts ?? [step.text]);
    case 'clickSelector':
      return driver.clickSelector(step.selectors ?? [step.selector]);
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

/** Short, sanitized note about what a step actually did, for the evidence record. */
function stepDetail(step, result) {
  if (step.action === 'clickAnyText') return result ? `clicked: ${result}` : null;
  if (step.action === 'clickSelector') return result ? `clicked: ${result}` : null;
  if (step.action === 'gotoUnlessText') return result === 'skipped' ? 'already on the estimator page' : 'navigated';
  if (step.action === 'setQuantity' && Number.isFinite(result)) return `${result} pack(s) in cart`;
  // A fill step records the value the page actually holds after typing, so a
  // locality/postcode in the evidence is a verified field value, not just the
  // requested parameter.
  if (step.action === 'fill' && result && typeof result === 'object') return `${result.selector}=${result.value ?? ''}`;
  if (step.action === 'selectLabel' && result) return `selected: ${result}`;
  return null;
}
