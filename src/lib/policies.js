// Validated shipping policies and the shared policy evaluator.
//
// A policy is a versioned, scoped statement of a shipping rule that browser
// research established: what the rule is, which vendor/product/service and
// destination scope it covers, when it was observed, and when it must be
// re-checked. Policies are deliberately separate from an observation's own
// parsed shipping block:
//
//   - Published rules and observed conditional cart quotes stay distinguishable
//     through `origin` and `certainty`; a cart quote is never relabelled as a
//     published rate.
//   - The evaluator is deterministic and shared by every vendor: it matches an
//     observation by vendor, product, service and item-URL scope, refuses to
//     guess when matching policies disagree (status `inconsistent`) and refuses
//     to keep applying evidence past its `reviewBy` date (status `expired`).
//   - Enrichment only fills missing shipping fields. An observation that already
//     carries its own amount, threshold or destination is never overwritten, so
//     a newer policy cannot rewrite a fresher parse.
//   - Enrichment happens at read time. It never changes the observation's price,
//     stock, `observedAt` or the refresh completion marker, so applying a newer
//     shipping rule cannot claim a fresh vendor price/stock check.
//
// Recheck/staleness: each policy carries `reviewBy`. Browser research re-runs
// update the evidence and version (and move `reviewBy` forward); until then the
// policy applies. Once `reviewBy` passes, the evaluator stops applying it and
// the offer falls back to its parsed shipping — explicit unknown rather than a
// stale unconditional rate.

const PRODUCT_ID = 'lavazza-crema-e-gusto-vacuum-ground';

// Amigo's terms make home delivery subject to a locality list. The rendered
// anonymous checkout exposes that list as a closed select (264 localities,
// observed 2026-10-13) and every selectable destination on this site is on it;
// both CoffeeMan policies carry the same structured caveat.
const AMIGO_HOME_DELIVERY_CAVEAT =
  'Home delivery is limited to the localities on Amigo’s home-delivery list. The rendered anonymous checkout exposes that list as a closed 264-locality select (observed 2026-10-13), and every selectable destination on this site is on it (Tel Aviv–Yafo, Jerusalem, Haifa, Be’er Sheva, Eilat), each with the published ₪25 home-courier option selectable; a destination outside the list cannot use home delivery. Confirm the destination at checkout.';
const AMIGO_CAVEAT_SOURCE = 'https://www.coffeeman.co.il/page/%D7%AA%D7%A0%D7%90%D7%99-%D7%A9%D7%99%D7%9E%D7%95%D7%A9';
const AMIGO_HOME_DELIVERY_OBSERVED = {
  homeDeliveryLocalities: 264,
  verifiedLocalities: ['תל אביב - יפו', 'ירושלים', 'חיפה', 'באר שבע', 'אילת'],
  observedAt: '2026-10-13T08:18:00Z',
  entryUrl: 'https://www.coffeeman.co.il/checkout.asp',
  evidence: 'docs/evidence/browser-research/2026-10-13-coffeeman-home-delivery-locality-coverage.json'
};

/**
 * Pucks home-delivery rule, observed in the anonymous checkout estimator on
 * 2026-10-12 and extended to the remaining selectable localities on 2026-10-13:
 * ₪30 flat home delivery, free above a ₪100 item subtotal.
 * Observed carts: 1, 2 and 4 × 250 g to Tel Aviv / 6100000 and Eilat / 8800000
 * (2026-10-12), a 4 × 250 g cart to Jerusalem / 9100000 (2026-10-12, free over
 * the threshold), and on 2026-10-13 a 2 × 250 g cart to Haifa / 3100000 and
 * Be'er Sheva / 8400000 (both ₪60 + ₪30 = ₪90) plus a 4 × 250 g cart to Haifa
 * (₪120, free). The fee did not change with locality and no restriction was
 * displayed, so all five selectable localities with a postcode are sampled;
 * "Elsewhere in Israel" remains unquoted because the estimator requires a
 * locality.
 * The vendor's own wording is "above ₪100"; the boundary was observed only at
 * ₪60 (paid) and ₪120 (free), so `thresholdSemantics` records "above" and the
 * quote engine applies the vendor's strict wording — a cart of exactly ₪100 is
 * not treated as free. A 2026-10-12 attempt to quote an exactly-₪100 anonymous
 * cart was blocked (the only ₪10 filler is out of stock and no in-stock
 * combination reaches ₪100); because a coffee-only cart is a multiple of ₪30
 * (₪90 paid / ₪120 free), the strict boundary never changes a real coffee
 * total. See docs/SOURCES.md,
 * docs/evidence/browser-research/2026-10-12-pucks-threshold-boundary-attempt.json
 * and docs/evidence/browser-research/2026-10-13-pucks-*.json.
 */
export const pucksHomeDeliveryPolicy = {
  id: 'pucks-il-home-delivery',
  version: 2,
  vendorId: 'pucks',
  productIds: [PRODUCT_ID],
  itemUrlPrefixes: ['https://pucks.co.il/product/'],
  service: 'home_delivery',
  origin: 'observed_cart',
  certainty: 'checkout_quote',
  rule: {
    amount: { amount: 30, currency: 'ILS' },
    freeThreshold: { amount: 100, currency: 'ILS' },
    thresholdSemantics: 'above',
    minOrder: null,
    maxTotalGrams: null
  },
  destination: {
    scope: 'country',
    country: 'IL',
    caveat: 'The ₪30 rate was observed in the anonymous checkout estimator for carts to Tel Aviv–Yafo / 6100000, Eilat / 8800000, Jerusalem / 9100000, Haifa / 3100000 and Be’er Sheva / 8400000; the fee did not change with locality and no restriction was displayed, but coverage for every locality was not individually verified.',
    caveatSource: 'https://pucks.co.il/payment/request'
  },
  evidence: {
    url: 'https://pucks.co.il/payment/request',
    retrievedAt: '2026-10-13T01:41:10Z',
    note: 'Anonymous checkout estimator quote recorded by interactive browser research: ₪30 flat home delivery, free above ₪100 item subtotal, for 1, 2 and 4 × 250 g carts; see docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json. Re-checked on 2026-10-13 for the remaining selectable localities: Haifa / 3100000 and Be’er Sheva / 8400000 at 500 g quoted ₪60 + ₪30 = ₪90 and Haifa at 1 kg quoted ₪120 free; see docs/evidence/browser-research/2026-10-13-pucks-*.json.'
  },
  observedFor: {
    carts: ['1 × 250 g', '2 × 250 g', '4 × 250 g', '2 × 250 g (Haifa 2026-10-13)', '2 × 250 g (Be’er Sheva 2026-10-13)', '4 × 250 g (Haifa 2026-10-13, free)'],
    destinations: ['Tel Aviv–Yafo / 6100000', 'Eilat / 8800000', 'Jerusalem / 9100000', 'Haifa / 3100000', 'Be’er Sheva / 8400000'],
    note: 'The estimator offered home delivery only; no street address or personal detail was entered and no order was submitted. All five selectable localities with a postcode were sampled by 2026-10-13; “Elsewhere in Israel” is not quoted because the estimator requires a locality.'
  },
  reviewBy: '2026-11-11T00:00:00.000Z'
};

