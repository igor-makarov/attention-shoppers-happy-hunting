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
 * Browser-researched checkout quotes (2026-10-12, 18:16-18:17 UTC).
 * Evidence: docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json
 * and the coffeeman-checkout-8pack.png screenshot. No street address, personal
 * detail, login or order submission was involved.
 */
export const COFFEEMAN_CHECKOUT_QUOTES = {
  [EIGHT_PACK_URL]: {
    amountIls: 20,
    currency: 'ILS',
    maxTotalGrams: 2000,
    distributionCenterIls: 20,
    observedCarts: 'the 2 kg cart',
    retrievedAt: '2026-10-12T20:07:00Z',
    sourceUrl: 'https://www.coffeeman.co.il/checkout.asp',
    note: 'Anonymous checkout quote for one 8 × 250 g multipack (2 kg) on 2026-10-12, re-checked in a fresh cart at 20:07 UTC: ₪20 home courier and ₪20 distribution-center delivery up to 5 kg; self-pickup free. The product page publishes no courier price, and carts above 2 kg are not verified.'
  }
};

/**
 * Browser-researched anonymous-cart observations for the single 250 g and
 * 4 × 250 g listings (2026-10-12, 19:56-20:09 UTC). The product page lists the
 * distribution-center delivery option without a price; the cart quoted ₪15 for
 * 0.5-1 kg carts, and larger carts were sometimes shown free. No free-shipping
 * rule is published, so the board keeps the published ₪25 courier rate as the
 * ranked amount and never assumes free shipping. Evidence:
 * docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json.
 * No street address, personal detail, login or order submission was involved.
 */
export const COFFEEMAN_CART_OBSERVATIONS = {
  [PRODUCT_URL]: {
    distributionCenterIls: 15,
    observedCarts: '0.5–1 kg carts',
    retrievedAt: '2026-10-12T19:57:00Z',
    sourceUrl: 'https://www.coffeeman.co.il/checkout.asp',
    note: 'Anonymous cart 2026-10-12 (https://www.coffeeman.co.il/checkout.asp): ₪25 home courier (matching the published rate) and ₪15 distribution-center delivery up to 5 kg for 0.5–1 kg carts; free courier was observed from a 1.75 kg / ₪231 cart, but no free-shipping rule is published, so the board keeps the published ₪25 and never assumes free shipping.'
  },
  [FOUR_PACK_URL]: {
    distributionCenterIls: 15,
    observedCarts: 'the 1 kg cart',
    retrievedAt: '2026-10-12T20:04:00Z',
    sourceUrl: 'https://www.coffeeman.co.il/checkout.asp',
    note: 'Anonymous cart 2026-10-12 (https://www.coffeeman.co.il/checkout.asp): ₪25 home courier (matching the published rate) and ₪15 distribution-center delivery up to 5 kg for the 1 kg cart; free courier was observed for a 2 kg / ₪248 two-4-pack cart, but no free-shipping rule is published, so the board keeps the published ₪25 and never assumes free shipping.'
  }
};

export const coffeeman = {
  id: 'coffeeman',
  name: 'CoffeeMan (אמיגו)',
  homepage: 'https://www.coffeeman.co.il',
  allowedHosts: ['www.coffeeman.co.il', 'coffeeman.co.il'],
  parserVersion: 'coffeeman/6',
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
  const checkoutQuote = checkoutQuoteFor({ url, classification });
  const cartObservation = cartObservationFor({ url, classification });
  const shippingNote = [...new Set([shipping.note, checkoutQuote?.note, cartObservation?.note].filter(Boolean))].join(' ');
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
    availabilityEvidence: {
      url,
      value: availabilityHref || 'not stated',
      note: 'Availability comes from the product page offer microdata, not from a price-only scrape.'
    },
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: shipping.deliveryCents != null ? 'verified' : checkoutQuote ? 'checkout_quote' : 'unknown',
      amount: shipping.deliveryCents != null
        ? { amount: shipping.deliveryCents, currency }
        : checkoutQuote
          ? { amount: checkoutQuote.amountIls, currency: checkoutQuote.currency }
          : null,
      // A checkout-quoted rate is only used for the cart size it was observed
      // on; the quote engine refuses to rank a larger cart with it.
      maxTotalGrams: shipping.deliveryCents != null ? null : checkoutQuote?.maxTotalGrams ?? null,
      // The product page publishes the courier rate but not the locality list, and the
      // vendor terms state home delivery is subject to that list. The caveat is kept
      // structured so the board can disclose the geographic restriction instead of
      // claiming unconditional country-wide coverage.
      destination: {
        scope: 'country',
        country: 'IL',
        caveat: 'Home delivery is limited to the localities on Amigo’s home-delivery list, which the product page does not publish. Confirm the destination at checkout.',
        caveatSource: 'https://www.coffeeman.co.il/page/%D7%AA%D7%A0%D7%90%D7%99-%D7%A9%D7%99%D7%9E%D7%95%D7%A9'
      },
      minOrder: null,
      freeThreshold: null,
      // The distribution-center option is listed on the product page without a
      // price; the anonymous cart quoted it for the recorded cart sizes, so it
      // is shown as a conditional alternative and never replaces the ranked rate.
      alternatives: shipping.distributionCenter && cartObservation?.distributionCenterIls != null
        ? [{
            id: 'distribution-center',
            label: `Distribution-center delivery up to 5 kg (cart-observed for ${cartObservation.observedCarts})`,
            amount: { amount: cartObservation.distributionCenterIls, currency },
            note: cartObservation.note
          }]
        : [],
      note: shippingNote,
      deliveryTime: deliveryTime || null,
      pickup: {
        available: shipping.pickupFree,
        amount: shipping.pickupFree ? { amount: 0, currency } : null,
        note: shipping.pickupFree ? 'Free self-pickup, listed on the product page.' : null
      },
      evidence: checkoutQuote
        ? {
            url: checkoutQuote.sourceUrl,
            retrievedAt: checkoutQuote.retrievedAt,
            note: 'Anonymous checkout estimator quote recorded by interactive browser research; see docs/evidence/browser-research/2026-10-12-vendor-shipping-quotes.json.'
          }
        : { url, retrievedAt: null, note: 'Delivery options are listed on the product page.' }
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
