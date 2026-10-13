// CoffeeMan / Amigo (coffeeman.co.il), Israel — the one tracked product line:
// Lavazza Crema e Gusto Classico ground coffee in a vacuum brick
// (single 250 g pack, 4 × 250 g SKU 930334, 8 × 250 g SKU 930335).
// The Qualità Oro, Qualità Rossa and Suerte pages were retired by the
// 2026-10-12 owner correction and are deliberately not fetched targets.
// The pages are legacy Windows-1255 HTML documents with schema.org microdata.
// Price, listed availability, SKU and the published delivery options are parsed from each
// product page. Free self-pickup is kept separate from home delivery. The 8-pack page does not
// publish a courier price; the anonymous checkout estimator quoted ₪20 for one 2 kg multipack
// during browser research on 2026-10-12, so that offer now carries the observed cart rate with
// its 2 kg condition instead of staying unconditionally unknown.
// robots.txt asks for a crawl delay of 7 seconds; the adapter declares that delay so the
// refresh pipeline spaces its requests to this host.

import { classifyListing } from '../catalog.js';
import { decodeHtml, decodeEntities, parseDecimal, stripTags, collapse } from '../lib/text.js';
import { coffeemanEightPackPolicy, coffeemanSingleFourPackPolicy, policyIsCurrent } from '../lib/policies.js';
import { coffeemanGroundCoffeePercentPromotion } from '../lib/promotions.js';
import { createObservation, parseError } from './index.js';

const PRODUCT_URL = 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const FOUR_PACK_URL = 'https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const EIGHT_PACK_URL = 'https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';

const AVAILABILITY = {
  InStock: 'in_stock',
  LimitedAvailability: 'in_stock',
  OutOfStock: 'out_of_stock',
  SoldOut: 'out_of_stock',
  PreOrder: 'unknown'
};

const CREMA_E_GUSTO = 'lavazza-crema-e-gusto-vacuum-ground';

/**
 * Browser-researched checkout quote for the 8 × 250 g multipack (2026-10-12,
 * 18:16 UTC, re-checked in a fresh cart at 20:07 UTC). The researched rule
 * lives in src/lib/policies.js as a versioned policy so the adapter, the
 * read-time evaluator and the tests share one representation; this constant is
 * the adapter-facing view of that policy. The distribution-center alternative
 * is a second cart-observed method that happened to cost the same ₪20.
 * Evidence: docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json
 * and the coffeeman-checkout-8pack.png screenshot. No street address, personal
 * detail, login or order submission was involved.
 */
export const COFFEEMAN_CHECKOUT_QUOTES = {
  [EIGHT_PACK_URL]: {
    amountIls: coffeemanEightPackPolicy.rule.amount.amount,
    currency: coffeemanEightPackPolicy.rule.amount.currency,
    maxTotalGrams: coffeemanEightPackPolicy.rule.maxTotalGrams,
    distributionCenterIls: coffeemanEightPackPolicy.alternatives.find(alternative => alternative.id === 'distribution-center').amount.amount,
    observedCarts: 'the 2 kg cart',
    retrievedAt: coffeemanEightPackPolicy.evidence.retrievedAt,
    sourceUrl: coffeemanEightPackPolicy.evidence.url,
    note: coffeemanEightPackPolicy.evidence.note
  }
};

/**
 * Browser-researched anonymous-cart observations for the single 250 g and
 * 4 × 250 g listings (2026-10-12, 19:56-20:09 UTC). The product page lists the
 * distribution-center delivery option without a price; the cart quoted ₪15 for
 * 0.5-1 kg carts and free home courier from a ₪231 item subtotal (charged at
 * ₪198), so the free condition is applied from ₪231 for these two listings and
 * keeps its observed-cart origin. The ₪240 8-pack SKU cart kept its own ₪20
 * quote and is covered by a separate policy. Evidence:
 * docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json.
 * No street address, personal detail, login or order submission was involved.
 */