/**
 * CoffeeMan 8 × 250 g multipack (2 kg) cart quote, observed in the anonymous
 * checkout on 2026-10-12 (18:16 UTC, re-checked in a fresh cart at 20:07 UTC).
 * The product page publishes no courier price for this SKU; the checkout quoted
 * ₪20 for home courier and ₪20 for distribution-center delivery on exactly the
 * one-8-pack cart. A larger cart was never observed, so the rule carries
 * `maxTotalGrams: 2000` and the quote engine refuses to stretch it to two
 * 8-packs. The ₪240 8-pack cart did NOT receive the free delivery that some
 * larger single-pack/two-4-pack carts showed, so no free threshold is recorded.
 */
export const coffeemanEightPackPolicy = {
  id: 'coffeeman-8pack-il-cart-quote',
  version: 3,
  vendorId: 'coffeeman',
  productIds: [PRODUCT_ID],
  itemUrlPrefixes: ['https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico'],
  service: 'home_delivery',
  origin: 'observed_cart',
  certainty: 'checkout_quote',
  rule: {
    amount: { amount: 20, currency: 'ILS' },
    freeThreshold: null,
    thresholdSemantics: null,
    minOrder: null,
    maxTotalGrams: 2000
  },
  alternatives: [{
    id: 'distribution-center',
    label: 'Distribution-center delivery up to 5 kg (cart-observed for the 2 kg cart)',
    amount: { amount: 20, currency: 'ILS' },
    maxTotalGrams: 5000,
    note: 'Anonymous checkout re-check 2026-10-12T20:07:00Z: ₪20 distribution-center delivery up to 5 kg for the one-8-pack (2 kg) cart; self-pickup free. A different service from the ranked home courier quote.'
  }],
  destination: {
    scope: 'country',
    country: 'IL',
    caveat: AMIGO_HOME_DELIVERY_CAVEAT,
    caveatSource: AMIGO_CAVEAT_SOURCE,
    observed: { ...AMIGO_HOME_DELIVERY_OBSERVED, verifiedLocalities: [...AMIGO_HOME_DELIVERY_OBSERVED.verifiedLocalities] }
  },
  evidence: {
    url: 'https://www.coffeeman.co.il/checkout.asp',
    retrievedAt: '2026-10-13T08:52:00Z',
    note: 'Anonymous checkout quote for one 8 × 250 g multipack (2 kg) on 2026-10-12, re-checked in a fresh cart at 20:07 UTC: ₪20 home courier and ₪20 distribution-center delivery up to 5 kg; self-pickup free. The product page publishes no courier price, and carts above 2 kg are not verified. The checkout’s closed home-delivery locality list was read on 2026-10-13 (264 localities, all five selectable destinations present, ₪25 home-courier option selectable for each; see docs/evidence/browser-research/2026-10-13-coffeeman-home-delivery-locality-coverage.json). On 2026-10-13 the ₪20 home-courier quote was re-applied on the one-8-pack cart (₪240 + ₪20 = ₪260) with the destination set to each of the five selectable localities; see docs/evidence/browser-research/2026-10-13-coffeeman-8pack-destination-coverage.json.'
  },
  observedFor: {
    carts: ['1 × (8 × 250 g) = 2 kg'],
    destinations: ['Tel Aviv–Yafo / 6100000', 'Jerusalem / 9100000', 'Haifa / 3100000', 'Be’er Sheva / 8400000', 'Eilat / 8800000'],
    note: 'No street address or personal detail was entered and no order was submitted. The ₪20 home-courier option was selectable and applied for each of the five destinations on 2026-10-13 (₪240 + ₪20 = ₪260).'
  },
  reviewBy: '2026-11-11T00:00:00.000Z'
};

/**
 * CoffeeMan single 250 g and 4 × 250 g published home-delivery rule with the
 * cart-researched distribution-center alternative and the cart-observed free
 * condition. The ₪25 courier rate is published on both product pages; the
 * product page lists a distribution-center option without a price, so the ₪15
 * rate comes from anonymous checkout carts observed on 2026-10-12
 * (19:56-20:09 UTC).
 *
 * The vendor publishes no free-shipping threshold, and the sampled carts do not
 * establish one: a ₪198 (6 × 250 g) cart was charged ₪25 while a ₪231
 * (7 × 250 g) cart, the ₪264 → ₪237.60 (8 × 250 g) cart and the ₪248
 * (2 × 4-pack) cart showed free home courier. The observed free carts are
 * therefore stored as exact cart conditions — listing scope, whole-pack count,
 * ordered grams, item subtotal before any discount and the paid item total —
 * instead of a monotone threshold. Free delivery applies only when the current
 * cart matches an observed configuration; every other cart keeps the published
 * ₪25 base rate, so a larger or otherwise unobserved cart (for example 12
 * singles or three 4-packs) can never inherit free delivery merely because its
 * subtotal is high. The ₪240 8-pack SKU cart kept its own ₪20 rate (its own
 * policy) and never inherits these conditions.
 *
 * v3 supersedes the v2 monotone threshold (₪231, `at_least`) at read time: a
 * persisted row stamped with the superseded rule stops applying it without
 * waiting for the next vendor refresh, while the base ₪25 rate and the item
 * observation time stay untouched. Each condition carries its own
 * `observed_cart` evidence, and the conditions stop applying with the policy
 * when `reviewBy` passes.
 */
