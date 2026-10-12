// Pucks (pucks.co.il), Ramla, Israel — Lavazza ground coffee in a vacuum brick:
// Crema e Gusto Classico 250 g and Qualità Oro 250 g.
// Source of truth: schema.org Product JSON-LD on the public product page.
// Price and listed availability are observed. Shipping is only calculated at
// checkout, so it stays unknown and the offer cannot win the ranking.

import { classifyListing } from '../catalog.js';
import { findJsonLd, textOf } from '../lib/text.js';
import { createObservation, parseError } from './index.js';

const PRODUCT_URL = 'https://pucks.co.il/product/lavazza-crema-e-gusto-ground-coffee-250g';
const QUALITA_ORO_URL = 'https://pucks.co.il/product/lavazza-qualita-oro-ground-coffee-250gr';

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
  parserVersion: 'pucks/2',
  offers: [
    { id: 'classico-250g', url: PRODUCT_URL, kind: 'delivery', productId: 'lavazza-crema-e-gusto-vacuum-ground' },
    { id: 'qualita-oro-250g', url: QUALITA_ORO_URL, kind: 'delivery', productId: 'lavazza-qualita-oro-vacuum-ground' }
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
    shipping: {
      mode: 'delivery',
      certainty: 'unknown',
      amount: null,
      destination: { scope: 'country', country: 'IL' },
      note: shippingNote,
      evidence: { url, retrievedAt: null, note: 'Store states shipping is calculated at checkout.' }
    },
    now
  });
}

export function pucksProductText(html) {
  return textOf(html).slice(0, 400);
}
