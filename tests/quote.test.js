import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteBoard, quoteOffer, findDestination } from '../src/lib/quote.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const FRESH = '2026-10-12T09:00:00.000Z';
const STALE = '2026-10-10T09:00:00.000Z';

function observation(overrides = {}) {
  const base = {
    key: 'vendor:sku',
    vendor: { id: 'vendor', name: 'Vendor', homepage: 'https://vendor.test' },
    itemUrl: 'https://vendor.test/p/1',
    product: {
      productId: 'lavazza-crema-e-gusto-vacuum-ground',
      name: 'Lavazza Crema e Gusto Classico 250 g ground',
      variantId: 'classico',
      variantLabel: 'Classico',
      form: 'ground',
      packGrams: 250,
      packCount: 1,
      totalGrams: 250,
      sku: 'sku-1'
    },
    price: { amount: 40, currency: 'ILS' },
    availability: 'in_stock',
    shipping: {
      mode: 'delivery',
      certainty: 'verified',
      amount: { amount: 20, currency: 'ILS' },
      destination: { scope: 'country', country: 'IL' }
    },
    observedAt: FRESH
  };
  return {
    ...base,
    ...overrides,
    product: { ...base.product, ...(overrides.product ?? {}) },
    shipping: { ...base.shipping, ...(overrides.shipping ?? {}) },
    price: { ...base.price, ...(overrides.price ?? {}) }
  };
}

const quote = (observations, options = {}) => quoteBoard({
  observations,
  productId: 'lavazza-crema-e-gusto-vacuum-ground',
  targetGrams: 500,
  destination: findDestination('tel-aviv'),
  now: NOW,
  ...options
});

test('shipping can change the winner: cheap item with expensive delivery loses', () => {
  const cheapItemPriceyShipping = observation({
    key: 'expensive-shipping:1',
    vendor: { id: 'a', name: 'Cheap item, pricey delivery' },
    price: { amount: 30, currency: 'ILS' },
    shipping: { certainty: 'verified', amount: { amount: 40, currency: 'ILS' } }
  });
  const pricierItemCheapShipping = observation({
    key: 'cheap-shipping:1',
    vendor: { id: 'b', name: 'Higher item, cheap delivery' },
    price: { amount: 45, currency: 'ILS' },
    shipping: { certainty: 'verified', amount: { amount: 5, currency: 'ILS' } }
  });
  const board = quote([cheapItemPriceyShipping, pricierItemCheapShipping]);
  assert.equal(board.best.vendor.id, 'b');
  assert.equal(board.best.totalIls, 95); // 2 packs × 45 + 5 shipping
});

test('unknown shipping cannot win and is never treated as zero', () => {
  const known = observation({ key: 'known:1', price: { amount: 50 }, shipping: { certainty: 'verified', amount: { amount: 10, currency: 'ILS' } } });
  const unknown = observation({
    key: 'unknown:1',
    vendor: { id: 'u', name: 'Unknown shipping' },
    price: { amount: 10 },
    shipping: { certainty: 'unknown', amount: null, note: 'Calculated at checkout' }
  });
  const board = quote([known, unknown]);
  assert.equal(board.best.key, 'known:1');
  assert.equal(board.ranked.length, 1);
  const blocked = [...board.unrankable, ...board.staleOrUnavailable].find(item => item.key === 'unknown:1');
  assert.equal(blocked.totalIls, null);
  assert.match(blocked.reasons.join(' '), /unknown, not free/);
});

test('stale and out-of-stock observations stay visible but unranked', () => {
  const fresh = observation({ key: 'fresh:1' });
  const stale = observation({ key: 'stale:1', observedAt: STALE });
  const outOfStock = observation({ key: 'oos:1', availability: 'out_of_stock' });
  const board = quote([fresh, stale, outOfStock]);
  assert.deepEqual(board.ranked.map(q => q.key), ['fresh:1']);
  assert.equal(board.staleOrUnavailable.length, 2);
  const staleQuote = board.staleOrUnavailable.find(q => q.key === 'stale:1');
  assert.equal(staleQuote.rankable, false);
  assert.match(staleQuote.labels.join(' '), /Stale/);
  const oosQuote = board.staleOrUnavailable.find(q => q.key === 'oos:1');
  assert.match(oosQuote.labels.join(' '), /Out of stock/);
});

test('availability unknown is not shown as confirmed available', () => {
  const board = quote([observation({ key: 'maybe:1', availability: 'unknown' })]);
  assert.equal(board.ranked.length, 0);
  const entry = board.staleOrUnavailable[0];
  assert.match(entry.reasons.join(' '), /cannot be confirmed as available/);
});