export const coffeemanSingleFourPackPolicy = {
  id: 'coffeeman-single-4pack-il-home-delivery',
  version: 5,
  vendorId: 'coffeeman',
  productIds: [PRODUCT_ID],
  itemUrlPrefixes: [
    'https://www.coffeeman.co.il/product/250-',
    'https://www.coffeeman.co.il/product/4-'
  ],
  service: 'home_delivery',
  origin: 'published',
  certainty: 'verified',
  rule: {
    amount: { amount: 25, currency: 'ILS' },
    // No free threshold is recorded: the vendor publishes none and the sampled
    // carts are not monotone (the ₪240 8-pack cart was charged ₪20 while the
    // ₪231/₪248 single/4-pack carts were free). The free observations live in
    // `freeCartConditions` at their exact observed scope instead.
    freeThreshold: null,
    thresholdSemantics: null,
    minOrder: null,
    maxTotalGrams: null,
    freeCartConditions: [
      {
        id: 'singles-7',
        service: 'home_delivery',
        itemUrlPrefix: 'https://www.coffeeman.co.il/product/250-',
        sku: '930333',
        packCount: 1,
        units: 7,
        orderedGrams: 1750,
        itemSubtotalIls: 231,
        discountPercent: null,
        paidItemTotalIls: 231,
        methodLabel: 'home courier',
        destinationEvidence: 'the anonymous checkout method picker displayed the method prices without asking for a locality',
        observedAt: '2026-10-12T20:09:00Z',
        evidence: {
          url: 'https://www.coffeeman.co.il/checkout.asp',
          note: 'Anonymous checkout cart 2026-10-12: 7 × 250 g singles, ₪231 item subtotal, home courier ₪0 and distribution-center ₪0.'
        }
      },
      {
        id: 'singles-8',
        service: 'home_delivery',
        itemUrlPrefix: 'https://www.coffeeman.co.il/product/250-',
        sku: '930333',
        packCount: 1,
        units: 8,
        orderedGrams: 2000,
        itemSubtotalIls: 264,
        discountPercent: 10,
        paidItemTotalIls: 237.6,
        methodLabel: 'home courier',
        destinationEvidence: 'the anonymous checkout method picker displayed the method prices without asking for a locality',
        observedAt: '2026-10-12T20:09:00Z',
        evidence: {
          url: 'https://www.coffeeman.co.il/checkout.asp',
          note: 'Anonymous checkout cart 2026-10-12: 8 × 250 g singles, ₪264 item subtotal before the automatic 10% quantity discount, ₪237.60 paid, home courier ₪0.'
        }
      },
      {
        id: 'fourpack-2',
        service: 'home_delivery',
        itemUrlPrefix: 'https://www.coffeeman.co.il/product/4-',
        sku: '930334',
        packCount: 4,
        units: 2,
        orderedGrams: 2000,
        itemSubtotalIls: 248,
        discountPercent: null,
        paidItemTotalIls: 248,
        methodLabel: 'home courier',
        destinationEvidence: 'the anonymous checkout method picker displayed the method prices without asking for a locality',
        observedAt: '2026-10-12T20:09:00Z',
        evidence: {
          url: 'https://www.coffeeman.co.il/checkout.asp',
          note: 'Anonymous checkout cart 2026-10-12: 2 × (4 × 250 g) multipacks, ₪248 item subtotal, home courier ₪0.'
        }
      }
    ]
  },
  // The v2 rule applied an unconditional free threshold from ₪231. That was a
  // scope error: the free carts were observed exactly, not as a threshold. A
  // row stamped by v2 is migrated at read time so the superseded threshold
  // stops applying promptly instead of waiting for the next vendor refresh.
  supersedes: {
    freeThreshold: { amount: 231, currency: 'ILS', semantics: 'at_least', origin: 'observed_cart', policyVersion: 2 }
  },
  alternatives: [{
    id: 'distribution-center',
    label: 'Distribution-center delivery up to 5 kg (cart-observed for 0.5–1 kg carts)',
    amount: { amount: 15, currency: 'ILS' },
    maxTotalGrams: 5000,
    note: 'Anonymous cart 2026-10-12 (https://www.coffeeman.co.il/checkout.asp): ₪25 home courier (matching the published rate) and ₪15 distribution-center delivery up to 5 kg for 0.5–1 kg carts; the distribution-center fee became free on the ₪198 cart. Free home courier was observed only on the exact 7 × 250 g, 8 × 250 g and 2 × 4-pack carts; other cart sizes keep the published ₪25 base rate. Re-checked 2026-10-13 in the rendered anonymous checkout: the ₪15 option was present and selectable for all five selectable destinations (Tel Aviv–Yafo, Jerusalem, Haifa, Be’er Sheva, Eilat) and applied at ₪15.00 on the 2 × 250 g cart (₪66 + ₪15 = ₪81); a pickup point and mobile number are required only before ordering, and neither was entered.'
  }],
  destination: {
    scope: 'country',
    country: 'IL',
    caveat: AMIGO_HOME_DELIVERY_CAVEAT,
    caveatSource: AMIGO_CAVEAT_SOURCE,
    observed: { ...AMIGO_HOME_DELIVERY_OBSERVED, verifiedLocalities: [...AMIGO_HOME_DELIVERY_OBSERVED.verifiedLocalities] }
  },
  evidence: {
    url: 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico',
    retrievedAt: '2026-10-13T08:35:00Z',
    note: 'The ₪25 home-courier rate is published on the single 250 g and 4 × 250 g product pages. The ₪15 distribution-center alternative and the exact free-cart observations (charged at ₪198, free on the 7-singles, 8-singles and two-4-pack carts) were observed in anonymous checkout carts on 2026-10-12; see docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json. The checkout’s closed home-delivery locality list was read on 2026-10-13 (264 localities, all five selectable destinations present and the ₪25 option selectable for each; see docs/evidence/browser-research/2026-10-13-coffeeman-home-delivery-locality-coverage.json). On 2026-10-13 the fixed recipe also produced a verified quote record (2 × 250 g, Tel Aviv–Yafo: ₪66 + ₪25 = ₪91) and the ₪15 distribution-center option was applied at ₪15.00 (₪66 + ₪15 = ₪81) for all five selectable destinations; see docs/evidence/browser-research/2026-10-13-coffeeman-recipe-quote-500g-telaviv.json and 2026-10-13-coffeeman-distribution-center-coverage.json.'
  },
  observedFor: {
    carts: ['2 × 250 g = 500 g', '4 × 250 g = 1 kg', '6 × 250 g = 1.5 kg (₪198, courier charged)', '7 × 250 g = 1.75 kg (₪231, free)', '8 × 250 g = 2 kg (₪264 → ₪237.60, free)', '2 × (4 × 250 g) = 2 kg (₪248, free)'],
    destinations: ['Tel Aviv–Yafo / 6100000', 'Jerusalem / 9100000', 'Haifa / 3100000', 'Be’er Sheva / 8400000', 'Eilat / 8800000'],
    note: 'No street address or personal detail was entered and no order was submitted. The ₪25 home-courier option was selectable for all five destinations (2026-10-13); the ₪15 distribution-center option was also present, selectable and applied at ₪15.00 for each of them.'
  },
  reviewBy: '2026-11-11T00:00:00.000Z'
};

/**
 * Coffee4U published door-to-door rate and pickup-point alternative, with the
 * coverage shape observed in the rendered anonymous checkout on 2026-10-12
 * (20:24-20:25 UTC) and extended to the remaining selectable localities on
 * 2026-10-13 (02:01-02:02 UTC). The courier rate and the pickup-point rate are
 * published next to the product; the checkout confirmed the closed destination
 * lists. The 2026-10-13 runs selected Jerusalem, Haifa and Be'er Sheva in the
 * same anonymous estimator, selected the door-to-door courier method and then
 * read the summary: each 2 × 250 g cart quoted ₪76 + ₪30 = ₪106, reproducing
 * the published ₪30 rate at three more destinations with the fee unchanged.
 * Each run's evidence record carries the confirmed `home_delivery` service from
 * the successful method-selection step, so the ₪30 line is attributed to the
 * door-to-door method rather than an unnamed rate. The rule itself is
 * unchanged, so the version bump carries only newer coverage provenance (and
 * the read-time evaluator refreshes that provenance on already-stamped rows).
 */