export const COFFEEMAN_CART_OBSERVATIONS = {
  [PRODUCT_URL]: singleFourPackCartObservation(),
  [FOUR_PACK_URL]: singleFourPackCartObservation()
};

/**
 * The cart-researched distribution-center observation is stored once in the
 * validated policy (`coffeeman-single-4pack-il-home-delivery`); this helper is
 * the adapter-facing view of that policy, so the parsed row and the read-time
 * evaluator share one representation instead of a second hard-coded string.
 */
function singleFourPackCartObservation() {
  const alternative = coffeemanSingleFourPackPolicy.alternatives.find(entry => entry.id === 'distribution-center');
  return {
    distributionCenterIls: alternative.amount.amount,
    observedCarts: '0.5–1 kg carts',
    freeThresholdIls: coffeemanSingleFourPackPolicy.rule.freeThreshold?.amount ?? null,
    freeThresholdOrigin: coffeemanSingleFourPackPolicy.rule.freeThresholdOrigin ?? null,
    retrievedAt: coffeemanSingleFourPackPolicy.evidence.retrievedAt,
    sourceUrl: 'https://www.coffeeman.co.il/checkout.asp',
    note: alternative.note
  };
}

export const coffeeman = {
  id: 'coffeeman',
  name: 'CoffeeMan (אמיגו)',
  homepage: 'https://www.coffeeman.co.il',
  allowedHosts: ['www.coffeeman.co.il', 'coffeeman.co.il'],
  parserVersion: 'coffeeman/7',
  crawlDelayMs: 7000,
  offers: [
    { id: 'classico-250g', url: PRODUCT_URL, kind: 'delivery', productId: CREMA_E_GUSTO },
    { id: 'classico-1000g-4pack', url: FOUR_PACK_URL, kind: 'delivery', productId: CREMA_E_GUSTO },
    { id: 'classico-2000g-8pack', url: EIGHT_PACK_URL, kind: 'delivery', productId: CREMA_E_GUSTO }
  ],

  async observe({ fetchText, now }) {
    const observations = [];
    const failures = [];
    for (const offer of this.offers) {
      const response = await fetchText(offer.url, { accept: 'text/html' });
      if (!response.ok) {
        failures.push({ offerId: offer.id, url: offer.url, error: response.error ?? `HTTP ${response.status}` });
        continue;
      }
      try {
        const html = response.buffer ? decodeHtml(response.buffer, response.text) : response.text;
        observations.push(parseCoffeemanProduct(html, { now, url: offer.url, productId: offer.productId ?? null }));
      } catch (error) {
        failures.push({ offerId: offer.id, url: offer.url, error: error.message, details: error.details ?? null });
      }
    }
    return { observations, failures };
  }
};