test('variants and multipacks are not merged: variant stays in identity and per-kg normalizes', () => {
  const single = observation({ key: 'single:1', price: { amount: 30 }, shipping: { amount: { amount: 0, currency: 'ILS' } } });
  const multipack = observation({
    key: 'multi:1',
    product: { packGrams: 250, packCount: 4, totalGrams: 1000 },
    price: { amount: 100 },
    shipping: { amount: { amount: 15, currency: 'ILS' } }
  });
  const forte = observation({
    key: 'forte:1',
    product: { variantId: 'forte', variantLabel: 'Forte' },
    price: { amount: 20 },
    shipping: { amount: { amount: 0, currency: 'ILS' } }
  });
  const board = quote([single, multipack, forte]);
  assert.equal(board.ranked.length, 3);
  // 500 g target: single needs 2 packs (₪60), multipack needs 1 unit (₪115), forte needs 2 packs (₪40).
  const byKey = Object.fromEntries(board.ranked.map(q => [q.key, q]));
  assert.equal(byKey['single:1'].units, 2);
  assert.equal(byKey['single:1'].orderedGrams, 500);
  assert.equal(byKey['single:1'].ilsPerKg, 120);
  assert.equal(byKey['multi:1'].units, 1);
  assert.equal(byKey['multi:1'].ilsPerKg, 115);
  assert.equal(byKey['multi:1'].product.variantLabel, 'Classico');
  assert.equal(byKey['forte:1'].product.variantLabel, 'Forte');
  assert.equal(byKey['forte:1'].ilsPerKg, 80);
});

test('quantity changes units and totals without losing pack rounding', () => {
  const offer = observation({ price: { amount: 30 }, shipping: { amount: { amount: 10, currency: 'ILS' } } });
  const at100 = quoteOffer(offer, { grams: 100, destination: findDestination('tel-aviv'), fx: null, now: NOW, staleAfterMs: 24 * 3600 * 1000 });
  assert.equal(at100.units, 1);
  assert.equal(at100.totalIls, 40);
  const at600 = quoteOffer(offer, { grams: 600, destination: findDestination('tel-aviv'), fx: null, now: NOW, staleAfterMs: 24 * 3600 * 1000 });
  assert.equal(at600.units, 3);
  assert.equal(at600.orderedGrams, 750);
  assert.equal(at600.totalIls, 100);
});

test('free-shipping threshold and minimum order are calculated, not guessed', () => {
  const threshold = observation({
    key: 'threshold:1',
    price: { amount: 30 },
    shipping: { certainty: 'verified', amount: { amount: 20, currency: 'ILS' }, freeThreshold: { amount: 60, currency: 'ILS' } }
  });
  const below = quoteOffer(threshold, { grams: 250, destination: findDestination('tel-aviv'), now: NOW, staleAfterMs: 1e12 });
  assert.equal(below.totalIls, 50);
  const above = quoteOffer(threshold, { grams: 500, destination: findDestination('tel-aviv'), now: NOW, staleAfterMs: 1e12 });
  assert.equal(above.totalIls, 60);
  assert.match(above.labels.join(' '), /Free shipping threshold met/);

  const minimum = observation({
    key: 'min:1',
    price: { amount: 15 },
    shipping: { certainty: 'verified', amount: { amount: 0, currency: 'ILS' }, minOrder: { amount: 50, currency: 'ILS' } }
  });
  const board = quote([minimum]);
  assert.equal(board.ranked.length, 0);
  assert.match(board.unrankable[0].reasons.join(' '), /minimum order/);
});

test('missing FX never becomes zero and cannot be ranked', () => {
  const usd = observation({
    key: 'usd:1',
    price: { amount: 20, currency: 'USD' },
    shipping: { certainty: 'verified', amount: { amount: 5, currency: 'USD' } }
  });
  const withoutFx = quote([usd]);
  assert.equal(withoutFx.ranked.length, 0);
  assert.match(withoutFx.unrankable[0].reasons.join(' '), /no USD reference rate is stored/i);
  const withFx = quote([usd], { fx: { asOf: '2026-10-09', base: 'ILS', rates: { USD: { rate: 3, unit: 1 } }, source: { name: 'test' } } });
  assert.equal(withFx.best.totalIls, 135); // 2 packs × $20 + $5 shipping = $45 × 3
  assert.equal(withFx.best.estimate, true);
});