export const coffee4uHomeDeliveryPolicy = {
  id: 'coffee4u-il-home-delivery',
  version: 3,
  vendorId: 'coffee4u',
  productIds: [PRODUCT_ID],
  itemUrlPrefixes: ['https://www.coffee4u.co.il/product/'],
  service: 'home_delivery',
  origin: 'published',
  certainty: 'verified',
  rule: {
    amount: { amount: 30, currency: 'ILS' },
    freeThreshold: null,
    thresholdSemantics: null,
    minOrder: null,
    maxTotalGrams: null
  },
  alternatives: [{
    id: 'pickup-point',
    label: "Delivery to a צ'יטה שופס pickup point",
    amount: { amount: 15, currency: 'ILS' },
    maxTotalGrams: 5000,
    note: 'Published on the same product page for up to 5 kg; a different service from door-to-door courier delivery. The rendered checkout lists 426 localities with pickup spots (observed 2026-10-13; 420 on 2026-10-12), and all five selectable localities are on that list and quoted ₪76 + ₪15 = ₪91 for a 500 g cart; pickup spots observed: Tel Aviv–Yafo 4, Jerusalem 18, Haifa 27, Be’er Sheva 34, Eilat 3.'
  }],
  destination: {
    scope: 'country',
    country: 'IL',
    caveat: 'Door-to-door delivery is limited to the localities on Coffee4U’s home-delivery list, which the product page does not publish. The rendered anonymous checkout requires the destination from a closed list of 1,269 Israeli localities (Tel Aviv - Yafo and Eilat verified 2026-10-12; Jerusalem, Haifa and Be’er Sheva verified 2026-10-13, each ₪30 for a 500 g cart); the ₪15 pickup-point service lists 426 localities with pickup spots (2026-10-13), and all five selectable localities are on it, each quoting ₪76 + ₪15 = ₪91 for a 500 g cart with observed pickup spots (Tel Aviv–Yafo 4, Jerusalem 18, Haifa 27, Be’er Sheva 34, Eilat 3). Confirm the destination and pickup point at checkout.',
    caveatSource: 'https://www.coffee4u.co.il/page/%D7%AA%D7%A7%D7%A0%D7%95%D7%9F-0',
    observed: {
      courierLocalities: 1269,
      pickupPointLocalities: 426,
      verifiedLocalities: ['תל אביב - יפו', 'אילת', 'ירושלים', 'חיפה', 'באר שבע'],
      pickupPointVerifiedLocalities: ['תל אביב - יפו', 'ירושלים', 'חיפה', 'באר שבע', 'אילת'],
      pickupPointSpotCounts: { 'תל אביב - יפו': 4, 'ירושלים': 18, 'חיפה': 27, 'באר שבע': 34, 'אילת': 3 },
      observedAt: '2026-10-13T02:02:12Z',
      pickupPointObservedAt: '2026-10-13T08:06:00Z',
      entryUrl: 'https://www.coffee4u.co.il/cart.asp',
      evidence: 'docs/evidence/browser-research/2026-10-13-coffee4u-destination-extension.json',
      pickupPointEvidence: 'docs/evidence/browser-research/2026-10-13-coffee4u-pickup-point-coverage.json'
    }
  },
  evidence: {
    url: 'https://www.coffee4u.co.il/product/lavazza-crema-e-gusto-250-gr-%D7%98%D7%97%D7%95%D7%9F',
    retrievedAt: '2026-10-13T08:06:00Z',
    note: 'Door-to-door courier ₪30 and pickup-point ₪15 are published next to the product. Rendered anonymous checkout coverage observed 2026-10-12: the door-to-door method requires an exact match from a closed list of 1,269 Israeli localities (Tel Aviv - Yafo and Eilat verified) and the pickup-point method lists 420 localities with pickup spots. Re-checked 2026-10-13 for the remaining selectable localities: Jerusalem, Haifa and Be’er Sheva each quoted ₪76 + ₪30 = ₪106 for a 2 × 250 g cart, so the ₪30 rate and the closed-list shape are unchanged; see docs/evidence/browser-research/2026-10-12-coffee4u-coverage.json and docs/evidence/browser-research/2026-10-13-coffee4u-destination-extension.json. The pickup-point method was re-checked in the same anonymous cart on 2026-10-13: its locality list held 426 localities, all five selectable localities were present, each quoted ₪76 + ₪15 = ₪91 for the 500 g cart, and pickup spots were listed per locality (Tel Aviv–Yafo 4, Jerusalem 18, Haifa 27, Be’er Sheva 34, Eilat 3); see docs/evidence/browser-research/2026-10-13-coffee4u-pickup-point-coverage.json.'
  },
  observedFor: {
    carts: ['1 × 250 g', '2 × 250 g (500 g carts to Jerusalem, Haifa and Be’er Sheva, 2026-10-13)', '2 × 250 g pickup-point carts to all five selectable localities (2026-10-13)'],
    destinations: ['Tel Aviv - Yafo', 'Eilat', 'ירושלים', 'חיפה', 'באר שבע'],
    method: 'home_delivery (door-to-door courier, selected in the rendered checkout; each run’s evidence record carries the confirmed service) and pickup_point (the ₪15 צ’יטה שופס alternative, selected in the same anonymous cart; each selectable locality was present in the pickup list with spots and quoted ₪76 + ₪15 = ₪91)',
    note: 'No street address or personal detail was entered and no order was submitted.'
  },
  reviewBy: '2026-11-11T00:00:00.000Z'
};

/**
 * Tiv Taam cottage-cheese home delivery, read from the store's own public
 * branch API on 2026-10-15. Branch 924 (Ramat HaHayal, Tel Aviv–Yafo) is the
 * online delivery branch; its areas endpoint lists seven delivery areas, each
 * at ₪29.90 home delivery and none with a per-area minimum. The site terms
 * (clause 16.1) publish a ₪300 minimum order, which is what keeps a standalone
 * 4-10 tub batch below the vendor minimum instead of pretending the anonymous
 * cart total is a purchasable delivered quote. Coverage is limited to the
 * listed areas (part of Tel Aviv–Yafo plus Ramat HaSharon, Ramat Gan, Bnei
 * Brak, Herzliya and Rosh HaAyin), so the destination scope lists only the
 * overlapping selectable destination and carries the area restriction as a
 * caveat. An anonymous cart API was also inspected: it quoted
 * item + ₪29.90 for 4/6/8/10 tubs (₪54.30/₪66.50/₪78.70/₪90.90) without a
 * minimum warning, but the published ₪300 minimum order is the vendor's own
 * condition and is treated as binding. No street address, login or order was
 * involved. Evidence: docs/evidence/tnuva-cottage-cheese-runner-research-20261015.json.
 */
