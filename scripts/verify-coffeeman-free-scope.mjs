#!/usr/bin/env node
// Reproduce CoffeeMan's anonymous-cart free-delivery observations through the
// production quote engine and write the scope matrix as evidence.
//
//   node scripts/verify-coffeeman-free-scope.mjs [--out <path>]
//
// The carts below are the exact anonymous checkout configurations recorded in
// docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json
// (no order, login, account, street address or bot-challenge bypass). The rows
// are shaped like the persisted observations (unknown shipping) so the engine
// enriches them from the validated policy, and each result is compared with the
// fee the vendor actually displayed. The matrix also covers carts that were
// never observed (3 kg of singles, three 4-packs, a repriced 8-singles cart):
// those must keep the published ₪25 base rate instead of inheriting free
// delivery from a subtotal.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { quoteBoard, findDestination } from '../src/lib/quote.js';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = resolve(outIndex >= 0 ? args[outIndex + 1] : 'docs/evidence/coffeeman-free-condition-20261013.json');

const NOW = Date.parse('2026-10-13T02:30:00.000Z');
const SINGLE_URL = 'https://www.coffeeman.co.il/product/250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const FOUR_PACK_URL = 'https://www.coffeeman.co.il/product/4-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';
const EIGHT_PACK_URL = 'https://www.coffeeman.co.il/product/8-%D7%90%D7%A8%D7%99%D7%96%D7%95%D7%AA-250-%D7%92%D7%A8%D7%9D-%D7%A7%D7%A4%D7%94-%D7%98%D7%97%D7%95%D7%9F-lavazza-crema-e-gusto-classico';

const vendor = { id: 'coffeeman', name: 'CoffeeMan (אמיגו)', homepage: 'https://www.coffeeman.co.il' };

function persistedRow({ url, sku, name, packCount, totalGrams, price }) {
  return {
    key: `coffeeman:${sku}:ground:${totalGrams}g:x${packCount}`,
    vendor,
    itemUrl: url,
    product: {
      productId: 'lavazza-crema-e-gusto-vacuum-ground',
      name,
      sku,
      variantId: 'classico',
      variantLabel: 'Classico',
      form: 'ground',
      packGrams: 250,
      packCount,
      totalGrams
    },
    price: { amount: price, currency: 'ILS' },
    availability: 'in_stock',
    shipping: {
      mode: 'delivery',
      service: 'home_delivery',
      certainty: 'unknown',
      amount: null,
      destination: { scope: 'country', country: 'IL' },
      note: 'No published courier rate found; delivery cost is unknown before checkout.'
    },
    observedAt: '2026-10-12T20:09:00.000Z'
  };
}

const single = () => persistedRow({ url: SINGLE_URL, sku: '930333', name: '250 גרם קפה טחון lavazza Crema e Gusto Classico', packCount: 1, totalGrams: 250, price: 33 });
const fourPack = () => persistedRow({ url: FOUR_PACK_URL, sku: '930334', name: '4 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico', packCount: 4, totalGrams: 1000, price: 124 });
const eightPack = () => persistedRow({ url: EIGHT_PACK_URL, sku: '930335', name: '8 אריזות 250 גרם קפה טחון lavazza Crema e Gusto Classico', packCount: 8, totalGrams: 2000, price: 240 });

function quoteOne(row, grams) {
  const board = quoteBoard({
    observations: [row],
    productId: 'lavazza-crema-e-gusto-vacuum-ground',
    targetGrams: grams,
    destination: findDestination('tel-aviv'),
    now: NOW
  });
  const quote = board.best ?? board.unrankable[0] ?? null;
  return {
    units: quote?.units ?? null,
    orderedGrams: quote?.orderedGrams ?? null,
    itemSubtotalBeforeDiscountIls: quote?.itemSubtotalBeforeDiscountIls ?? null,
    itemTotalIls: quote?.itemTotalIls ?? null,
    shippingAmountIls: quote?.shipping?.amountIls ?? null,
    freeThreshold: quote?.shipping?.freeThreshold ?? null,
    freeCondition: quote?.shipping?.freeCondition?.id ?? null,
    freeConditionUnmatchedAboveMin: quote?.shipping?.freeConditionUnmatchedAboveMin ?? null,
    totalIls: quote?.totalIls ?? null,
    rankable: Boolean(quote?.rankable)
  };
}