test('destination restrictions are enforced for coverage lists', () => {
  const localOnly = observation({
    key: 'local:1',
    shipping: { destination: { scope: 'localities', localities: ['haifa'] } }
  });
  const telAviv = quote([localOnly]);
  assert.equal(telAviv.ranked.length, 0);
  assert.match(telAviv.unrankable[0].reasons.join(' '), /does not include Tel Aviv/);
  const haifa = quote([localOnly], { destination: findDestination('haifa') });
  assert.equal(haifa.ranked.length, 1);
});

test('pickup offers are kept separate from delivered ranking', () => {
  const pickupOnly = observation({
    key: 'pickup:1',
    shipping: { mode: 'pickup', certainty: 'unknown', amount: null, pickup: { available: true, amount: { amount: 0, currency: 'ILS' } } }
  });
  const board = quote([pickupOnly]);
  assert.equal(board.ranked.length, 0);
  assert.equal(board.pickup.length, 1);
  assert.match(board.pickup[0].labels.join(' '), /Pickup only/);
  assert.equal(board.pickup[0].itemTotalIls, 80);
});

test('pickup availability is listed separately while delivery stays ranked', () => {
  const withPickup = observation({
    key: 'both:1',
    shipping: {
      certainty: 'verified',
      amount: { amount: 25, currency: 'ILS' },
      pickup: { available: true, amount: { amount: 0, currency: 'ILS' }, note: 'Free self-pickup, listed on the product page.' }
    }
  });
  const board = quote([withPickup]);
  assert.equal(board.ranked.length, 1);
  assert.equal(board.ranked[0].totalIls, 105); // 2 × 40 + 25
  assert.equal(board.pickup.length, 1);
  assert.equal(board.pickup[0].totalIls, null);
  assert.equal(board.pickup[0].itemTotalIls, 80);
  assert.match(board.pickup[0].labels.join(' '), /Pickup only/);
  assert.equal(board.counts.pickup, 1);
});

test('stale attempts beyond the threshold do not rank even with fresh prices', () => {
  const stale = observation({ key: 'old:1', observedAt: '2026-10-10T09:00:00.000Z' });
  const board = quote([stale]);
  assert.equal(board.ranked.length, 0);
  assert.equal(board.best, null);
  assert.equal(board.staleOrUnavailable[0].ageHours, 51);
});

test('shipping alternatives are converted but never replace the ranked shipping amount', () => {
  const withAlternative = observation({
    key: 'alt:1',
    shipping: {
      certainty: 'verified',
      amount: { amount: 30, currency: 'ILS' },
      alternatives: [{ id: 'pickup-point', label: 'Delivery to a pickup point', amount: { amount: 15, currency: 'ILS' }, note: 'different service' }]
    }
  });
  const board = quote([withAlternative]);
  assert.equal(board.best.shipping.amountIls, 30, 'the published door-to-door rate is the ranked shipping amount');
  assert.equal(board.best.totalIls, 110); // 2 × ₪40 + ₪30
  assert.equal(board.best.shipping.alternatives[0].amountIls, 15);
  assert.equal(board.best.shipping.alternatives[0].note, 'different service');

  const usdAlternative = observation({
    key: 'alt-usd:1',
    shipping: {
      certainty: 'verified',
      amount: { amount: 0, currency: 'ILS' },
      alternatives: [{ id: 'courier', label: 'Courier', amount: { amount: 5, currency: 'USD' } }]
    }
  });
  const withoutFx = quote([usdAlternative]);
  assert.equal(withoutFx.best.shipping.alternatives[0].amountIls, null, 'an unconvertible alternative is unknown, not zero');
});

test('the variant filter keeps variants separate and reports what it excluded', () => {
  const classico = observation({ key: 'classico:1' });
  const unstated = observation({ key: 'unstated:1', product: { variantId: 'unspecified', variantLabel: 'Variant not stated' } });
  const classicoOnly = quote([classico, unstated], { variantId: 'classico' });
  assert.deepEqual(classicoOnly.ranked.map(q => q.key), ['classico:1']);
  assert.equal(classicoOnly.counts.excludedByVariant, 1);
  assert.deepEqual(classicoOnly.counts.excludedVariants, ['unspecified']);
  assert.deepEqual(classicoOnly.variants, ['classico', 'unspecified'], 'the selector still knows both variants exist');

  const unstatedOnly = quote([classico, unstated], { variantId: 'unspecified' });
  assert.deepEqual(unstatedOnly.ranked.map(q => q.key), ['unstated:1']);
  assert.equal(unstatedOnly.counts.excludedByVariant, 1);
});