export const tivtaamCottageCheesePolicy = {
  id: 'tivtaam-cottage-tel-aviv-north-delivery',
  version: 1,
  vendorId: 'tivtaam',
  productIds: ['tnuva-cottage-cheese-5-percent'],
  itemUrlPrefixes: ['https://www.tivtaam.co.il/?catalogProduct=12053'],
  service: 'home_delivery',
  origin: 'published',
  certainty: 'verified',
  rule: {
    amount: { amount: 29.9, currency: 'ILS' },
    freeThreshold: null,
    thresholdSemantics: null,
    minOrder: { amount: 300, currency: 'ILS' },
    maxTotalGrams: null
  },
  destination: {
    scope: 'localities',
    localities: ['tel-aviv'],
    caveat: 'Tiv Taam’s Ramat HaHayal branch (the online delivery branch) publishes home delivery only to these areas: ת״א צפון (רמת אביב, רמת החייל, אפקה), רמת השרון, רמת גן, בני ברק, הרצליה and ראש העין. Only part of Tel Aviv–Yafo is covered, coverage outside these areas is not established, and the ₪300 minimum order applies per order. Confirm the address at checkout.',
    caveatSource: 'https://www.tivtaam.co.il/v2/retailers/1062/branches/924/areas?appId=4&deliveryTypeId=1&languageId=2'
  },
  evidence: {
    url: 'https://www.tivtaam.co.il/v2/retailers/1062/branches/924/areas?appId=4&deliveryTypeId=1&languageId=2',
    retrievedAt: '2026-10-15T17:05:00Z',
    note: 'Public branch API read from the GitHub Actions runner on 2026-10-15 and re-verified at 17:05 UTC: branch 924 (Ramat HaHayal, Tel Aviv–Yafo) lists seven active delivery areas, each with deliveryAreaPrice ₪29.90 and deliveryMinimumCost null. The published site terms clause 16.1 and the retailer config minimumOrderPrice set the minimum order at ₪300. An anonymous cart API quote for exact batches (4/6/8/10 tubs) returned item totals ₪24.40/₪36.60/₪48.80/₪61.00 plus ₪29.90 delivery = ₪54.30/₪66.50/₪78.70/₪90.90 with no minimum warning, but the checkout requires login, so the published minimum order is treated as the binding condition. The product API row selected for pricing is the active ₪6.10 row (id 5662070); a hidden inactive ₪5.70 row is never priced. See docs/evidence/tnuva-cottage-cheese-runner-research-20261015.json.'
  },
  observedFor: {
    carts: ['4 tubs = 1 kg (₪24.40 + ₪29.90 = ₪54.30)', '6 tubs = 1.5 kg (₪36.60 + ₪29.90 = ₪66.50)', '8 tubs = 2 kg (₪48.80 + ₪29.90 = ₪78.70)', '10 tubs = 2.5 kg (₪61.00 + ₪29.90 = ₪90.90)'],
    destinations: ['Tel Aviv–Yafo / 6100000 (ת״א צפון areas only)'],
    note: 'Anonymous public cart API quotes; no street address, login, payment or order submission. The ₪300 published minimum order means these standalone batch carts are below the vendor minimum.'
  },
  reviewBy: '2026-11-14T00:00:00.000Z'
};

export const yudaCottageCheesePolicy = {
  id: 'yuda-cottage-tel-aviv-home-delivery',
  version: 1,
  vendorId: 'yuda',
  productIds: ['tnuva-cottage-cheese-5-percent'],
  itemUrlPrefixes: ['https://www.yuda.co.il/?catalogProduct=12053'],
  service: 'home_delivery',
  origin: 'published',
  certainty: 'verified',
  rule: {
    amount: { amount: 35, currency: 'ILS' },
    freeThreshold: null,
    thresholdSemantics: null,
    minOrder: { amount: 150, currency: 'ILS' },
    maxTotalGrams: null
  },
  destination: {
    scope: 'localities',
    localities: ['tel-aviv'],
    caveat: 'Super Yuda publishes three online Tel Aviv–Yafo branches (ישעיהו, אינשטיין, בן ציון), each delivering only inside its own area polygon; the ₪150 minimum order applies per order. Coverage outside those areas is not established. Confirm the address at checkout.',
    caveatSource: 'https://www.yuda.co.il/v2/retailers/1492/branches/2481/areas?appId=4&deliveryTypeId=1&languageId=1'
  },
  evidence: {
    url: 'https://www.yuda.co.il/v2/retailers/1492/branches/2481/areas?appId=4&deliveryTypeId=1&languageId=1',
    retrievedAt: '2026-10-15T17:45:00Z',
    note: 'Public store API read from the GitHub Actions runner on 2026-10-15: branch 2481 (ישעיהו, Tel Aviv–Yafo) returned the tracked listing at ₪6.70 per 250 g tub with isActive/isVisible true, isOutOfStock false and quantityLimit 999, and its area "ישעיהו תל אביב" publishes deliveryAreaPrice ₪35 and deliveryMinimumCost ₪150. The retailer config sets minimumOrderPrice ₪150. The other two visible Tel Aviv branches (2480 אינשטיין, 2485 בן ציון) priced the same ₪6.70 with the same ₪35/₪150 terms; hidden rows (2441 בארט ₪5.70, 2483 נחלת בנימין) are never priced. The store’s Radware WAF served a bot challenge for cart PATCH/GET reads from the runner, so no anonymous-cart total was read and no cart quote is claimed. See docs/evidence/tnuva-cottage-cheese-runner-research-20261015.json.'
  },
  observedFor: {
    carts: [],
    destinations: ['Tel Aviv–Yafo (the three published online Tel Aviv branch areas only)'],
    note: 'Published product and delivery-area endpoints only; cart totals were not readable from the runner because the store served its bot challenge for cart reads. The ₪150 published minimum order is above every requested standalone batch.'
  },
  reviewBy: '2026-11-14T00:00:00.000Z'
};