export function parseCoffeemanProduct(html, { now, url = PRODUCT_URL, productId = null } = {}) {
  const name = extractName(html);
  if (!name) throw parseError('Product name not found', { url });
  const classification = classifyListing(name, { productId });
  if (!classification.matched) {
    throw parseError('Listing does not match the tracked product', { name, reasons: classification.reasons });
  }

  const priceMatch = /itemprop="price"[^>]*\bprice="([\d.,]+)"/.exec(html) ?? /itemprop="price"[^>]*\bcontent="([\d.,]+)"/.exec(html);
  const priceAmount = parseDecimal(priceMatch?.[1]);
  if (priceAmount == null) throw parseError('Price not found in product microdata', { name });
  const currency = /itemprop="priceCurrency"\s*>\s*([A-Z]{3})/.exec(html)?.[1] ?? null;
  if (!currency) throw parseError('Currency not found in product microdata', { name });

  const regularMatch = /\bprice="([\d.,]+)"\s+id="total_regularprice"/.exec(html) ?? /\bprice="([\d.,]+)"[^>]*class="toal_regularprice_view"/.exec(html);
  const regularPrice = parseDecimal(regularMatch?.[1]);

  const availabilityHref = /itemprop="availability"[^>]*href="([^"]+)"/.exec(html)?.[1] ?? '';
  const availability = AVAILABILITY[availabilityHref.split('/').pop()] ?? 'unknown';
  const sku = /itemprop="sku"[^>]*>([^<]+)</.exec(html)?.[1]?.trim()
    ?? /מקט:\s*(\d+)/.exec(html)?.[1]
    ?? null;
  const deliveryTime = collapse(/זמן\s*אספקה\s*:\s*([^<\n]+)/.exec(html)?.[1] ?? '');

  const shipping = parseShippingOptions(html);
  // The vendor publishes the ground-coffee quantity promotion in its own
  // promotion banner on the single-pack page. Parse it on every fetch so an
  // ended promotion stops applying with the next observation.
  const parsedPromotion = parseCoffeemanPromotion(html, { url, retrievedAt: new Date(now ?? Date.now()).toISOString() });
  const promotions = parsedPromotion ? [parsedPromotion] : [];
  const checkoutQuote = checkoutQuoteFor({ url, classification });
  const cartObservation = cartObservationFor({ url, classification });
  const coveragePolicy = checkoutQuote ? coffeemanEightPackPolicy : coffeemanSingleFourPackPolicy;
  const distributionCenterAlternative = coveragePolicy.alternatives?.find(alternative => alternative.id === 'distribution-center') ?? null;
  // Policy-derived rates are only applied while the policy is inside its review
  // window. The page-published ₪25 courier rate stands on its own; the
  // checkout-quoted 8-pack rate and the cart-observed distribution-center
  // alternative are withheld once `reviewBy` passes, so an overdue policy means
  // explicit unknown shipping instead of a stale unconditional rate.
  const policyCurrent = policyIsCurrent(coveragePolicy, now);
  const checkoutQuoteCurrent = checkoutQuote != null && policyCurrent;
  const cartObservationCurrent = cartObservation != null && policyCurrent;
  // The cart-observed free condition belongs to the single/4-pack policy only
  // (the 8-pack SKU kept its own ₪20 quote). It is applied only while the policy
  // is current and only when the page actually publishes the courier rate the
  // free condition modifies; once `reviewBy` passes the offer falls back to the
  // published rate with no free condition instead of a stale free promise.
  const freeThresholdRule = coveragePolicy === coffeemanSingleFourPackPolicy && policyCurrent && shipping.deliveryCents != null
    ? coffeemanSingleFourPackPolicy.rule
    : null;
  const overdueNote = (checkoutQuote || cartObservation) && !policyCurrent
    ? `The browser-researched checkout rule is past its review date (${coveragePolicy.reviewBy}) and is not applied until browser research re-checks it.`
    : null;
  const shippingNote = [...new Set([
    shipping.note,
    checkoutQuoteCurrent ? checkoutQuote?.note : null,
    cartObservationCurrent ? cartObservation?.note : null,
    overdueNote
  ].filter(Boolean))].join(' ');
  const observation = createObservation({
    vendor: coffeeman,
    itemUrl: url,
    product: {
      productId: classification.productId,
      name,
      sku,
      gtin: null,
      variantId: classification.variantId,
      variantLabel: classification.variantLabel,
      form: classification.form,
      packGrams: classification.packGrams,
      packCount: classification.packCount,
      totalGrams: classification.totalGrams,
      category: 'קפה טחון'
    },
    price: { amount: priceAmount, currency, regularAmount: regularPrice },
    availability,
    promotions,
    availabilityEvidence: {
      url,
      value: availabilityHref || 'not stated',
      note: 'Availability comes from the product page offer microdata, not from a price-only scrape.'
    },
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: shipping.deliveryCents != null ? 'verified' : checkoutQuoteCurrent ? 'checkout_quote' : 'unknown',
      amount: shipping.deliveryCents != null
        ? { amount: shipping.deliveryCents, currency }
        : checkoutQuoteCurrent
          ? { amount: checkoutQuote.amountIls, currency: checkoutQuote.currency }
          : null,
      // A checkout-quoted rate is only used for the cart size it was observed
      // on; the quote engine refuses to rank a larger cart with it.
      maxTotalGrams: shipping.deliveryCents != null ? null : checkoutQuoteCurrent ? checkoutQuote.maxTotalGrams ?? null : null,
      // The product page publishes the courier rate but not the locality list, and the
      // vendor terms state home delivery is subject to that list. The caveat is kept
      // structured so the board can disclose the geographic restriction instead of
      // claiming unconditional country-wide coverage.
      destination: {
        scope: coveragePolicy.destination.scope,
        country: coveragePolicy.destination.country,
        caveat: coveragePolicy.destination.caveat,
        caveatSource: coveragePolicy.destination.caveatSource
      },
      minOrder: null,
      freeThreshold: freeThresholdRule?.freeThreshold ? { ...freeThresholdRule.freeThreshold } : null,
      freeThresholdSemantics: freeThresholdRule?.thresholdSemantics ?? null,
      freeThresholdOrigin: freeThresholdRule?.freeThresholdOrigin ?? null,
      freeThresholdEvidence: freeThresholdRule?.freeThresholdEvidence ? { ...freeThresholdRule.freeThresholdEvidence } : null,
      // The distribution-center option is listed on the product page without a
      // price; the anonymous cart quoted it for the recorded cart sizes, so it
      // is shown as a conditional alternative and never replaces the ranked rate.
      alternatives: shipping.distributionCenter && distributionCenterAlternative && policyCurrent
        ? [{
            id: distributionCenterAlternative.id,
            label: distributionCenterAlternative.label,
            amount: { ...distributionCenterAlternative.amount },
            maxTotalGrams: distributionCenterAlternative.maxTotalGrams ?? null,
            note: distributionCenterAlternative.note
          }]
        : [],
      note: shippingNote,
      deliveryTime: deliveryTime || null,
      pickup: {
        available: shipping.pickupFree,
        amount: shipping.pickupFree ? { amount: 0, currency } : null,
        note: shipping.pickupFree ? 'Free self-pickup, listed on the product page.' : null
      },
      evidence: checkoutQuoteCurrent
        ? {
            url: checkoutQuote.sourceUrl,
            retrievedAt: checkoutQuote.retrievedAt,
            note: 'Anonymous checkout estimator quote recorded by interactive browser research; see docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json.'
          }
        : { url, retrievedAt: null, note: 'Delivery options are listed on the product page.' },
      // Stamp the validated policy the parsed row's coverage and alternatives
      // come from, so the offer detail can name the rule version and its review
      // date instead of an unexplained adapter constant. The adapter and the
      // read-time evaluator therefore share one researched representation.
      policy: {
        id: coveragePolicy.id,
        version: coveragePolicy.version,
        origin: coveragePolicy.origin,
        retrievedAt: coveragePolicy.evidence.retrievedAt,
        reviewBy: coveragePolicy.reviewBy,
        thresholdSemantics: coveragePolicy.rule?.thresholdSemantics ?? null,
        freeThresholdOrigin: coveragePolicy.rule?.freeThresholdOrigin ?? null
      }
    },
    now
  });
  return observation;
}

