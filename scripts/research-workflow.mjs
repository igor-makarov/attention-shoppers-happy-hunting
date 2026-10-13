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
//     displayed pre-discount item subtotal, applied discount(s), paid item
//     total, selected named service, shipping evidence source and final total;
//   - every run produces one record in the same evidence schema, whether it
//     ended in a quote, a public-flow blocker or a failure. Blocker records keep
//     the exact step and the rendered excerpt that stopped the flow.
//
// Evidence records are sanitized: URLs lose query strings/fragments (cart and
// session ids live there) and excerpts are collapsed and capped. The output is
// development evidence for human review; it is never imported by the Worker at
// runtime and never applied to the board automatically. A validated record can
// be promoted into a versioned policy in src/lib/policies.js by hand.

export const EVIDENCE_SCHEMA_VERSION = 3;

// Version 1 records predate the discount/method-evidence fields; version 2
// records predate the observed-cart-identity fields. Both keep validating under
// their own rules and stay valid historical evidence: their records never
// claimed an observed cart identity, and nothing here relabels them.
export const SUPPORTED_EVIDENCE_SCHEMA_VERSIONS = [1, 2, 3];

// The single, 4-pack and 8-pack CoffeeMan listings share one public checkout
// flow; these steps are the shared navigation data so each listing's recipe
// differs only by product URL and pack size.
const COFFEEMAN_CHECKOUT_STEPS = [
  { action: 'goto', url: '{productUrl}' },
  { action: 'waitText', text: 'crema', timeout: 20000 },
  // The live add-to-cart control is an anchor labelled "קנה עכשיו" whose
  // onclick calls the site's own addme_cart; the older labels stay listed
  // for page variants, but only one control matches. A native WebDriver
  // click on it is intercepted by a page overlay, so clickAnyText falls
  // back to the element's own click() (recorded in the step detail).
  { action: 'clickAnyText', texts: ['קנה עכשיו', 'הוסף לעגלה', 'הוספה לסל'], optional: false },
  { action: 'goto', url: '{cartUrl}', optional: true },
  // The checkout summary label is "סכום כולל מע\"מ" (the cart page prints
  // "סה\"כ"); wait for the checkout summary so the totals are read after the
  // page has rendered them.
  { action: 'waitText', text: 'סכום כולל', timeout: 20000, optional: true },
  { action: 'setQuantity', target: '{grams}', optional: true },
  // A quantity change re-renders the checkout form asynchronously and can reset
  // the locality/method controls after they were set, so let the cart settle
  // before the destination and method steps. The runner also re-verifies the
  // destination immediately before reading the totals.
  { action: 'sleep', ms: 5000 },
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
];

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
    sku: 'Lav69',
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
      // Let the estimator's asynchronous recalculation settle before setting
      // the destination fields; the runner re-verifies them before reading.
      { action: 'sleep', ms: 4000 },
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
    sku: '930333',
    productUrl: 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico',
    cartUrl: 'https://www.coffeeman.co.il/checkout.asp',
    allowedHosts: ['www.coffeeman.co.il', 'coffeeman.co.il'],
    packGrams: 250,
    // The rendered cart row links to the listing with its SKU in the `pid`
    // query parameter and names "250 גרם" (one 250 g pack per cart unit). The
    // row also carries the cart quantity input; the runner reads all of it at
    // totals-read time and matches it against this declared listing.
    cartIdentity: { lineSelectors: ['ul.cart_items_ul > li'], listingPacks: 1, packGrams: 250 },
    parseTotals: parseCoffeemanTotals,
    steps: COFFEEMAN_CHECKOUT_STEPS
  },
  // The same public checkout flow drives the tracked 4 × 250 g multipack
  // listing (SKU 930334); only the product URL and pack size differ, so the
  // free-cart conditions observed on a two-4-pack cart can be re-checked per
  // destination through the reusable recipe instead of an ad-hoc session.
  'coffeeman-4pack': {
    id: 'coffeeman-4pack',
    vendorId: 'coffeeman',
    vendorName: 'CoffeeMan (Amigo)',
    sku: '930334',
    productUrl: 'https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico',
    cartUrl: 'https://www.coffeeman.co.il/checkout.asp',
    allowedHosts: ['www.coffeeman.co.il', 'coffeeman.co.il'],
    packGrams: 1000,
    cartIdentity: { lineSelectors: ['ul.cart_items_ul > li'], listingPacks: 4, packGrams: 250 },
    parseTotals: parseCoffeemanTotals,
    steps: COFFEEMAN_CHECKOUT_STEPS
  },
  // The tracked 8 × 250 g multipack (SKU 930335) carries its own ₪20 anonymous
  // checkout quote, scoped to a single 2000 g cart. One cart unit is the whole
  // 8-pack (packGrams 2000), so a 2000 g run sets quantity 1 and re-checks the
  // quote and its destination coverage through the reusable recipe.
  'coffeeman-8pack': {
    id: 'coffeeman-8pack',
    vendorId: 'coffeeman',
    vendorName: 'CoffeeMan (Amigo)',
    sku: '930335',
    productUrl: 'https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico',
    cartUrl: 'https://www.coffeeman.co.il/checkout.asp',
    allowedHosts: ['www.coffeeman.co.il', 'coffeeman.co.il'],
    packGrams: 2000,
    cartIdentity: { lineSelectors: ['ul.cart_items_ul > li'], listingPacks: 8, packGrams: 250 },
    parseTotals: parseCoffeemanTotals,
    steps: COFFEEMAN_CHECKOUT_STEPS
  },
  coffee4u: {
    id: 'coffee4u',
    vendorId: 'coffee4u',
    vendorName: 'Coffee4U',
    sku: '2010561',
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
      // Let the checkout's asynchronous recalculation settle before setting the
      // destination; the runner re-verifies it immediately before reading.
      { action: 'sleep', ms: 4000 },
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

const roundIls = value => Math.round(value * 100) / 100;

/**
 * Applied-discount evidence from the rendered page. Only an explicit signed
 * reduction next to a discount cue (for example CoffeeMan's
 * "מבצע כל הקפה טחון ב-10% הנחה.-" followed by "₪ -26.40") counts as a
 * discount. A cue without any shekel amount means "no discount displayed" (0);
 * a cue whose amount cannot be read as a signed reduction is recorded as
 * ambiguous so it can never be accepted as a confirmed cart condition.
 */
export function readAppliedDiscount(text) {
  const value = String(text ?? '');
  const lines = value.split('\n').map(line => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/(?:הנחה|discount)/i.test(line)) continue;
    const window = [line, lines[index + 1] ?? '', lines[index + 2] ?? ''].join('\n');
    const signed = /₪\s*-\s*([\d.,]+)/.exec(window) ?? /-\s*([\d.,]+)\s*₪/.exec(window);
    if (!signed) continue;
    const percent = /(\d+(?:[.,]\d+)?)\s*%/.exec(window)?.[1] ?? null;
    return {
      discountIls: -Math.abs(toAmount(signed[1])),
      discountPercent: percent == null ? null : toAmount(percent),
      discountLabel: sanitizeExcerpt(line, 160),
      discountAmbiguous: false
    };
  }
  const signedAnywhere = /₪\s*-\s*([\d.,]+)/.exec(value);
  if (signedAnywhere) {
    return { discountIls: -Math.abs(toAmount(signedAnywhere[1])), discountPercent: null, discountLabel: null, discountAmbiguous: false };
  }
  const cueIndex = lines.findIndex(line => /(?:הנחה|discount)/i.test(line));
  const cueWindow = cueIndex >= 0 ? [lines[cueIndex], lines[cueIndex + 1] ?? '', lines[cueIndex + 2] ?? ''] : [];
  const ambiguous = cueWindow.some(line => /₪/.test(line));
  return {
    discountIls: ambiguous ? null : 0,
    discountPercent: null,
    discountLabel: ambiguous ? sanitizeExcerpt(cueWindow[0], 160) : null,
    discountAmbiguous: ambiguous
  };
}

