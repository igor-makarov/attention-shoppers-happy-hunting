// Pucks (pucks.co.il), Ramla, Israel — the one tracked product line:
// Lavazza Crema e Gusto Classico 250 g ground coffee in a vacuum brick.
// The Qualità Oro, Qualità Rossa and Suerte pages were retired by the
// 2026-10-12 owner correction and are deliberately not fetched targets.
// Source of truth: schema.org Product JSON-LD on the public product page for
// price and listed availability. Shipping was resolved by browser research on
// 2026-10-12: the anonymous checkout estimator quoted a flat ₪30 home-delivery
// fee with free shipping above ₪100 for 1, 2 and 4 × 250 g carts to Tel Aviv /
// 6100000 (changing the locality to Eilat did not change the rule). The quote
// is stored with its condition and its own retrieval time, never as an
// unconditional country-wide promise.

import { classifyListing } from '../catalog.js';
import { findJsonLd, textOf } from '../lib/text.js';
import { pucksHomeDeliveryPolicy, policyIsCurrent } from '../lib/policies.js';
import { createObservation, parseError } from './index.js';

const PRODUCT_URL = 'https://pucks.co.il/product/lavazza-crema-e-gusto-ground-coffee-250g';

const AVAILABILITY = {
  'https://schema.org/InStock': 'in_stock',
  'https://schema.org/LimitedAvailability': 'in_stock',
  'https://schema.org/OutOfStock': 'out_of_stock',
  'https://schema.org/SoldOut': 'out_of_stock'
};

/**
 * Browser-researched checkout quote (2026-10-12, 18:08-18:10 UTC).
 * The researched rule lives in src/lib/policies.js as a versioned policy so the
 * adapter, the read-time evaluator and the tests share one representation;
 * this constant is the adapter-facing view of that policy.
 * Evidence: docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json
 * and the pucks-checkout-*.png screenshots in the same directory. The public
 * estimator exposed home delivery only; no street address or personal detail
 * was entered and no order was submitted.
 */
export const PUCKS_CHECKOUT_SHIPPING = {
  amountIls: pucksHomeDeliveryPolicy.rule.amount.amount,
  freeThresholdIls: pucksHomeDeliveryPolicy.rule.freeThreshold.amount,
  currency: pucksHomeDeliveryPolicy.rule.amount.currency,
  retrievedAt: pucksHomeDeliveryPolicy.evidence.retrievedAt,
  sourceUrl: pucksHomeDeliveryPolicy.evidence.url,
  note: pucksHomeDeliveryPolicy.evidence.note
};

export const pucks = {
  id: 'pucks',
  name: 'Pucks (פאקס)',
  homepage: 'https://pucks.co.il',
  allowedHosts: ['pucks.co.il', 'www.pucks.co.il'],
  parserVersion: 'pucks/7',
  offers: [
    { id: 'classico-250g', url: PRODUCT_URL, kind: 'delivery', productId: 'lavazza-crema-e-gusto-vacuum-ground' }
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
        observations.push(parsePucksProduct(response.text, { now, url: offer.url, productId: offer.productId ?? null }));
      } catch (error) {
        failures.push({ offerId: offer.id, url: offer.url, error: error.message, details: error.details ?? null });
      }
    }
    return { observations, failures };
  }
};

