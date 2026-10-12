// Coffee4U / קופי פור יו (coffee4u.co.il), Tel Aviv, Israel — Lavazza Crema e gusto
// 250 g ground coffee in a vacuum brick. The page is a legacy Windows-1255 document
// with schema.org Product/Offer microdata for price, currency, availability and SKU,
// plus a per-product delivery options list publishing a courier rate and a cheaper
// delivery-to-pickup-point service. Free self-pickup is kept separate from delivery.
//
// The robots.txt allows product pages and asks for a crawl delay of 7 seconds; the
// adapter declares that delay so the refresh pipeline spaces its requests to this host
// instead of assuming the six-hour interval is enough.

import { classifyListing } from '../catalog.js';
import { decodeHtml, parseDecimal, stripTags, collapse } from '../lib/text.js';
import { createObservation, parseError } from './index.js';

const PRODUCT_URL = 'https://www.coffee4u.co.il/product/lavazza-crema-e-gusto-250-gr-%D7%98%D7%97%D7%95%D7%9F';

// Browser-researched coverage of the rendered anonymous checkout (2026-10-12, no
// order or personal details). The checkout's own destination lists are closed:
// door-to-door requires an exact match from its locality list, and the cheaper
// pickup-point service lists only the localities that have an actual pickup spot.
const CHECKOUT_COVERAGE = {
  courierLocalities: 1269,
  pickupPointLocalities: 420,
  verifiedLocalities: ['תל אביב - יפו', 'אילת'],
  observedAt: '2026-10-12T20:25:00Z',
  entryUrl: 'https://www.coffee4u.co.il/cart.asp',
  evidence: 'docs/evidence/browser-research/2026-10-12-coffee4u-coverage.json',
  note: 'Rendered anonymous checkout (2026-10-12): the door-to-door method quotes ₪30.00 with the destination chosen from a closed list of 1,269 Israeli localities (Tel Aviv - Yafo and Eilat selected, fee unchanged); the ₪15 pickup-point method lists 420 localities with pickup spots.'
};

const AVAILABILITY = {
  InStock: 'in_stock',
  LimitedAvailability: 'in_stock',
  OutOfStock: 'out_of_stock',
  SoldOut: 'out_of_stock',
  PreOrder: 'unknown'
};

export const coffee4u = {
  id: 'coffee4u',
  name: 'Coffee4U (קופי פור יו)',
  homepage: 'https://www.coffee4u.co.il',
  allowedHosts: ['www.coffee4u.co.il', 'coffee4u.co.il'],
  parserVersion: 'coffee4u/2',
  crawlDelayMs: 7000,
  offers: [{ id: 'crema-e-gusto-250g-ground', url: PRODUCT_URL, kind: 'delivery', productId: 'lavazza-crema-e-gusto-vacuum-ground' }],

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
        observations.push(parseCoffee4uProduct(html, { now, url: offer.url, productId: offer.productId ?? null }));
      } catch (error) {
        failures.push({ offerId: offer.id, url: offer.url, error: error.message, details: error.details ?? null });
      }
    }
    return { observations, failures };
  }
};