/**
 * Resolve the browser-researched checkout quote for a parsed listing. The URL
 * is the primary key; the tracked 8 × 250 g = 2 kg multipack shape is accepted
 * as a fallback so fixture tests that pass a placeholder URL still exercise the
 * same offer identity.
 */
function checkoutQuoteFor({ url, classification }) {
  if (COFFEEMAN_CHECKOUT_QUOTES[url]) return COFFEEMAN_CHECKOUT_QUOTES[url];
  if (classification.packCount === 8 && classification.totalGrams === 2000) return COFFEEMAN_CHECKOUT_QUOTES[EIGHT_PACK_URL];
  return null;
}

/**
 * Resolve the cart-researched distribution-center observation for a parsed
 * listing. The 8-pack quote doubles as its own cart observation; the 4-pack is
 * accepted by shape so fixture tests with a placeholder URL still exercise it.
 */
function cartObservationFor({ url, classification }) {
  if (COFFEEMAN_CART_OBSERVATIONS[url]) return COFFEEMAN_CART_OBSERVATIONS[url];
  if (classification.packCount === 4 && classification.totalGrams === 1000) return COFFEEMAN_CART_OBSERVATIONS[FOUR_PACK_URL];
  const quote = checkoutQuoteFor({ url, classification });
  return quote?.distributionCenterIls != null ? quote : null;
}