/** Rendered delivery-method options with their displayed rates, from body text. */
export function readMethodOptions(text) {
  const options = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/(?:^|\s)משלוח/.test(line)) continue;
    const match = /([\d.,]+)\s*₪\s*$/.exec(line) ?? /₪\s*([\d.,]+)\s*$/.exec(line);
    if (!match) continue;
    options.push({ label: sanitizeExcerpt(line, 160), amountIls: toAmount(match[1]) });
  }
  return options;
}

/** Compact sanitized excerpt of the rendered money/decision lines. */
export function readMoneyLines(text, max = 24) {
  const lines = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line || !/₪|מבצע|הנחה|משלוח|סכום כולל|סה"כ|סך הכל/.test(line)) continue;
    lines.push(sanitizeExcerpt(line, 160));
    if (lines.length >= max) break;
  }
  return lines;
}

/**
 * Attach the common money evidence to a parser result: the displayed
 * pre-discount item subtotal, the explicit applied discount state and the paid
 * item total, plus the rendered method options.
 */
function withCommonMoney(value, base) {
  const discount = readAppliedDiscount(value);
  const itemSubtotal = base.itemSubtotalIls ?? null;
  const discountIls = discount.discountIls;
  return {
    ...base,
    itemSubtotalBeforeDiscountIls: itemSubtotal,
    discountIls,
    discountPercent: discount.discountPercent,
    discountLabel: discount.discountLabel,
    discountAmbiguous: discount.discountAmbiguous,
    paidItemTotalIls: itemSubtotal == null || discountIls == null ? null : roundIls(itemSubtotal + discountIls),
    methodOptions: readMethodOptions(value)
  };
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
  return withCommonMoney(value, {
    itemSubtotalIls: toAmount(subtotal),
    shippingIls: freeLine(shipping) ? 0 : toAmount(shipping),
    shippingLabel: freeLine(shipping) ? 'free' : shipping,
    deliveredTotalIls: toAmount(total),
    freeThresholdIls: toAmount(threshold),
    freeThresholdText: threshold ? `Free shipping above ₪${toAmount(threshold)}` : null,
    currency: 'ILS'
  });
}

