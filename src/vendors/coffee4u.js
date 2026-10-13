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
import { coffee4uHomeDeliveryPolicy } from '../lib/policies.js';
import { decodeHtml, parseDecimal, stripTags, collapse } from '../lib/text.js';
import { createObservation, parseError } from './index.js';

const PRODUCT_URL = 'https://www.coffee4u.co.il/product/lavazza-crema-e-gusto-250-gr-%D7%98%D7%97%D7%95%D7%9F';

// Browser-researched coverage of the rendered anonymous checkout (2026-10-12, no
// order or personal details). The checkout's own destination lists are closed:
// door-to-door requires an exact match from its locality list, and the cheaper
// pickup-point service lists only the localities that have an actual pickup spot.
// The researched coverage and the pickup-point alternative live in the shared,
// validated policy (src/lib/policies.js); these helpers are the adapter-facing
// view of that one representation.
const COFFEE4U_POLICY = coffee4uHomeDeliveryPolicy;
const CHECKOUT_COVERAGE = {
  ...COFFEE4U_POLICY.destination.observed,
  entryUrl: COFFEE4U_POLICY.destination.observed.entryUrl,
  evidence: COFFEE4U_POLICY.destination.observed.evidence
};
// The verified localities are policy provenance, not a hard-coded sentence:
// extending the checkout research must reach the parsed row's note too.
const VERIFIED_LOCALITIES = [...(CHECKOUT_COVERAGE.verifiedLocalities ?? [])];
const PICKUP_POINT_ALTERNATIVE = COFFEE4U_POLICY.alternatives.find(alternative => alternative.id === 'pickup-point');

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
  parserVersion: 'coffee4u/3',
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
        ...COFFEE4U_POLICY.destination,
        observed: {
          ...CHECKOUT_COVERAGE,
          verifiedLocalities: [...CHECKOUT_COVERAGE.verifiedLocalities]
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
        id: PICKUP_POINT_ALTERNATIVE.id,
        label: PICKUP_POINT_ALTERNATIVE.label,
        amount: { amount: shipping.pickupPointAmount, currency },
        maxTotalGrams: PICKUP_POINT_ALTERNATIVE.maxTotalGrams ?? null,
        note: PICKUP_POINT_ALTERNATIVE.note
      }],
      note: `${shipping.note} Rendered anonymous checkout (${CHECKOUT_COVERAGE.observedAt}): the door-to-door method requires an exact match from a closed list of ${new Intl.NumberFormat('en-US').format(CHECKOUT_COVERAGE.courierLocalities)} Israeli localities (${VERIFIED_LOCALITIES.join(', ')} selected, fee unchanged); the ₪15 pickup-point method lists ${CHECKOUT_COVERAGE.pickupPointLocalities} localities with pickup spots.`,
      evidence: { url, retrievedAt: null, note: `Delivery options are listed next to the product on the product page. Checkout coverage observed in the rendered anonymous checkout; see ${CHECKOUT_COVERAGE.evidence}.` },
      policy: {
        id: COFFEE4U_POLICY.id,
        version: COFFEE4U_POLICY.version,
        origin: COFFEE4U_POLICY.origin,
        retrievedAt: COFFEE4U_POLICY.evidence.retrievedAt,
        reviewBy: COFFEE4U_POLICY.reviewBy,
        thresholdSemantics: COFFEE4U_POLICY.rule?.thresholdSemantics ?? null
      }
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
