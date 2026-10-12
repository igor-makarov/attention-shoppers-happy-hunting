// CoffeeMan / Amigo (coffeeman.co.il), Israel — Lavazza Crema e Gusto Classico 250 g ground.
// The page is a legacy Windows-1255 HTML document with schema.org microdata.
// Price, listed availability, SKU and the published delivery options are parsed
// from the product page. Free self-pickup is kept separate from home delivery.

import { classifyListing } from '../catalog.js';
import { decodeHtml, parseDecimal, stripTags, collapse } from '../lib/text.js';
import { createObservation, parseError } from './index.js';

const PRODUCT_URL = 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';

const AVAILABILITY = {
  InStock: 'in_stock',
  LimitedAvailability: 'in_stock',
  OutOfStock: 'out_of_stock',
  SoldOut: 'out_of_stock',
  PreOrder: 'unknown'
};

export const coffeeman = {
  id: 'coffeeman',
  name: 'CoffeeMan (אמיגו)',
  homepage: 'https://www.coffeeman.co.il',
  allowedHosts: ['www.coffeeman.co.il', 'coffeeman.co.il'],
  parserVersion: 'coffeeman/1',
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
        const html = response.buffer ? decodeHtml(response.buffer, response.text) : response.text;
        observations.push(parseCoffeemanProduct(html, { now }));
      } catch (error) {
        failures.push({ offerId: offer.id, url: offer.url, error: error.message, details: error.details ?? null });
      }
    }
    return { observations, failures };
  }
};

export function parseCoffeemanProduct(html, { now } = {}) {
  const name = extractName(html);
  if (!name) throw parseError('Product name not found', { url: PRODUCT_URL });
  const classification = classifyListing(name);
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
  const observation = createObservation({
    vendor: coffeeman,
    itemUrl: PRODUCT_URL,
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
    availabilityEvidence: {
      url: PRODUCT_URL,
      value: availabilityHref || 'not stated',
      note: 'Availability comes from the product page offer microdata, not from a price-only scrape.'
    },
    shipping: {
      mode: 'delivery',
      certainty: shipping.deliveryCents == null ? 'unknown' : 'verified',
      amount: shipping.deliveryCents == null ? null : { amount: shipping.deliveryCents, currency },
      destination: { scope: 'country', country: 'IL' },
      minOrder: null,
      freeThreshold: null,
      note: shipping.note,
      deliveryTime: deliveryTime || null,
      pickup: {
        available: shipping.pickupFree,
        amount: shipping.pickupFree ? { amount: 0, currency } : null,
        note: shipping.pickupFree ? 'Free self-pickup, listed on the product page.' : null
      },
      evidence: { url: PRODUCT_URL, retrievedAt: null, note: 'Delivery options are listed on the product page.' }
    },
    now
  });
  return observation;
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
  if (h1) return collapse(stripTags(h1));
  const og = /<meta\s+property="og:title"\s+content\s*=\s*"([^"]+)"/i.exec(html)?.[1];
  if (og) return collapse(String(og).replace(/\s*-\s*₪[\d.,]+\s*$/, ''));
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return title ? collapse(stripTags(title).split('|')[0]) : null;
}