/**
 * CoffeeMan summary. Two rendered layouts are supported:
 *
 * - the cart page ("סכום ביניים: ₪ 66.00" / "משלוח 25 ₪" / "סה"כ 91 ₪");
 * - the current checkout page, which lists the tracked product line with its
 *   amount on the next line, then a bare "משלוח" line with "₪25.00" on the
 *   next line, and the total under "סכום כולל מע"מ".
 *
 * The applied shipping charge is only ever read from a bare summary label: the
 * method-option labels ("משלוח לבית הלקוח... - 25.00 ₪") and the E-post
 * sentence must not be read as the charge the shopper was quoted.
 */
export function parseCoffeemanTotals(text) {
  const value = String(text ?? '');
  // The checkout does not repeat "סכום ביניים"; the tracked product line with
  // its amount is the displayed item subtotal. Never derive the subtotal from
  // the total minus shipping: that would make the arithmetic tautological.
  const subtotal = /סכום ביניים[^\d]{0,12}([\d.,]+)/.exec(value)?.[1]
    ?? /(?:Lavazza\s+)?Crema\s*e\s*gusto[\s\S]{0,120}?₪\s*([\d.,]+)/i.exec(value)?.[1]
    ?? null;
  const shippingMatch = /(?:משלוח|דמי משלוח)[^\S\n]*([\d.,]+|חינם|free)/i.exec(value)
    ?? /(?:^|\n)[ \t]*(?:משלוח|דמי משלוח)[ \t]*\n[ \t]*₪\s*([\d.,]+)/i.exec(value)
    ?? /(?:^|\n)[ \t]*(?:משלוח|דמי משלוח)[ \t]*\n[ \t]*(חינם|free)/i.exec(value);
  const total = /(?:סה"כ|סך הכל|סכום כולל מע["״]?מ)[^\d]{0,12}([\d.,]+)/.exec(value)?.[1] ?? null;
  const shipping = shippingMatch?.[1] ?? null;
  return withCommonMoney(value, {
    itemSubtotalIls: toAmount(subtotal),
    shippingIls: freeLine(shipping) ? 0 : toAmount(shipping),
    shippingLabel: freeLine(shipping) ? 'free' : shipping,
    deliveredTotalIls: toAmount(total),
    freeThresholdIls: null,
    freeThresholdText: null,
    currency: 'ILS'
  });
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
  return withCommonMoney(value, {
    itemSubtotalIls: toAmount(subtotal),
    shippingIls: freeLine(shipping) ? 0 : toAmount(shipping),
    shippingLabel: freeLine(shipping) ? 'free' : shipping,
    deliveredTotalIls: toAmount(total),
    freeThresholdIls: null,
    freeThresholdText: null,
    currency: 'ILS'
  });
}

/**
 * Deterministic decision for a checkout that displays no applied shipping row.
 * An omitted row is only read as a confirmed zero when independent rendered
 * evidence supports it: the selected named method is itself displayed at zero
 * (and appears at zero in the rendered method list), the whole-pack quantity
 * and destination were verified, the promotion state is explicit (not
 * ambiguous) and the item/discount/paid-total arithmetic equals the displayed
 * final total. Anything less stays unknown/blocked instead of becoming free
 * shipping.
 */
export function decideOmittedShippingRow({
  totals = {},
  serviceConfirmed = null,
  serviceLabel = null,
  destinationVerified = null,
  actualPacks = null,
  requestedPacks = null,
  sku = null,
  cartIdentity = null
} = {}) {
  const reasons = [];
  if (totals.shippingIls != null) {
    return { accepted: false, amountIls: null, reasons: ['the checkout already displayed an applied shipping amount'], note: null };
  }
  if (!sku) reasons.push('the tracked listing SKU was not recorded');
  // A declared recipe SKU is not proof of the product in the cart: the zero is
  // only accepted when the rendered cart line was observed to be the tracked
  // listing with the expected pack identity. Missing, mismatched, ambiguous or
  // mixed cart identity keeps the row unknown.
  if (cartIdentity?.verified !== true) {
    reasons.push(`the rendered cart line identity was not verified${cartIdentity?.reasons?.length ? ` (${cartIdentity.reasons.join('; ')})` : ''}`);
  }
  if (serviceConfirmed !== true) reasons.push('the selected delivery method was not confirmed by a successful page step');
  const selectedKey = serviceLabel ? methodLabelKey(serviceLabel) : null;
  if (!serviceLabel) reasons.push('the selected delivery method label was not recorded');
  else if (methodLabelAmountIls(serviceLabel) !== 0) reasons.push(`the selected method is not displayed at zero (${serviceLabel})`);
  const options = Array.isArray(totals.methodOptions) ? totals.methodOptions : [];
  if (serviceLabel && !options.some(option => methodLabelKey(option.label) === selectedKey && option.amountIls === 0)) {
    reasons.push('the rendered method list did not show the selected method at zero');
  }
  if (destinationVerified !== true) reasons.push('the destination was not verified on the rendered page');
  if (!Number.isFinite(actualPacks) || actualPacks <= 0) reasons.push('the whole-pack quantity was not verified on the rendered page');
  else if (Number.isFinite(requestedPacks) && actualPacks !== requestedPacks) reasons.push(`the page held ${actualPacks} pack(s), not the requested ${requestedPacks}`);
  if (totals.discountAmbiguous === true) reasons.push('the rendered promotion could not be read as an explicit discount amount');
  const itemSubtotal = totals.itemSubtotalBeforeDiscountIls ?? totals.itemSubtotalIls ?? null;
  const discount = totals.discountIls ?? null;
  const paid = totals.paidItemTotalIls ?? null;
  if (itemSubtotal == null || discount == null || paid == null) {
    reasons.push('the pre-discount item subtotal, applied discount and paid item total were not all displayed');
  } else if (Math.abs(itemSubtotal + discount - paid) > 0.05) {
    reasons.push('the applied discount does not reconcile the pre-discount subtotal with the paid item total');
  }
  if (totals.deliveredTotalIls == null) reasons.push('the displayed final total was not read');
  else if (paid != null && Math.abs(paid - totals.deliveredTotalIls) > 0.05) {
    reasons.push('the displayed final total is not consistent with the paid item total and a zero shipping charge');
  }
  const accepted = reasons.length === 0;
  return {
    accepted,
    amountIls: accepted ? 0 : null,
    reasons,
    note: accepted
      ? 'The checkout omitted the applied shipping row; the selected named delivery method is displayed at ₪0 and the discounted item total equals the displayed final total, so the zero is recorded as confirmed for this exact cart and destination.'
      : null
  };
}