/**
 * Parse the vendor's published promotion banner(s) into the validated promotion
 * shape (src/lib/promotions.js). Only a ground-coffee percent-off rule with a
 * stated ILS subtotal becomes a promotion: the ₪990 vacuum-container gift
 * banner shown on the multipack pages states no discount and is ignored, so it
 * can never be turned into a price reduction.
 */
export function parseCoffeemanPromotion(html, { url = PRODUCT_URL, retrievedAt = new Date().toISOString() } = {}) {
  const blocks = [...html.matchAll(/<h3[^>]*class="promotionName"[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*class="promotionDesc"[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const block of blocks) {
    const name = decodeEntities(collapse(stripTags(block[1])));
    const description = decodeEntities(collapse(stripTags(block[2])));
    const text = `${name} ${description}`.trim();
    if (!/הנחה/.test(text) || !/קפה טחון/.test(text)) continue;
    const percent = Number(/(\d{1,2})\s*%/.exec(text)?.[1]);
    const minItemSubtotal = parseDecimal(/ב-?\s*([\d.,]+)\s*ש["״]ח/.exec(text)?.[1]);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 90 || minItemSubtotal == null) continue;
    return {
      id: coffeemanGroundCoffeePercentPromotion.id,
      vendorId: coffeeman.id,
      productIds: [...coffeemanGroundCoffeePercentPromotion.productIds],
      itemUrlPrefixes: [url],
      percent,
      minItemSubtotal: { amount: minItemSubtotal, currency: 'ILS' },
      // The vendor's own wording decides the boundary: "ב-250 ש\"ח" is "at ₪250".
      semantics: /(?:מעל\s*ל?|מעל\s|מעל-)/.test(description) ? 'above' : 'at_least',
      excludesMultipacks: /לא כולל מארזים/.test(text),
      origin: 'published',
      wording: text,
      evidence: { url, retrievedAt, note: 'Promotion banner parsed from the product page HTML (promotionName/promotionDesc).' }
    };
  }
  return null;
}

export function parseShippingOptions(html) {
  const start = html.indexOf('delivery-price-product');
  const block = start >= 0 ? html.slice(start, start + 2500) : '';
  const items = [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(match => collapse(stripTags(match[1])));
  let deliveryCents = null;
  let pickupFree = false;
  let distributionCenter = null;
  for (const item of items) {
    if (item.includes('איסוף עצמי')) {
      pickupFree = true;
    } else if (item.includes('שליח')) {
      const amount = parseDecimal(item.match(/([\d.,]+)/)?.[1]);
      if (amount != null) deliveryCents = amount;
    } else if (item.includes('מרכז חלוקה')) {
      distributionCenter = item;
    }
  }
  const notes = [];
  if (deliveryCents != null) {
    notes.push(`Published courier delivery rate: ₪${deliveryCents.toFixed(2)}.`);
  } else {
    notes.push('No published courier rate found; delivery cost is unknown before checkout.');
  }
  if (distributionCenter) {
    notes.push('A distribution-center delivery option exists, but its price is not published on the product page.');
  }
  if (pickupFree) {
    notes.push('Free self-pickup is available and is kept separate from delivery.');
  }
  return { deliveryCents, pickupFree, distributionCenter, note: notes.join(' ') };
}

function extractName(html) {
  const h1 = /<h1[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) return decodeEntities(collapse(stripTags(h1)));
  const og = /<meta\s+property="og:title"\s+content\s*=\s*"([^"]+)"/i.exec(html)?.[1];
  if (og) return decodeEntities(collapse(String(og).replace(/\s*-\s*₪[\d.,]+\s*$/, '')));
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return title ? decodeEntities(collapse(stripTags(title).split('|')[0])) : null;
}
