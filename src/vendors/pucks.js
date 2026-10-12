// Pucks (pucks.co.il), Ramla, Israel — Lavazza Crema e Gusto Classico 250 g ground.
// Source of truth: schema.org Product JSON-LD on the public product page.
// Price and listed availability are observed. Shipping is only calculated at
// checkout, so it stays unknown and the offer cannot win the ranking.

import { classifyListing } from '../catalog.js';
import { findJsonLd, textOf } from '../lib/text.js';
import { createObservation, parseError } from './index.js';

const PRODUCT_URL = 'https://pucks.co.il/product/lavazza-crema-e-gusto-ground-coffee-250g';

const AVAILABILITY = {
  'https://schema.org/InStock': 'in_stock',
  'https://schema.org/LimitedAvailability': 'in_stock',
  'https://schema.org/OutOfStock': 'out_of_stock',
  'https://schema.org/SoldOut': 'out_of_stock'
};

export const pucks = {
  id: 'pucks',
  name: 'Pucks (פאקס)',
  homepage: 'https://pucks.co.il',
  allowedHosts: ['pucks.co.il', 'www.pucks.co.il'],
  parserVersion: 'pucks/1',
  offers: [{ id: 'classico-250g', url: PRODUCT_URL, kind: 'delivery' }],

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
        observations.push(parsePucksProduct(response.text, { now }));
      } catch (error) {
        failures.push({ offerId: offer.id, url: offer.url, error: error.message, details: error.details ?? null });
      }
    }
    return { observations, failures };
  }
};

export function parsePucksProduct(html, { now } = {}) {
  const product = findJsonLd(html, 'Product');
  if (!product) throw parseError('No schema.org Product JSON-LD found', { url: PRODUCT_URL });
  const offer = product.offers ?? {};
  const name = String(product.name ?? '');
  const classification = classifyListing(name);
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

  return createObservation({
    vendor: pucks,
    itemUrl: PRODUCT_URL,
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
      url: PRODUCT_URL,
      value: String(offer.availability ?? 'not stated'),
      note: 'Availability comes from the product page structured data, not from a price-only scrape.'
    },
    shipping: {
      mode: 'delivery',
      certainty: 'unknown',
      amount: null,
      destination: { scope: 'country', country: 'IL' },
      note: shippingNote,
      evidence: { url: PRODUCT_URL, retrievedAt: null, note: 'Store states shipping is calculated at checkout.' }
    },
    now
  });
}

export function pucksProductText(html) {
  return textOf(html).slice(0, 400);
}