/** Every validated policy the shared evaluator may apply. */
export const SHIPPING_POLICIES = [
  pucksHomeDeliveryPolicy,
  coffeemanSingleFourPackPolicy,
  coffeemanEightPackPolicy,
  coffee4uHomeDeliveryPolicy,
  tivtaamCottageCheesePolicy,
  yudaCottageCheesePolicy
];

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Validate one policy's shape. Returns { ok, errors } without throwing. */
export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') return { ok: false, errors: ['policy is not an object'] };
  if (!policy.id || typeof policy.id !== 'string') errors.push('id is required');
  if (!Number.isInteger(policy.version) || policy.version < 1) errors.push('version must be a positive integer');
  if (!policy.vendorId) errors.push('vendorId is required');
  if (!Array.isArray(policy.productIds) || policy.productIds.length === 0) errors.push('productIds must be a non-empty array');
  if (policy.service != null && typeof policy.service !== 'string') errors.push('service must be a string when present');
  if (!['observed_cart', 'published'].includes(policy.origin)) errors.push('origin must be "observed_cart" or "published"');
  if (!['verified', 'checkout_quote', 'estimated'].includes(policy.certainty)) errors.push('certainty must be verified, checkout_quote or estimated');
  const amount = policy.rule?.amount;
  if (!amount || !Number.isFinite(amount.amount) || !CURRENCY_PATTERN.test(String(amount.currency ?? ''))) {
    errors.push('rule.amount must carry a numeric amount and a 3-letter currency');
  }
  const threshold = policy.rule?.freeThreshold;
  if (threshold != null && (!Number.isFinite(threshold.amount) || !CURRENCY_PATTERN.test(String(threshold.currency ?? '')))) {
    errors.push('rule.freeThreshold must carry a numeric amount and a 3-letter currency when present');
  }
  if (threshold != null && !['above', 'at_least'].includes(policy.rule?.thresholdSemantics)) {
    errors.push('rule.thresholdSemantics must be "above" or "at_least" when a free threshold is present');
  }
  const thresholdOrigin = policy.rule?.freeThresholdOrigin;
  if (thresholdOrigin != null && !['published', 'observed_cart'].includes(thresholdOrigin)) {
    errors.push('rule.freeThresholdOrigin must be "published" or "observed_cart" when present');
  }
  if (thresholdOrigin != null && threshold == null) {
    errors.push('rule.freeThresholdOrigin needs a freeThreshold');
  }
  if (thresholdOrigin === 'observed_cart' && (!policy.rule?.freeThresholdEvidence?.url || !policy.rule?.freeThresholdEvidence?.retrievedAt)) {
    errors.push('an observed_cart free threshold needs freeThresholdEvidence.url and .retrievedAt');
  }
  // Scoped cart-observed free conditions: the exact cart a vendor showed free,
  // with its listing scope, whole-pack count, ordered grams, subtotal and method.
  // A threshold and scoped conditions are mutually exclusive so a rule cannot
  // silently become a monotone threshold again.
  const freeCartConditions = policy.rule?.freeCartConditions;
  if (freeCartConditions != null) {
    if (!Array.isArray(freeCartConditions) || freeCartConditions.length === 0) {
      errors.push('rule.freeCartConditions must be a non-empty array when present');
    } else if (threshold != null) {
      errors.push('rule.freeThreshold and rule.freeCartConditions cannot both be present');
    } else {
      freeCartConditions.forEach((condition, index) => {
        const at = `rule.freeCartConditions[${index}]`;
        if (!condition || typeof condition !== 'object') { errors.push(`${at} is not an object`); return; }
        if (!condition.id || typeof condition.id !== 'string') errors.push(`${at}.id is required`);
        if (!condition.service || typeof condition.service !== 'string') errors.push(`${at}.service is required`);
        if (condition.sku != null && typeof condition.sku !== 'string') errors.push(`${at}.sku must be a string when present`);
        if (!condition.itemUrlPrefix || typeof condition.itemUrlPrefix !== 'string') errors.push(`${at}.itemUrlPrefix is required`);
        if (!Number.isInteger(condition.packCount) || condition.packCount < 1) errors.push(`${at}.packCount must be a positive integer`);
        if (!Number.isInteger(condition.units) || condition.units < 1) errors.push(`${at}.units must be a positive integer`);
        if (!Number.isFinite(condition.orderedGrams) || condition.orderedGrams <= 0) errors.push(`${at}.orderedGrams must be a positive number`);
        if (!Number.isFinite(condition.itemSubtotalIls)) errors.push(`${at}.itemSubtotalIls must be a number`);
        if (condition.discountPercent != null && (!Number.isFinite(condition.discountPercent) || condition.discountPercent <= 0 || condition.discountPercent > 90)) {
          errors.push(`${at}.discountPercent must be between 0 and 90 when present`);
        }
        if (!Number.isFinite(condition.paidItemTotalIls)) errors.push(`${at}.paidItemTotalIls must be a number`);
        if (!condition.methodLabel || typeof condition.methodLabel !== 'string') errors.push(`${at}.methodLabel is required`);
        if (!condition.observedAt || Number.isNaN(Date.parse(condition.observedAt))) errors.push(`${at}.observedAt must be an ISO date`);
        if (!condition.evidence?.url || !condition.evidence?.note) errors.push(`${at}.evidence.url and .note are required`);
      });
    }
  }
  // A superseded rule is an explicit migration instruction for rows stamped by
  // an older version of the same policy; it must name the exact old amount and
  // semantics so only the superseded threshold is migrated.
  const supersedes = policy.supersedes?.freeThreshold;
  if (supersedes != null) {
    if (!Number.isFinite(supersedes.amount) || !CURRENCY_PATTERN.test(String(supersedes.currency ?? ''))) {
      errors.push('supersedes.freeThreshold must carry a numeric amount and a 3-letter currency');
    }
    if (!['above', 'at_least'].includes(supersedes.semantics)) errors.push('supersedes.freeThreshold.semantics must be "above" or "at_least"');
    if (!['published', 'observed_cart'].includes(supersedes.origin)) errors.push('supersedes.freeThreshold.origin must be "published" or "observed_cart"');
    if (!Number.isInteger(supersedes.policyVersion) || supersedes.policyVersion < 1) errors.push('supersedes.freeThreshold.policyVersion must be a positive integer');
  }
  if (policy.alternatives != null) {
    if (!Array.isArray(policy.alternatives)) {
      errors.push('alternatives must be an array when present');
    } else {
      policy.alternatives.forEach((alternative, index) => {
        if (!alternative || typeof alternative !== 'object') { errors.push(`alternatives[${index}] is not an object`); return; }
        if (!alternative.id || typeof alternative.id !== 'string') errors.push(`alternatives[${index}].id is required`);
        if (!alternative.label || typeof alternative.label !== 'string') errors.push(`alternatives[${index}].label is required`);
        const altAmount = alternative.amount;
        if (!altAmount || !Number.isFinite(altAmount.amount) || !CURRENCY_PATTERN.test(String(altAmount.currency ?? ''))) {
          errors.push(`alternatives[${index}].amount must carry a numeric amount and a 3-letter currency`);
        }
        if (alternative.maxTotalGrams != null && (!Number.isFinite(alternative.maxTotalGrams) || alternative.maxTotalGrams <= 0)) {
          errors.push(`alternatives[${index}].maxTotalGrams must be a positive number when present`);
        }
      });
    }
  }
  if (!policy.evidence?.url || !policy.evidence?.retrievedAt) errors.push('evidence.url and evidence.retrievedAt are required');
  if (!policy.reviewBy || Number.isNaN(Date.parse(policy.reviewBy))) errors.push('reviewBy must be an ISO date');
  if (!policy.destination || !['country', 'localities'].includes(policy.destination.scope)) errors.push('destination.scope must be country or localities');
  if (policy.destination?.scope === 'localities' && !Array.isArray(policy.destination.localities)) {
    errors.push('a localities destination needs a localities array');
  }
  return { ok: errors.length === 0, errors };
}

export function validatePolicies(policies = SHIPPING_POLICIES) {
  const results = policies.map(policy => ({ id: policy?.id ?? null, ...validatePolicy(policy) }));
  return { ok: results.every(result => result.ok), results };
}

/**
 * Is this policy still inside its review window at `now`?
 *
 * The read-time evaluator and the vendor adapters both use this: a policy past
 * its `reviewBy` date must not enrich an old row and must not be stamped onto a
 * freshly parsed row either, so the offer falls back to explicit unknown
 * shipping instead of a stale unconditional rate until browser research renews
 * the evidence.
 */
export function policyIsCurrent(policy, now = Date.now()) {
  const reviewBy = Date.parse(policy?.reviewBy ?? '');
  return Number.isFinite(reviewBy) && reviewBy >= now;
}

/** Does this policy's scope cover the observation? */
function policyMatches(policy, observation) {
  if (!observation || !policy) return false;
  if (policy.vendorId && observation.vendor?.id !== policy.vendorId) return false;
  const productId = observation.product?.productId ?? null;
  if (policy.productIds?.length && !policy.productIds.includes(productId)) return false;
  if (policy.itemUrlPrefixes?.length) {
    const url = String(observation.itemUrl ?? '');
    if (!policy.itemUrlPrefixes.some(prefix => url.startsWith(prefix))) return false;
  }
  if (policy.service != null && observation.shipping?.service != null && observation.shipping.service !== policy.service) return false;
  return true;
}