/**
 * The amount a delivery-method label displays, or null when the label carries
 * no readable rate. Only used on labels the page rendered for the method the
 * recipe actually selected.
 */
export function methodLabelAmountIls(label) {
  const value = String(label ?? '');
  if (/חינם|\bfree\b/i.test(value)) return 0;
  const match = /([\d.,]+)\s*₪\s*$/.exec(value) ?? /₪\s*([\d.,]+)/.exec(value);
  return match ? toAmount(match[1]) : null;
}

/** Method wording without its rate, so a selected label can be matched to the rendered option list. */
function methodLabelKey(label) {
  return String(label ?? '').replace(/[₪]|[\d.,]+/g, '').replace(/\s+/g, ' ').trim();
}

// Query-string keys vendors use to carry a listing SKU in a cart-line link.
const LINE_SKU_QUERY_KEYS = ['pid', 'sku', 'product_id', 'productid', 'item_id', 'itemid'];

/**
 * The listing identity a recipe declares: the tracked SKU, how many single
 * packs the listing contains and the grams of one pack. This is the expected
 * side of the match; it is never copied into the observed side.
 */
export function expectedCartIdentity(recipe) {
  const identity = recipe?.cartIdentity ?? {};
  const listingPacks = Number.isFinite(identity.listingPacks) && identity.listingPacks > 0 ? identity.listingPacks : 1;
  const packGrams = Number.isFinite(identity.packGrams) && identity.packGrams > 0 ? identity.packGrams : null;
  return {
    sku: recipe?.sku ?? null,
    listingPacks,
    packGrams,
    unitGrams: packGrams == null ? null : listingPacks * packGrams
  };
}

/**
 * The SKU a rendered cart line exposes. Only an explicit rendered identity
 * counts: a query parameter (for example CoffeeMan's `pid=930333`), a data
 * attribute or the line's own wording. The expected recipe SKU is never used
 * as a fallback here.
 */
export function readLineSku(line) {
  const candidates = [];
  for (const href of Array.isArray(line?.links) ? line.links : []) {
    try {
      const parsed = new URL(String(href), 'https://invalid.local');
      for (const key of LINE_SKU_QUERY_KEYS) {
        const value = parsed.searchParams.get(key);
        if (value) candidates.push(value);
      }
    } catch {
      // Not a URL: no query parameter to read.
    }
  }
  for (const [name, value] of Object.entries(line?.attrs ?? {})) {
    if (value && /sku|pid|product.?id|item.?id/i.test(name)) candidates.push(String(value));
  }
  const unique = [...new Set(candidates)];
  return { sku: unique.length === 1 ? unique[0] : null, candidates: unique };
}

/**
 * The pack identity a rendered cart line states in its own wording, for
 * example CoffeeMan's "8 אריזות 250 גרם" (8 × 250 g multipack) or
 * "250 גרם" (one 250 g pack). Nothing is inferred from the expected listing or
 * from the money; a line whose wording does not state the pack identity stays
 * unreadable.
 */