const matrix = [
  { listing: 'single 250 g', cart: '2 × 250 g = 500 g', observedCourierIls: 25, quote: quoteOne(single(), 500) },
  { listing: 'single 250 g', cart: '4 × 250 g = 1 kg', observedCourierIls: 25, quote: quoteOne(single(), 1000) },
  { listing: 'single 250 g', cart: '6 × 250 g = 1.5 kg', observedCourierIls: 25, quote: quoteOne(single(), 1500) },
  { listing: 'single 250 g', cart: '7 × 250 g = 1.75 kg', observedCourierIls: 0, quote: quoteOne(single(), 1750) },
  { listing: 'single 250 g', cart: '8 × 250 g = 2 kg (10% promotion)', observedCourierIls: 0, quote: quoteOne(single(), 2000) },
  { listing: '4 × 250 g multipack', cart: '1 × 4-pack = 1 kg', observedCourierIls: 25, quote: quoteOne(fourPack(), 1000) },
  { listing: '4 × 250 g multipack', cart: '2 × 4-pack = 2 kg', observedCourierIls: 0, quote: quoteOne(fourPack(), 2000) },
  { listing: '8 × 250 g multipack', cart: '1 × 8-pack = 2 kg', observedCourierIls: 20, quote: quoteOne(eightPack(), 2000) },
  // Never observed: these must keep the published base rate.
  { listing: 'single 250 g', cart: '12 × 250 g = 3 kg (unobserved)', observedCourierIls: null, quote: quoteOne(single(), 3000) },
  { listing: '4 × 250 g multipack', cart: '3 × 4-pack = 3 kg (unobserved)', observedCourierIls: null, quote: quoteOne(fourPack(), 3000) },
  { listing: 'single 250 g', cart: '8 × 250 g at ₪34 (repriced, unobserved)', observedCourierIls: null, quote: quoteOne({ ...single(), price: { amount: 34, currency: 'ILS' } }, 2000) }
];

const reproduced = matrix.every(entry => entry.observedCourierIls == null
  ? entry.quote.shippingAmountIls === 25 && entry.quote.freeCondition == null
  : entry.quote.shippingAmountIls === entry.observedCourierIls);

const record = {
  kind: 'policy-reproduction',
  topic: "CoffeeMan's anonymous-cart free-delivery observations applied at their exact cart scope (no monotone threshold)",
  revision: '2026-10-13: the earlier threshold-based reproduction was superseded after review; the policy now stores the exact observed free carts (7 singles, 8 singles, 2 × 4-pack) and every other cart keeps the published ₪25 base rate.',
  capturedAt: new Date(NOW).toISOString(),
  policy: 'coffeeman-single-4pack-il-home-delivery v3',
  evidenceSource: 'docs/evidence/browser-research/2026-10-12-coffeeman-cart-single-4pack.json',
  method: 'Persisted-shaped CoffeeMan rows (unknown shipping, as earlier parser versions stored them) were quoted through the production quote engine at each cart size; the engine enriches them from the validated policy at read time. No order, login, account, street address or bot-challenge bypass was involved in the research.',
  matrix: matrix.map(entry => ({
    listing: entry.listing,
    cart: entry.cart,
    observedCourierIls: entry.observedCourierIls,
    engine: entry.quote
  })),
  reproduced,
  note: 'Free delivery is applied only when the current cart matches an observed free configuration exactly (listing scope, whole-pack count, ordered grams, item subtotal before any discount). The 3 kg singles, three-4-pack and repriced 8-singles carts were never observed and keep the published ₪25 rate even though their subtotals are above an observed free subtotal. The ₪240 8-pack SKU keeps its own ₪20 policy and never inherits the free conditions.'
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(record, null, 1)}\n`);
console.log(JSON.stringify({ outPath, reproduced, matrix: record.matrix.map(entry => `${entry.cart} -> ${entry.engine.shippingAmountIls} (${entry.engine.freeCondition ?? 'base'})`) }, null, 2));