function ruleKey(rule, alternatives = []) {
  const amount = rule?.amount ? `${rule.amount.amount}${rule.amount.currency}` : '-';
  const threshold = rule?.freeThreshold ? `${rule.freeThreshold.amount}${rule.freeThreshold.currency}` : '-';
  const thresholdScope = `${rule?.thresholdSemantics ?? '-'}/${rule?.freeThresholdOrigin ?? '-'}`;
  const conditionsKey = (rule?.freeCartConditions ?? [])
    .map(condition => `${condition.id}:${condition.units}x${condition.packCount}:${condition.itemSubtotalIls}`)
    .join(',');
  const alternativesKey = alternatives.map(alternative => `${alternative.id}:${alternative.amount?.amount ?? '-'}${alternative.amount?.currency ?? ''}`).join(',');
  return `${amount}/${threshold}/${thresholdScope}/${conditionsKey}/${rule?.minOrder?.amount ?? '-'}/${alternativesKey}`;
}

/**
 * Does this policy describe exactly the money/scope the row already carries?
 * Used before refreshing a stamped row's provenance: a newer policy version may
 * update evidence (coverage, retrieval time) without changing the rule, but a
 * version that changes any amount must not overwrite a parsed rate at read time.
 */
function policyRuleMatchesShipping(policy, shipping) {
  const rule = policy?.rule ?? {};
  const sameAmount = (a, b) => (a?.amount ?? null) === (b?.amount ?? null) && (a?.currency ?? null) === (b?.currency ?? null);
  if (!sameAmount(rule.amount, shipping?.amount)) return false;
  if (!sameAmount(rule.freeThreshold, shipping?.freeThreshold)) return false;
  if ((rule.thresholdSemantics ?? null) !== (shipping?.freeThresholdSemantics ?? null)) return false;
  if ((rule.freeThresholdOrigin ?? null) !== (shipping?.freeThresholdOrigin ?? null)) return false;
  if ((rule.minOrder?.amount ?? null) !== (shipping?.minOrder?.amount ?? null)) return false;
  if ((rule.maxTotalGrams ?? null) !== (shipping?.maxTotalGrams ?? null)) return false;
  const policyConditions = (rule.freeCartConditions ?? [])
    .map(condition => `${condition.id}:${condition.units}x${condition.packCount}:${condition.itemSubtotalIls}`).join(',');
  const rowConditions = (shipping?.freeCartConditions ?? [])
    .map(condition => `${condition.id}:${condition.units}x${condition.packCount}:${condition.itemSubtotalIls}`).join(',');
  if (policyConditions !== rowConditions) return false;
  const policyAlternatives = (policy?.alternatives ?? [])
    .map(alternative => `${alternative.id}:${alternative.amount?.amount ?? '-'}${alternative.amount?.currency ?? ''}`).join(',');
  const rowAlternatives = (shipping?.alternatives ?? [])
    .map(alternative => `${alternative.id}:${alternative.amount?.amount ?? '-'}${alternative.amount?.currency ?? ''}`).join(',');
  return policyAlternatives === rowAlternatives;
}

/**
 * Resolve which policy (if any) may enrich this observation.
 * Statuses: applied | already-known | unmatched | expired | invalid | inconsistent.
 */
export function resolveShippingPolicy({ observation, policies = SHIPPING_POLICIES, now = Date.now() } = {}) {
  const matching = policies.filter(policy => policyMatches(policy, observation));
  if (!matching.length) return { status: 'unmatched', policy: null };
  const valid = [];
  const expired = [];
  const invalid = [];
  for (const policy of matching) {
    const check = validatePolicy(policy);
    if (!check.ok) { invalid.push({ policy, errors: check.errors }); continue; }
    if (Date.parse(policy.reviewBy) < now) expired.push(policy);
    else valid.push(policy);
  }
  if (!valid.length) {
    if (expired.length) return { status: 'expired', policy: expired.sort((a, b) => b.version - a.version)[0] };
    return { status: 'invalid', policy: invalid[0]?.policy ?? null, errors: invalid[0]?.errors ?? [] };
  }
  // One effective rule per policy id: the highest version.
  const latestById = new Map();
  for (const policy of valid) {
    const current = latestById.get(policy.id);
    if (!current || policy.version > current.version) latestById.set(policy.id, policy);
  }
  const effective = [...latestById.values()];
  const keys = new Set(effective.map(policy => ruleKey(policy.rule, policy.alternatives ?? [])));
  if (keys.size > 1) return { status: 'inconsistent', policy: null, policies: effective };
  return { status: 'applied', policy: effective.sort((a, b) => b.version - a.version)[0] };
}

/**
 * Fill only the shipping fields the observation is missing from a matching
 * validated policy. Returns { observation, status, policy }; the original
 * observation is never mutated and its observedAt/price/stock stay untouched.
 */