export function parsePucksProduct(html, { now, url = PRODUCT_URL, productId = null } = {}) {
  const product = findJsonLd(html, 'Product');
  if (!product) throw parseError('No schema.org Product JSON-LD found', { url });
  const offer = product.offers ?? {};
  const name = String(product.name ?? '');
  const classification = classifyListing(name, { productId });
  if (!classification.matched) {
    throw parseError('Listing does not match the tracked product', { name, reasons: classification.reasons });
  }
  const priceAmount = Number(offer.price);
  if (!Number.isFinite(priceAmount)) throw parseError('Price missing from JSON-LD offer', { name, price: offer.price });
  const currency = String(offer.priceCurrency ?? '').toUpperCase();
  if (!currency) throw parseError('Currency missing from JSON-LD offer', { name });
  const availability = AVAILABILITY[String(offer.availability ?? '')] ?? 'unknown';

  const shippingNote = /המשלוח מחושב/.test(html)
    ? 'Shipping is calculated at checkout'
    : 'Shipping terms are not published on the product page';
  // The researched rate is only stamped while its policy is inside its review
  // window. Once `reviewBy` passes the adapter stops applying it and the offer
  // falls back to explicit unknown shipping (never free) until browser research
  // renews the evidence — the same rule the read-time evaluator enforces.
  const policyCurrent = policyIsCurrent(pucksHomeDeliveryPolicy, now);
  const policyStamp = {
    id: pucksHomeDeliveryPolicy.id,
    version: pucksHomeDeliveryPolicy.version,
    origin: pucksHomeDeliveryPolicy.origin,
    retrievedAt: pucksHomeDeliveryPolicy.evidence.retrievedAt,
    reviewBy: pucksHomeDeliveryPolicy.reviewBy,
    thresholdSemantics: pucksHomeDeliveryPolicy.rule.thresholdSemantics
  };

  return createObservation({
    vendor: pucks,
    itemUrl: url,
    product: {
      productId: classification.productId,
      name,
      sku: product.sku ?? product.mpn ?? null,
      gtin: product.gtin13 ?? product.gtin ?? null,
      variantId: classification.variantId,
      variantLabel: classification.variantLabel,
      form: classification.form,
      packGrams: classification.packGrams,
      packCount: classification.packCount,
      totalGrams: classification.totalGrams,
      category: product.category ?? null
    },
    price: { amount: priceAmount, currency },
    availability,
    availabilityEvidence: {
      url,
      value: String(offer.availability ?? 'not stated'),
      note: 'Availability comes from the product page structured data, not from a price-only scrape.'
    },
    shipping: policyCurrent
      ? {
          mode: 'delivery',
          // The estimator offered home delivery only; the method is named separately
          // from the certainty of the rate.
          service: pucksHomeDeliveryPolicy.service,
          // The browser-researched estimator quote is a verified observed rate for
          // the quantities and destination recorded in the evidence; it is not a
          // nationwide guarantee, it was never published on the product page, and
          // it is never used as a zero default.
          certainty: pucksHomeDeliveryPolicy.certainty,
          amount: { ...pucksHomeDeliveryPolicy.rule.amount },
          freeThreshold: { ...pucksHomeDeliveryPolicy.rule.freeThreshold },
          freeThresholdSemantics: pucksHomeDeliveryPolicy.rule.thresholdSemantics,
          destination: { ...pucksHomeDeliveryPolicy.destination },
          note: shippingNote === 'Shipping is calculated at checkout'
            ? `${PUCKS_CHECKOUT_SHIPPING.note} The product page still says shipping is calculated at checkout.`
            : PUCKS_CHECKOUT_SHIPPING.note,
          // Stamp the validated policy on the parsed observation too, so the offer
          // detail can name the rule version and its review date.
          policy: policyStamp,
          evidence: { ...pucksHomeDeliveryPolicy.evidence }
        }
      : {
          mode: 'delivery',
          service: pucksHomeDeliveryPolicy.service,
          // Review overdue: the rate is withheld rather than carried forward, so
          // the offer is visible with an honest unknown instead of a stale quote.
          certainty: 'unknown',
          amount: null,
          destination: { scope: pucksHomeDeliveryPolicy.destination.scope, country: pucksHomeDeliveryPolicy.destination.country },
          note: `The browser-researched ₪30 home-delivery rule is past its review date (${pucksHomeDeliveryPolicy.reviewBy}) and is not applied until browser research re-checks it; shipping is unknown, not free. ${shippingNote}.`,
          policy: policyStamp
        },
    now
  });
}

export function pucksProductText(html) {
  return textOf(html).slice(0, 400);
}