export function readLinePackIdentity(text) {
  const value = String(text ?? '');
  const multipack = /(\d+)\s*(?:אריזות?|יחידות?|×|x|\*)\s*(?:של\s*)?(\d+)\s*(?:גרם|גר['׳]|g(?![a-z]))/i.exec(value);
  if (multipack) {
    return { listingPacks: Number(multipack[1]), packGrams: Number(multipack[2]), wording: multipack[0] };
  }
  const single = /(\d+)\s*(?:גרם|גר['׳]|g(?![a-z]))/i.exec(value);
  if (single) {
    return { listingPacks: 1, packGrams: Number(single[1]), wording: single[0] };
  }
  return { listingPacks: null, packGrams: null, wording: null };
}

function readLineQuantity(line) {
  const quantity = Number(line?.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

/**
 * Match the rendered cart lines against the recipe's declared listing. A quote
 * may only be attributed to the tracked listing when exactly one distinct
 * rendered line exposes an unambiguous SKU and a pack identity equal to the
 * recipe's; duplicate renders of the same line are folded together. Missing or
 * ambiguous identity, a different SKU, another multipack and mixed cart lines
 * all stay unverified with the exact reason, so the caller can keep the
 * omitted-row zero blocked instead of guessing it from the declared SKU.
 */
export function matchCartIdentity({ recipe, lines = [] } = {}) {
  const expected = expectedCartIdentity(recipe);
  const reasons = [];
  const observedLines = (Array.isArray(lines) ? lines : []).slice(0, 12).map(line => {
    const sku = readLineSku(line);
    const pack = readLinePackIdentity(line?.text);
    return {
      sku: sku.sku,
      skuCandidates: sku.candidates.slice(0, 4),
      listingPacks: pack.listingPacks,
      packGrams: pack.packGrams,
      packWording: pack.wording,
      quantity: readLineQuantity(line),
      lineText: sanitizeExcerpt(line?.text, 200)
    };
  });
  const lineKey = line => [line.sku ?? '?', line.listingPacks ?? '?', line.packGrams ?? '?', line.quantity ?? '?'].join('|');
  const distinct = [];
  for (const line of observedLines) {
    if (!distinct.some(existing => lineKey(existing) === lineKey(line))) distinct.push(line);
  }
  if (!expected.sku) reasons.push('the recipe does not declare a tracked listing SKU');
  if (distinct.length === 0) reasons.push('no rendered cart line could be read for the tracked listing');
  if (distinct.length > 1) reasons.push(`the cart holds ${distinct.length} distinct rendered lines, so the quote is not attributed to one tracked listing`);
  const line = distinct.length === 1 ? distinct[0] : null;
  if (line) {
    if (!line.sku) reasons.push('the rendered cart line did not expose an unambiguous listing SKU');
    else if (line.sku !== expected.sku) reasons.push(`the rendered cart line is listing ${line.sku}, not the tracked ${expected.sku}`);
    if (line.listingPacks == null || line.packGrams == null) {
      reasons.push('the rendered cart line did not state its pack identity');
    } else if (line.listingPacks !== expected.listingPacks || line.packGrams !== expected.packGrams) {
      reasons.push(`the rendered cart line is ${line.listingPacks} × ${line.packGrams} g, not the tracked ${expected.listingPacks} × ${expected.packGrams} g listing`);
    }
    if (line.quantity == null) reasons.push('the rendered cart line did not show a whole-pack quantity');
  }
  const verified = reasons.length === 0;
  return {
    verified,
    source: verified ? 'rendered-cart-line' : null,
    expected,
    observed: line ? { ...line, source: 'rendered-cart-line' } : null,
    lines: observedLines.slice(0, 6),
    reasons
  };
}

/**
 * Build one common evidence record from a recipe run. `status` is one of
 * `quoted` (displayed item subtotal, explicit discount state, shipping
 * evidence and final total agree), `partial` (values were read but do not all
 * agree), `blocked` (the public flow could not produce a quote; `blocker`
 * says where) or `failed` (tooling/step error).
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
  serviceLabel = null,
  cartIdentity = null,
  now = Date.now()
} = {}) {
  const grams = Number(params.grams) > 0 ? Number(params.grams) : recipe.packGrams;
  const requestedPacks = Math.max(1, Math.ceil(grams / recipe.packGrams));
  const packs = Number.isFinite(actualPacks) && actualPacks > 0 ? actualPacks : requestedPacks;
  // Expected versus observed cart identity. The expected side comes from the
  // recipe declaration; the observed side is only ever what the rendered cart
  // line exposed (a verified match). A missing or mismatched observation keeps
  // both sides recorded but never copies the expected SKU into the observed
  // one.
  const expectedIdentity = cartIdentity?.expected ?? expectedCartIdentity(recipe);
  const observedIdentity = cartIdentity?.verified === true && cartIdentity.observed
    ? {
      source: cartIdentity.source ?? 'rendered-cart-line',
      sku: cartIdentity.observed.sku ?? null,
      listingPacks: cartIdentity.observed.listingPacks ?? null,
      packGrams: cartIdentity.observed.packGrams ?? null,
      packWording: cartIdentity.observed.packWording ?? null,
      quantity: cartIdentity.observed.quantity ?? null,
      lineText: cartIdentity.observed.lineText ? sanitizeExcerpt(cartIdentity.observed.lineText, 200) : null
    }
    : null;
  // Distinguish the displayed pre-discount subtotal, the explicit applied
  // discount and the paid item total. Totals that carry no discount evidence
  // (version-1 callers) keep their previous meaning: the subtotal is paid.
  const itemSubtotalBeforeDiscount = totals.itemSubtotalBeforeDiscountIls ?? totals.itemSubtotalIls ?? null;
  const discountIls = totals.discountIls ?? null;
  const paidItemTotal = totals.paidItemTotalIls
    ?? (itemSubtotalBeforeDiscount != null && discountIls != null ? roundIls(itemSubtotalBeforeDiscount + discountIls) : itemSubtotalBeforeDiscount);
  const freeDecision = decideOmittedShippingRow({
    totals: { ...totals, itemSubtotalBeforeDiscountIls: itemSubtotalBeforeDiscount, paidItemTotalIls: paidItemTotal },
    serviceConfirmed,
    serviceLabel,
    destinationVerified,
    actualPacks: Number.isFinite(actualPacks) && actualPacks > 0 ? actualPacks : null,
    requestedPacks,
    sku: recipe.sku ?? null,
    cartIdentity
  });
  let shippingIls = totals.shippingIls ?? null;
  let shippingLabel = totals.shippingLabel ?? null;
  let shippingEvidenceSource = totals.shippingEvidenceSource ?? null;
  let shippingEvidenceNote = totals.shippingEvidenceNote ?? null;
  if (shippingIls == null && freeDecision.accepted) {
    shippingIls = 0;
    shippingLabel = 'free';
    shippingEvidenceSource = 'selected-method-option';
    shippingEvidenceNote = freeDecision.note;
  } else if (shippingIls != null && shippingEvidenceSource == null) {
    shippingEvidenceSource = 'applied-line';
  }
  const arithmeticOk = itemSubtotalBeforeDiscount != null && shippingIls != null && totals.deliveredTotalIls != null
    && Math.abs((paidItemTotal ?? itemSubtotalBeforeDiscount) + shippingIls - totals.deliveredTotalIls) <= 0.05;
  let resolvedStatus = status;
  let resolvedBlocker = blocker ? sanitizeExcerpt(blocker, 300) : null;
  // A rendered cart line that is a different listing (or a mixed/unreadable
  // cart) means the displayed amounts do not belong to the tracked listing, so
  // they must not be published as its quote even when a shipping row exists.
  if (cartIdentity && cartIdentity.verified === false && resolvedStatus === 'quoted') {
    resolvedStatus = 'blocked';
    resolvedBlocker = resolvedBlocker ?? `Cart identity check failed: ${cartIdentity.reasons.join('; ')}.`;
  }
  if (resolvedStatus === 'quoted' && shippingIls == null) {
    // Without a shipping amount there is no delivered quote at all, so the
    // record is blocked rather than partial.
    resolvedStatus = 'blocked';
    resolvedBlocker = resolvedBlocker ?? `The rendered flow did not display an applied shipping row for this quantity and destination${freeDecision.reasons.length ? `: ${freeDecision.reasons.join('; ')}.` : '.'}`;
  } else if (resolvedStatus === 'quoted' && !arithmeticOk) {
    resolvedStatus = 'partial';
  }
  // A requested locality/postcode that the recipe could not set on the page must
  // not read as a destination quote: keep the requested values but say plainly
  // that the destination was not verified.
  const destinationNote = destinationVerified === false && (params.locality || params.postcode)
    ? 'The destination (locality/postcode) was requested but could not be verified on the rendered page, so the displayed quote is not confirmed for that destination.'
    : null;
  // The displayed shipping evidence belongs to a named method only when the
  // recipe's method-selection step succeeded on the page; otherwise the record
  // must say the method is unconfirmed instead of implying one.
  const serviceNote = serviceConfirmed === false
    ? 'The delivery method could not be confirmed on the rendered page, so the displayed shipping line is not attributed to a named method.'
    : null;
  return {
    kind: 'browser-research-quote',
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    vendorId: recipe.vendorId,
    vendorName: recipe.vendorName,
    sku: recipe.sku ?? null,
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
    serviceLabel: serviceLabel ? sanitizeExcerpt(serviceLabel, 160) : null,
    status: resolvedStatus,
    itemSubtotalBeforeDiscountIls: itemSubtotalBeforeDiscount,
    discountIls,
    discountPercent: totals.discountPercent ?? null,
    discountLabel: totals.discountLabel ? sanitizeExcerpt(totals.discountLabel, 160) : null,
    discountAmbiguous: totals.discountAmbiguous === true,
    paidItemTotalIls: paidItemTotal,
    itemSubtotalIls: itemSubtotalBeforeDiscount,
    shippingIls,
    shippingLabel,
    shippingEvidenceSource,
    shippingEvidenceNote,
    deliveredTotalIls: totals.deliveredTotalIls ?? null,
    freeThresholdIls: totals.freeThresholdIls ?? null,
    freeThresholdText: totals.freeThresholdText ?? null,
    currency: totals.currency ?? 'ILS',
    arithmeticOk,
    // Cart identity: the expected recipe listing versus the listing the
    // rendered cart line actually exposed, plus how it was verified. A null
    // `cartIdentityVerified` means no observation was attempted (recipes
    // without a cart-line reader keep their applied-line quotes but can never
    // take an omitted shipping row as zero).
    expectedCartIdentity: expectedIdentity,
    observedCartIdentity: observedIdentity,
    cartIdentityVerified: cartIdentity ? cartIdentity.verified === true : null,
    cartIdentitySource: cartIdentity?.verified === true ? cartIdentity.source ?? 'rendered-cart-line' : null,
    cartIdentityNote: cartIdentity && cartIdentity.verified !== true ? sanitizeExcerpt(cartIdentity.reasons.join('; '), 300) : null,
    cartIdentityLines: cartIdentity?.lines?.length
      ? cartIdentity.lines.slice(0, 6).map(line => ({
        sku: line.sku ?? null,
        listingPacks: line.listingPacks ?? null,
        packGrams: line.packGrams ?? null,
        quantity: line.quantity ?? null,
        lineText: line.lineText ? sanitizeExcerpt(line.lineText, 200) : null
      }))
      : null,
    qualification: [totals.qualification, destinationNote, serviceNote].filter(Boolean).join(' ') || null,
    blocker: resolvedBlocker,
    excerpt: totals.excerpt ? sanitizeExcerpt(totals.excerpt) : null,
    moneyLines: Array.isArray(totals.moneyLines) ? totals.moneyLines.slice(0, 24).map(line => sanitizeExcerpt(line, 160)) : null,
    methodOptions: Array.isArray(totals.methodOptions) ? totals.methodOptions.slice(0, 8).map(option => ({ label: sanitizeExcerpt(option.label, 160), amountIls: option.amountIls ?? null })) : null,
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
  if (!SUPPORTED_EVIDENCE_SCHEMA_VERSIONS.includes(record.schemaVersion)) {
    errors.push(`schemaVersion must be one of ${SUPPORTED_EVIDENCE_SCHEMA_VERSIONS.join(', ')}`);
  }
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
  // Version 2 adds the discount/method evidence fields. A free zero taken from
  // an omitted shipping row must carry every piece of independent rendered
  // evidence the decision above requires, so a partial read can never validate
  // as free shipping.
  if (record.schemaVersion >= 2) {
    for (const key of ['itemSubtotalBeforeDiscountIls', 'discountIls', 'discountPercent', 'paidItemTotalIls']) {
      const value = record[key];
      if (value != null && !Number.isFinite(value)) errors.push(`${key} must be a number or null`);
    }
    if (record.serviceLabel != null && typeof record.serviceLabel !== 'string') errors.push('serviceLabel must be a string or null');
    if (![null, 'applied-line', 'selected-method-option'].includes(record.shippingEvidenceSource)) {
      errors.push('shippingEvidenceSource must be null, applied-line or selected-method-option');
    }
    if (record.status === 'quoted') {
      if (record.itemSubtotalBeforeDiscountIls == null) errors.push('a quoted record needs the displayed pre-discount item subtotal');
      if (record.paidItemTotalIls == null) errors.push('a quoted record needs the paid item total');
      if (record.itemSubtotalBeforeDiscountIls != null && record.discountIls != null && record.paidItemTotalIls != null
        && Math.abs(record.itemSubtotalBeforeDiscountIls + record.discountIls - record.paidItemTotalIls) > 0.05) {
        errors.push('the displayed discount does not reconcile the item subtotal with the paid item total');
      }
    }
    if (record.shippingEvidenceSource === 'selected-method-option') {
      if (record.shippingIls !== 0) errors.push('a selected-method-option zero must record shippingIls 0');
      if (record.serviceConfirmed !== true || !record.service) errors.push('a selected-method-option zero needs the confirmed method name');
      if (!record.serviceLabel || methodLabelAmountIls(record.serviceLabel) !== 0) errors.push('a selected-method-option zero needs the selected method label displayed at zero');
      if (record.destinationVerified !== true || !record.locality) errors.push('a selected-method-option zero needs a verified destination');
      if (!Number.isFinite(record.observedPacks) || record.observedPacks <= 0) errors.push('a selected-method-option zero needs the verified whole-pack quantity');
      if (!record.sku) errors.push('a selected-method-option zero needs the tracked listing SKU');
      if (!record.shippingEvidenceNote) errors.push('a selected-method-option zero needs the omitted-row evidence note');
      if (record.discountIls == null) errors.push('a selected-method-option zero needs the explicit discount state');
      if (record.arithmeticOk !== true) errors.push('a selected-method-option zero needs consistent item/discount/shipping/total arithmetic');
    }
  }
  // Version 3 adds the observed-cart-identity evidence. A zero taken from an
  // omitted shipping row is only valid when the rendered cart line was observed
  // to be the tracked listing with the expected pack identity; a mismatched or
  // mixed cart can never be published as a quote. The declared recipe SKU alone
  // is not proof of the product in the cart.
  if (record.schemaVersion >= 3) {
    if (record.cartIdentityVerified != null && typeof record.cartIdentityVerified !== 'boolean') {
      errors.push('cartIdentityVerified must be a boolean or null');
    }
    if (record.cartIdentitySource != null && typeof record.cartIdentitySource !== 'string') {
      errors.push('cartIdentitySource must be a string or null');
    }
    if (record.expectedCartIdentity != null && typeof record.expectedCartIdentity !== 'object') {
      errors.push('expectedCartIdentity must be an object or null');
    }
    if (record.observedCartIdentity != null && typeof record.observedCartIdentity !== 'object') {
      errors.push('observedCartIdentity must be an object or null');
    }
    if (record.cartIdentityLines != null && !Array.isArray(record.cartIdentityLines)) {
      errors.push('cartIdentityLines must be an array or null');
    }
    if (record.cartIdentityVerified === true) {
      if (record.cartIdentitySource !== 'rendered-cart-line') errors.push('a verified cart identity must record its rendered source');
      const observed = record.observedCartIdentity;
      if (!observed || typeof observed !== 'object' || !observed.sku) {
        errors.push('a verified cart identity must record the observed listing SKU');
      } else {
        if (record.sku && observed.sku !== record.sku) errors.push('the observed cart SKU must match the declared listing SKU');
        const expected = record.expectedCartIdentity ?? {};
        if (expected.listingPacks != null && observed.listingPacks !== expected.listingPacks) {
          errors.push('the observed pack count must match the expected listing pack identity');
        }
        if (expected.packGrams != null && observed.packGrams !== expected.packGrams) {
          errors.push('the observed pack grams must match the expected listing pack identity');
        }
        if (expected.unitGrams != null && observed.listingPacks != null && observed.packGrams != null
          && observed.listingPacks * observed.packGrams !== expected.unitGrams) {
          errors.push('the observed pack identity must match the expected cart unit grams');
        }
      }
    }
    if (record.cartIdentityVerified === false && record.status === 'quoted') {
      errors.push('a quoted record cannot carry a mismatched cart identity');
    }
    if (record.shippingEvidenceSource === 'selected-method-option') {
      if (record.cartIdentityVerified !== true) errors.push('a selected-method-option zero needs a verified rendered cart identity');
      if (!record.observedCartIdentity?.sku) errors.push('a selected-method-option zero needs the observed cart listing SKU');
      if (!record.cartIdentitySource) errors.push('a selected-method-option zero needs the cart identity source');
    }
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
  'readValue(selector)',
  'readSelectedLabel(selector)',
  'readCartLines(selectors)',
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
  // The label the page returned is kept too, because the omitted-shipping-row
  // decision requires the selected method's own displayed rate.
  let confirmedService = null;
  let serviceLabel = null;
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
        serviceLabel = typeof result === 'string'
          ? result
          : (result && typeof result === 'object' ? result.selected ?? null : null);
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
        serviceLabel = null;
      }
      if (isDestinationStep(step)) destinationVerified = false;
      if (step.optional) continue;
      status = 'blocked';
      blocker = `Required step "${step.action}" failed: ${error?.message ?? error}`;
      break;
    }
  }
  // Destination durability: an asynchronous cart re-render can reset a
  // destination control after its step succeeded (CoffeeMan's quantity change
  // re-renders the checkout form). The quote is only attributed to a
  // destination that still holds when the totals are read, so every destination
  // step is re-verified here, read-only, immediately before the page text is
  // captured. A reset destination blocks the run instead of being attributed to
  // the requested locality.
  const destinationSteps = expandSteps(recipe, runParams).filter(step => step.verifies === 'destination');
  const canRecheckDestination = typeof driver.readValue === 'function' || typeof driver.readSelectedLabel === 'function';
  if (status === 'quoted' && destinationSteps.length && canRecheckDestination) {
    for (const step of destinationSteps) {
      const expected = step.action === 'fill' ? step.value : step.label;
      try {
        const current = step.action === 'fill'
          ? { value: await driver.readValue(step.selector) }
          : await driver.readSelectedLabel(step.selector);
        if (!destinationMatches(step, current)) {
          destinationVerified = false;
          recordStep({ action: `${step.action}:recheck`, optional: Boolean(step.optional), verifies: 'destination' }, false, null, `no longer holds ${JSON.stringify(expected)}`);
          if (!step.optional) {
            status = 'blocked';
            blocker = `The destination control was reset before the totals were read: ${step.selector} no longer holds ${JSON.stringify(expected)}.`;
          }
          break;
        }
      } catch (error) {
        destinationVerified = false;
        recordStep({ action: `${step.action}:recheck`, optional: Boolean(step.optional), verifies: 'destination' }, false, error);
        if (!step.optional) {
          status = 'blocked';
          blocker = `Could not re-verify the destination before reading the totals: ${error?.message ?? error}`;
        }
        break;
      }
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
  // The rendered money/decision lines are kept as a compact sanitized excerpt so
  // a reviewer can read the discount and method evidence without the whole page.
  totals = { ...totals, moneyLines: readMoneyLines(text) };
  const requestedPacks = Math.max(1, Math.ceil((Number(runParams.grams) || recipe.packGrams) / recipe.packGrams));
  // A checkout that omits the applied shipping row is only read as free when
  // the deterministic decision accepts the independent rendered evidence. A
  // missing row alone, an unselected option price, an unconfirmed method, an
  // unverified destination, an ambiguous promotion or incomplete arithmetic
  // stays blocked instead of becoming free shipping.
  const freeDecision = decideOmittedShippingRow({
    totals,
    serviceConfirmed: serviceStepSeen ? confirmedService != null : null,
    serviceLabel,
    destinationVerified,
    actualPacks: Number.isFinite(actualPacks) && actualPacks > 0 ? actualPacks : null,
    requestedPacks,
    sku: recipe.sku ?? null
  });
  if (status === 'quoted' && totals.shippingIls == null && freeDecision.accepted) {
    totals = {
      ...totals,
      shippingIls: 0,
      shippingLabel: 'free',
      shippingEvidenceSource: 'selected-method-option',
      shippingEvidenceNote: freeDecision.note
    };
  }
  if (status === 'quoted' && totals.shippingIls == null) {
    status = 'blocked';
    blocker = blocker ?? `The rendered flow did not display an applied shipping row for this quantity and destination${freeDecision.reasons.length ? `: ${freeDecision.reasons.join('; ')}.` : '.'}`;
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
    serviceLabel,
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
  if (step.action === 'selectLabel' && result) return `selected: ${result} (${step.selector})`;
  return null;
}