export function parseCoffee4uProduct(html, { now, url = PRODUCT_URL, productId = null } = {}) {
  const name = extractName(html);
  if (!name) throw parseError('Product name not found', { url });
  const classification = classifyListing(name, { productId });
  if (!classification.matched) {
    throw parseError('Listing does not match the tracked product', { name, reasons: classification.reasons });
  }

  const priceMatch = /itemprop="price"[^>]*\bprice="([\d.,]+)"/.exec(html)
    ?? /itemprop="price"[^>]*\bcontent="([\d.,]+)"/.exec(html);
  const priceAmount = parseDecimal(priceMatch?.[1]);
  if (priceAmount == null) throw parseError('Price not found in product microdata', { name });
  const currency = /itemprop="priceCurrency"\s*>\s*([A-Z]{3})/.exec(html)?.[1] ?? null;
  if (!currency) throw parseError('Currency not found in product microdata', { name });

  const availabilityHref = /itemprop="availability"[^>]*href="([^"]+)"/.exec(html)?.[1] ?? '';
  const availability = AVAILABILITY[availabilityHref.split('/').pop()] ?? 'unknown';
  const sku = /itemprop="sku"[^>]*>([^<]+)</.exec(html)?.[1]?.trim() ?? null;

  const shipping = parseCoffee4uShipping(html);
  const observation = createObservation({
    vendor: coffee4u,
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
      category: 'פולי קפה וקפה טחון'
    },
    price: { amount: priceAmount, currency },
    availability,
    availabilityEvidence: {
      url,
      value: availabilityHref || 'not stated',
      note: 'Availability comes from the product page offer microdata, not from a price-only scrape.'
    },
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: shipping.courierAmount == null ? 'unknown' : 'verified',
      amount: shipping.courierAmount == null ? null : { amount: shipping.courierAmount, currency },
      // The product page publishes the door-to-door rate but not the locality list;
      // the vendor terms make home delivery subject to that list, so the board
      // discloses the restriction instead of assuming every Israeli destination.
      // The rendered anonymous checkout showed that list is closed and exact-match,
      // so the caveat names the observed shape and keeps the checkout confirmation.
      destination: {
        scope: 'country',
        country: 'IL',
        caveat: 'Door-to-door delivery is limited to the localities on Coffee4U’s home-delivery list, which the product page does not publish. The rendered anonymous checkout requires the destination from a closed list of 1,269 Israeli localities (Tel Aviv - Yafo and Eilat verified 2026-10-12); the ₪15 pickup-point service lists 420 localities with pickup spots. Confirm the destination at checkout.',
        caveatSource: 'https://www.coffee4u.co.il/page/%D7%AA%D7%A7%D7%A0%D7%95%D7%9F-0',
        observed: {
          courierLocalities: CHECKOUT_COVERAGE.courierLocalities,
          pickupPointLocalities: CHECKOUT_COVERAGE.pickupPointLocalities,
          verifiedLocalities: CHECKOUT_COVERAGE.verifiedLocalities,
          observedAt: CHECKOUT_COVERAGE.observedAt,
          entryUrl: CHECKOUT_COVERAGE.entryUrl,
          evidence: CHECKOUT_COVERAGE.evidence
        }
      },
      minOrder: null,
      freeThreshold: null,
      deliveryTime: shipping.deliveryTime,
      pickup: {
        available: shipping.selfPickup,
        amount: shipping.selfPickup ? { amount: 0, currency } : null,
        note: shipping.selfPickup ? 'Free self-pickup at the shop, listed on the product page.' : null
      },
      alternatives: shipping.pickupPointAmount == null ? [] : [{
        id: 'pickup-point',
        label: "Delivery to a צ'יטה שופס pickup point",
        amount: { amount: shipping.pickupPointAmount, currency },
        note: 'Published on the same product page for up to 5 kg; a different service from door-to-door courier delivery. The rendered checkout lists 420 localities with pickup spots (observed 2026-10-12).'
      }],
      note: `${shipping.note} ${CHECKOUT_COVERAGE.note}`,
      evidence: { url, retrievedAt: null, note: `Delivery options are listed next to the product on the product page. Checkout coverage observed in the rendered anonymous checkout; see ${CHECKOUT_COVERAGE.evidence}.` }
    },
    now
  });
  return observation;
}

export function parseCoffee4uShipping(html) {
  // The delivery list lives in one "delivery-price-product" block. Read to the end of
  // its <ul> so a longer list is still parsed, with a hard cap for untrusted markup.
  const start = html.indexOf('delivery-price-product');
  let block = '';
  if (start >= 0) {
    const listEnd = html.indexOf('</ul>', start);
    const end = listEnd >= 0 ? Math.min(listEnd + 5, start + 4000) : start + 4000;
    block = html.slice(start, end);
  }
  const items = [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(match => ({
    html: match[1],
    text: collapse(stripTags(match[1]))
  }));
  let courierAmount = null;
  let pickupPointAmount = null;
  let selfPickup = false;
  let deliveryTime = null;
  let pickupPointNote = null;
  for (const item of items) {
    const amount = parseDecimal(/<em[^>]*class=['"]?price['"]?[^>]*>\s*([\d.,]+)/.exec(item.html)?.[1])
      ?? parseDecimal(item.text.match(/([\d.,]+)\s*₪/)?.[1]);
    if (/איסוף עצמי/.test(item.text)) {
      selfPickup = true;
    } else if (/נקודת איסוף/.test(item.text)) {
      pickupPointAmount = amount;
      pickupPointNote = item.text;
    } else if (/שליחות|דלת לדלת/.test(item.text)) {
      courierAmount = amount;
      deliveryTime = collapse(item.text.match(/(עד\s*[\d-]+\s*ימי עסקים)/)?.[1] ?? '') || null;
    }
  }

  const notes = [];
  if (courierAmount != null) {
    notes.push(`Published door-to-door courier rate: ₪${courierAmount.toFixed(2)}${deliveryTime ? ` (${deliveryTime})` : ''}.`);
  } else {
    notes.push('No published courier rate found on the product page; delivery cost is unknown before checkout.');
  }
  if (pickupPointAmount != null) {
    notes.push(`The same page publishes delivery to a pickup point for ₪${pickupPointAmount.toFixed(2)} (up to 5 kg, up to 7 business days), a different service that is not used for the ranked delivered total.`);
  }
  if (selfPickup) {
    notes.push('Free self-pickup at the shop is available and is kept separate from delivery.');
  }

  return { courierAmount, pickupPointAmount, selfPickup, deliveryTime, pickupPointNote, note: notes.join(' ') };
}

function extractName(html) {
  const h1 = /<h1[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) return collapse(stripTags(h1));
  const og = /<meta\s+property="og:title"\s+content\s*=\s*"([^"]+)"/i.exec(html)?.[1];
  if (og) return collapse(og);
  return null;
}