export function enrichObservationShipping(observation, options = {}) {
  const resolved = resolveShippingPolicy({ observation, ...options });
  if (resolved.status !== 'applied') return { observation, status: resolved.status, policy: resolved.policy ?? null };
  const policy = resolved.policy;
  const shipping = { ...(observation.shipping ?? {}) };
  let changed = false;

  // A rule correction (not new knowledge): the v2 policy applied an
  // unconditional free threshold from ₪231, but the free carts were observed
  // exactly, not as a threshold. A row stamped by that older version of the
  // same policy must stop applying the superseded threshold at read time — the
  // threshold itself came from this policy id, so removing it is not
  // overwriting a fresher vendor parse. The published base amount, the price,
  // the stock and the observation time stay untouched.
  const stampBefore = shipping.policy;
  const superseded = policy.supersedes?.freeThreshold;
  const supersedesRow = Boolean(superseded
    && stampBefore?.id === policy.id
    && Number(stampBefore.version) < policy.version
    && shipping.freeThreshold != null
    && Number(shipping.freeThreshold.amount) === superseded.amount
    && (shipping.freeThreshold.currency ?? null) === superseded.currency
    && (shipping.freeThresholdSemantics ?? null) === superseded.semantics
    && (shipping.freeThresholdOrigin ?? null) === superseded.origin
    && policy.rule?.freeThreshold == null);
  let supersededNote = null;
  if (supersedesRow) {
    delete shipping.freeThreshold;
    delete shipping.freeThresholdSemantics;
    delete shipping.freeThresholdOrigin;
    delete shipping.freeThresholdEvidence;
    supersededNote = `The earlier cart-observed free threshold (from ${superseded.amount} ${superseded.currency}) was superseded by policy ${policy.id} v${policy.version}: free delivery now applies only to the exact carts observed free (${(policy.rule?.freeCartConditions ?? []).map(condition => condition.id).join(', ')}), and a cart that matches none of them keeps the published base rate.`;
    changed = true;
  }

  if ((shipping.certainty === 'unknown' || shipping.amount == null) && policy.rule?.amount?.amount != null) {
    shipping.amount = { ...policy.rule.amount };
    shipping.certainty = policy.certainty;
    changed = true;
  }
  if (shipping.freeThreshold == null && policy.rule?.freeThreshold?.amount != null) {
    shipping.freeThreshold = { ...policy.rule.freeThreshold };
    changed = true;
  }
  // Keep the vendor's boundary wording attached to the threshold it belongs to,
  // so "above ₪100" is never silently evaluated as "at least ₪100".
  if (shipping.freeThresholdSemantics == null && shipping.freeThreshold != null && policy.rule?.thresholdSemantics) {
    shipping.freeThresholdSemantics = policy.rule.thresholdSemantics;
    changed = true;
  }
  // A threshold can be a published rule or a conditional anonymous-cart
  // observation; the origin travels with the amount so the UI can label the
  // free condition instead of presenting it as an unconditional published rate.
  if (shipping.freeThresholdOrigin == null && shipping.freeThreshold != null && policy.rule?.freeThresholdOrigin) {
    shipping.freeThresholdOrigin = policy.rule.freeThresholdOrigin;
    changed = true;
  }
  if (shipping.freeThresholdEvidence == null && shipping.freeThresholdOrigin === 'observed_cart' && policy.rule?.freeThresholdEvidence) {
    shipping.freeThresholdEvidence = { ...policy.rule.freeThresholdEvidence };
    changed = true;
  }
  // Scoped cart-observed free conditions travel with the policy the same way a
  // published threshold does; they are only ever applied when the current cart
  // matches one exactly (see the quote engine), never as a monotone threshold.
  if (shipping.freeCartConditions == null && policy.rule?.freeCartConditions?.length) {
    shipping.freeCartConditions = policy.rule.freeCartConditions.map(condition => ({
      ...condition,
      evidence: { ...condition.evidence }
    }));
    changed = true;
  }
  if (shipping.minOrder == null && policy.rule?.minOrder?.amount != null) {
    shipping.minOrder = { ...policy.rule.minOrder };
    changed = true;
  }
  if (shipping.maxTotalGrams == null && policy.rule?.maxTotalGrams != null) {
    shipping.maxTotalGrams = policy.rule.maxTotalGrams;
    changed = true;
  }
  if (shipping.service == null && policy.service) {
    shipping.service = policy.service;
    changed = true;
  }
  if ((shipping.alternatives == null || shipping.alternatives.length === 0) && policy.alternatives?.length) {
    // Secondary delivery methods (for example a cheaper distribution-center or
    // pickup-point service) are display-only alternatives: they are added when
    // the stored row has none, and they never replace the ranked amount.
    shipping.alternatives = policy.alternatives.map(alternative => ({ ...alternative, amount: { ...alternative.amount } }));
    changed = true;
  }
  if (shipping.destination == null && policy.destination) {
    shipping.destination = { ...policy.destination };
    changed = true;
  } else if (shipping.destination != null && policy.destination) {
    // An older stored row often already carries a generic destination scope but
    // not the coverage caveat the researched evidence established. Keep the
    // row's own scope and add the missing caveat (plus the observed coverage
    // shape when the row has none), so an enriched rate is never presented as
    // unconditional country-wide delivery. A row that already states its own
    // coverage caveat is left as it is.
    if (Boolean(policy.destination.caveat) && shipping.destination.caveat == null) {
      shipping.destination = {
        ...shipping.destination,
        caveat: policy.destination.caveat,
        caveatSource: policy.destination.caveatSource ?? null,
        ...(shipping.destination.observed == null && policy.destination.observed != null
          ? { observed: { ...policy.destination.observed } }
          : {})
      };
      changed = true;
    }
  }

  // A row stamped by an older version of the same policy keeps its amounts (the
  // rule is identical) but must not keep older provenance: newly validated
  // shipping knowledge — a coverage caveat, a re-check time — should reach
  // persisted offers promptly instead of waiting for the next item refresh.
  const stamp = shipping.policy;
  const provenanceRefresh = !changed
    && stamp?.id === policy.id
    && Number.isFinite(Number(stamp.version))
    && Number(stamp.version) < policy.version
    && policyRuleMatchesShipping(policy, shipping);
  if (!changed && !provenanceRefresh) return { observation, status: 'already-known', policy };

  if (provenanceRefresh) {
    if (policy.destination?.caveat && shipping.destination != null) {
      shipping.destination = {
        ...shipping.destination,
        caveat: policy.destination.caveat,
        caveatSource: policy.destination.caveatSource ?? shipping.destination.caveatSource ?? null,
        // The observed coverage shape is policy-derived provenance too (the
        // Coffee4U adapter copies it from the policy). Refreshing it here lets a
        // coverage extension reach already-stamped rows; the caveat text above
        // is what the shopper reads, and the counts/verified localities back it.
        ...(policy.destination.observed != null
          ? { observed: { ...policy.destination.observed, ...(Array.isArray(policy.destination.observed.verifiedLocalities) ? { verifiedLocalities: [...policy.destination.observed.verifiedLocalities] } : {}) } }
          : {})
      };
    }
    // Only refresh evidence that already came from this policy (same URL); a
    // row with its own page-parsed evidence keeps it.
    if (shipping.evidence?.url && policy.evidence?.url && shipping.evidence.url === policy.evidence.url) {
      shipping.evidence = { ...shipping.evidence, retrievedAt: policy.evidence.retrievedAt, note: policy.evidence.note };
    }
  }

  shipping.policy = {
    id: policy.id,
    version: policy.version,
    origin: policy.origin,
    retrievedAt: policy.evidence.retrievedAt,
    reviewBy: policy.reviewBy,
    thresholdSemantics: policy.rule?.thresholdSemantics ?? null,
    freeThresholdOrigin: policy.rule?.freeThresholdOrigin ?? null,
    freeCartConditionIds: (policy.rule?.freeCartConditions ?? []).map(condition => condition.id)
  };
  if (shipping.evidence == null) shipping.evidence = { ...policy.evidence };
  const originText = policy.origin === 'observed_cart' ? 'observed anonymous cart quote' : 'published rule';
  const appliedText = provenanceRefresh
    ? `Shipping evidence refreshed from validated policy ${policy.id} v${policy.version} (observed ${policy.evidence.retrievedAt}); the rate and its quantity scope are unchanged.`
    : `Shipping rule applied from validated policy ${policy.id} v${policy.version} (${originText}, observed ${policy.evidence.retrievedAt}); confirm at checkout.`;
  shipping.note = [shipping.note, supersededNote, appliedText].filter(Boolean).join(' ');
  return { observation: { ...observation, shipping }, status: 'applied', policy };
}

/** Compact policy status for the public status API; no secrets, no payloads. */
export function policySummary(now = Date.now(), policies = SHIPPING_POLICIES) {
  return policies.map(policy => ({
    id: policy.id,
    version: policy.version,
    vendorId: policy.vendorId,
    origin: policy.origin,
    certainty: policy.certainty,
    service: policy.service ?? null,
    alternatives: (policy.alternatives ?? []).map(alternative => alternative.id),
    freeThreshold: policy.rule?.freeThreshold?.amount ?? null,
    thresholdSemantics: policy.rule?.thresholdSemantics ?? null,
    freeThresholdOrigin: policy.rule?.freeThresholdOrigin ?? null,
    freeCartConditions: (policy.rule?.freeCartConditions ?? []).map(condition => ({
      id: condition.id,
      sku: condition.sku ?? null,
      units: condition.units,
      packCount: condition.packCount,
      orderedGrams: condition.orderedGrams,
      itemSubtotalIls: condition.itemSubtotalIls,
      discountPercent: condition.discountPercent ?? null,
      paidItemTotalIls: condition.paidItemTotalIls,
      service: condition.service,
      observedAt: condition.observedAt
    })),
    observedAt: policy.evidence?.retrievedAt ?? null,
    reviewBy: policy.reviewBy,
    expired: Date.parse(policy.reviewBy) < now
  }));
}
