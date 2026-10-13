import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteBoard, quoteOffer, findDestination, shippingCertaintyLabel } from '../src/lib/quote.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const FRESH = '2026-10-12T09:00:00.000Z';
const STALE = '2026-10-10T09:00:00.000Z';

function observation(overrides = {}) {
  const key = overrides.key ?? 'vendor:sku';
  const base = {
    key,
    vendor: { id: 'vendor', name: 'Vendor', homepage: 'https://vendor.test' },
    // The board collapses rows that share a vendor and listing URL into one
    // offer, so each synthetic offer gets its own URL unless a test overrides it.
    itemUrl: `https://vendor.test/p/${encodeURIComponent(key)}`,
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

test('shipping certainty is exposed as a written label, never as a bare flag', () => {
  assert.equal(shippingCertaintyLabel('verified'), 'Published rate (verified)');
  assert.equal(shippingCertaintyLabel('checkout_quote'), 'Checkout rate (observed, conditional)');
  assert.equal(shippingCertaintyLabel('estimated'), 'Estimated rate');
  assert.equal(shippingCertaintyLabel('unknown'), 'Not published before checkout');
  assert.equal(shippingCertaintyLabel(undefined), 'Not published before checkout');

  const verified = observation({ key: 'label-verified:1', shipping: { certainty: 'verified', amount: { amount: 25, currency: 'ILS' } } });
  const unknown = observation({ key: 'label-unknown:1', shipping: { certainty: 'unknown', amount: null, note: 'Calculated at checkout' } });
  const board = quote([verified, unknown]);
  assert.equal(board.best.shipping.certaintyLabel, 'Published rate (verified)');
  const blocked = [...board.unrankable, ...board.staleOrUnavailable].find(item => item.key === 'label-unknown:1');
  assert.equal(blocked.shipping.certaintyLabel, 'Not published before checkout');
  assert.equal(blocked.totalIls, null, 'an unknown rate still cannot rank');
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

test('pack sizes stay separate offers while stated blend wording stays identity metadata', () => {
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

test('one listing that changes its blend wording is never shown as two offers', () => {
  // A store can hold an old classico-keyed row next to the stable key its
  // re-observation now uses. They describe one listing URL, so the board keeps
  // the newest observation and never lists the same offer twice.
  const legacy = observation({
    key: 'demo:sku-1:classico:ground:250g:x1',
    vendor: { id: 'demo', name: 'Demo vendor' },
    itemUrl: 'https://demo.test/p/crema',
    product: { variantId: 'classico', variantLabel: 'Classico' },
    price: { amount: 40, currency: 'ILS' },
    observedAt: '2026-10-12T06:00:00.000Z'
  });
  const stable = observation({
    key: 'demo:sku-1:ground:250g:x1',
    vendor: { id: 'demo', name: 'Demo vendor' },
    itemUrl: 'https://demo.test/p/crema',
    product: { variantId: 'unspecified', variantLabel: 'Variant not stated' },
    price: { amount: 42, currency: 'ILS' },
    observedAt: '2026-10-12T10:00:00.000Z'
  });
  const board = quote([legacy, stable]);
  assert.equal(board.counts.observed, 1, 'the two rows are one offer');
  assert.equal(board.ranked.length, 1);
  assert.equal(board.best.key, 'demo:sku-1:ground:250g:x1', 'the newest observation wins');
  assert.equal(board.best.itemPrice.amount, 42, 'the old price is not resurrected as a second offer');
  // A stored row with an unparseable observation time must never outrank a real one.
  const broken = observation({
    key: 'demo:sku-1:broken',
    vendor: { id: 'demo', name: 'Demo vendor' },
    itemUrl: 'https://demo.test/p/crema',
    price: { amount: 1, currency: 'ILS' },
    observedAt: 'not-a-date'
  });
  const brokenBoard = quote([broken, legacy, stable]);
  assert.equal(brokenBoard.counts.observed, 1);
  assert.equal(brokenBoard.best.key, 'demo:sku-1:ground:250g:x1');
  assert.equal(brokenBoard.best.itemPrice.amount, 42);
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

test('a recorded "above" threshold wording excludes the boundary itself', () => {
  const above = observation({
    key: 'above:1',
    price: { amount: 50 },
    shipping: { certainty: 'verified', amount: { amount: 20, currency: 'ILS' }, freeThreshold: { amount: 100, currency: 'ILS' }, freeThresholdSemantics: 'above' }
  });
  const exact = quoteOffer(above, { grams: 500, destination: findDestination('tel-aviv'), now: NOW, staleAfterMs: 1e12 });
  assert.equal(exact.itemTotalIls, 100);
  assert.equal(exact.shipping.freeThresholdSemantics, 'above');
  assert.equal(exact.shipping.amountIls, 20, 'exactly ₪100 is not "above ₪100"');
  assert.equal(exact.totalIls, 120);

  const over = quoteOffer(above, { grams: 750, destination: findDestination('tel-aviv'), now: NOW, staleAfterMs: 1e12 });
  assert.equal(over.itemTotalIls, 150);
  assert.equal(over.shipping.amountIls, 0);
  assert.match(over.labels.join(' '), /Free shipping threshold met \(above ₪100\.00\)/);
});

test('a checkout rate observed on a smaller cart never stretches to a larger one', () => {
  const quoted = observation({
    key: 'quoted:8pack',
    price: { amount: 240 },
    product: { sku: 'q8', packCount: 8, totalGrams: 2000 },
    shipping: { certainty: 'checkout_quote', amount: { amount: 20, currency: 'ILS' }, maxTotalGrams: 2000 }
  });
  const small = quote([quoted], { targetGrams: 1000 });
  assert.equal(small.best.totalIls, 260, 'one 2 kg multipack covers the 1 kg target');
  assert.equal(small.best.shipping.certaintyLabel, 'Checkout rate (observed, conditional)', 'a cart quote is never presented as a published rate');
  const big = quote([quoted], { targetGrams: 3000 });
  assert.equal(big.ranked.length, 0, 'two multipacks exceed the quoted 2 kg cart');
  assert.match(big.unrankable[0].reasons.join(' '), /quoted only for carts up to 2000 g/);
  assert.equal(big.unrankable[0].shipping.amountIls, null, 'the rate is never stretched or zeroed');
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

test('a published rate with an unpublished locality list ranks with a disclosed coverage caveat', () => {
  const caveat = 'Home delivery is limited to the localities on the vendor home-delivery list, which the product page does not publish.';
  const withCaveat = observation({
    key: 'caveat:1',
    shipping: {
      certainty: 'verified',
      amount: { amount: 25, currency: 'ILS' },
      destination: { scope: 'country', country: 'IL', caveat, caveatSource: 'https://vendor.test/terms' }
    }
  });
  const board = quote([withCaveat]);
  assert.equal(board.ranked.length, 1, 'a disclosed caveat does not block ranking');
  assert.equal(board.best.totalIls, 105); // 2 × ₪40 + ₪25
  assert.equal(board.best.shipping.coverageCaveat, caveat);
  assert.match(board.best.labels.join(' '), /Delivery coverage caveat/);
  assert.equal(board.best.shipping.destination.caveatSource, 'https://vendor.test/terms', 'the caveat keeps its source link');

  const plain = quote([observation({ key: 'plain:1' })]);
  assert.equal(plain.best.shipping.coverageCaveat, undefined);
  assert.doesNotMatch(plain.best.labels.join(' '), /coverage caveat/i);
});

test('a locality list that excludes the destination still blocks ranking even with a caveat', () => {
  const blocked = observation({
    key: 'blocked:1',
    shipping: {
      certainty: 'verified',
      amount: { amount: 10, currency: 'ILS' },
      destination: { scope: 'localities', localities: ['haifa'], caveat: 'List published in the terms.' }
    }
  });
  const board = quote([blocked]);
  assert.equal(board.ranked.length, 0);
  assert.match(board.unrankable[0].reasons.join(' '), /does not include Tel Aviv/);
});

test('the delivery coverage caveat stays off pickup rows', () => {
  const withPickup = observation({
    key: 'both-caveat:1',
    shipping: {
      certainty: 'verified',
      amount: { amount: 25, currency: 'ILS' },
      destination: { scope: 'country', country: 'IL', caveat: 'Locality list unpublished.' },
      pickup: { available: true, amount: { amount: 0, currency: 'ILS' } }
    }
  });
  const board = quote([withPickup]);
  assert.equal(board.pickup.length, 1);
  assert.doesNotMatch(board.pickup[0].labels.join(' '), /coverage caveat/i, 'self-pickup does not depend on the delivery locality list');
  assert.match(board.ranked[0].labels.join(' '), /coverage caveat/i);
});

test('a matched courier free condition stays off the pickup row terms', () => {
  const both = observation({
    key: 'both-free:1',
    shipping: {
      service: 'home_delivery',
      certainty: 'verified',
      amount: { amount: 20, currency: 'ILS' },
      // The exact 2-pack cart the vendor showed free (target 500 g = 2 units).
      freeCartConditions: [{
        id: 'singles-2',
        service: 'home_delivery',
        sku: 'sku-1',
        packCount: 1,
        units: 2,
        orderedGrams: 500,
        itemSubtotalIls: 80,
        discountPercent: null,
        paidItemTotalIls: 80,
        methodLabel: 'home courier',
        observedAt: FRESH
      }],
      pickup: { available: true, amount: { amount: 0, currency: 'ILS' }, note: 'Free self-pickup, listed on the product page.' }
    }
  });
  const board = quote([both]);
  assert.equal(board.best.shipping.freeCondition?.id, 'singles-2', 'the recorded cart matches and is free');
  assert.equal(board.best.totalIls, 80);
  assert.match(board.best.labels.join(' '), /Free home courier observed for this exact cart/);
  assert.equal(board.pickup.length, 1);
  assert.match(board.pickup[0].labels.join(' '), /Pickup only/);
  assert.doesNotMatch(board.pickup[0].labels.join(' '), /Free home courier observed/, 'courier conditions stay on the delivered card');
  assert.doesNotMatch(board.pickup[0].labels.join(' '), /coverage caveat/i);
});

test('a stale pickup observation is labelled stale and never ranked', () => {
  const stalePickup = observation({
    key: 'pickup-stale:1',
    observedAt: STALE,
    shipping: { mode: 'pickup', certainty: 'unknown', amount: null, pickup: { available: true, amount: { amount: 0, currency: 'ILS' } } }
  });
  const board = quote([stalePickup]);
  assert.equal(board.ranked.length, 0);
  assert.equal(board.pickup.length, 1);
  assert.match(board.pickup[0].labels.join(' '), /Stale observation/);
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

test('one comparison includes every stated and unstated blend wording, with no exclusion count', () => {
  const classico = observation({ key: 'classico:1' });
  const forte = observation({ key: 'forte:1', product: { variantId: 'forte', variantLabel: 'Forte' } });
  const unstated = observation({ key: 'unstated:1', product: { variantId: 'unspecified', variantLabel: 'Variant not stated' } });
  const board = quote([classico, forte, unstated]);
  assert.deepEqual(board.ranked.map(q => q.key).sort(), ['classico:1', 'forte:1', 'unstated:1'], 'every eligible listing is compared together');
  assert.equal(board.counts.excludedByVariant, undefined, 'no variant filter or exclusion count exists');
  assert.equal(board.variantId, undefined, 'the board carries no variant selection');
  assert.equal(board.counts.observed, 3);
  // Raw blend wording stays attached to each offer as provenance, never as a filter.
  assert.equal(board.ranked.find(q => q.key === 'forte:1').product.variantLabel, 'Forte');
  assert.equal(board.ranked.find(q => q.key === 'unstated:1').product.variantLabel, 'Variant not stated');
});

test('the quote engine compares one product id at a time and never mixes another product into it', () => {
  // The catalog tracks one product line; this synthetic id proves the engine's
  // product filter is strict, without implying a second tracked product.
  const otherProduct = {
    productId: 'demo-other-product',
    name: 'Demo other product 250 g ground',
    variantId: 'unspecified',
    variantLabel: 'Variant not stated',
    form: 'ground',
    packGrams: 250,
    packCount: 1,
    totalGrams: 250,
    sku: 'other-1'
  };
  const cremaOffer = observation({ key: 'crema:1', price: { amount: 33 } });
  const otherOffer = observation({
    key: 'other:1',
    vendor: { id: 'other-vendor', name: 'Demo other vendor' },
    product: otherProduct,
    price: { amount: 20 },
    shipping: { certainty: 'verified', amount: { amount: 1, currency: 'ILS' } }
  });
  const cremaBoard = quote([cremaOffer, otherOffer]);
  assert.equal(cremaBoard.counts.observed, 1, 'the other product id is not part of this comparison');
  assert.equal(cremaBoard.best.key, 'crema:1');
  assert.ok(!cremaBoard.ranked.some(item => item.key === 'other:1'));

  const otherBoard = quote([cremaOffer, otherOffer], { productId: otherProduct.productId });
  assert.equal(otherBoard.counts.observed, 1);
  assert.equal(otherBoard.best.key, 'other:1');
  assert.equal(otherBoard.best.totalIls, 41, '₪20 × 2 packs + ₪1 shipping');
});

test('the engine changes winner with quantity: a multipack beats singles once shipping is counted', () => {
  const otherProduct = {
    productId: 'demo-other-product',
    name: 'Demo other product 250 g ground',
    variantId: 'unspecified',
    variantLabel: 'Variant not stated',
    form: 'ground',
    packGrams: 250,
    packCount: 1,
    totalGrams: 250,
    sku: 'other-1'
  };
  const single = observation({
    key: 'other-single',
    vendor: { id: 'coffeeman', name: 'CoffeeMan' },
    product: otherProduct,
    price: { amount: 37 },
    shipping: { certainty: 'verified', amount: { amount: 25, currency: 'ILS' } }
  });
  const fourPack = observation({
    key: 'other-4pack',
    vendor: { id: 'coffeeman', name: 'CoffeeMan' },
    product: { ...otherProduct, sku: 'other-4', packCount: 4, totalGrams: 1000 },
    price: { amount: 125 },
    shipping: { certainty: 'verified', amount: { amount: 25, currency: 'ILS' } }
  });
  const unknownShipping = observation({
    key: 'other-pucks',
    vendor: { id: 'pucks', name: 'Pucks' },
    product: { ...otherProduct, sku: 'other-2' },
    price: { amount: 35 },
    shipping: { certainty: 'unknown', amount: null, note: 'Calculated at checkout' }
  });
  const board500 = quote([single, fourPack, unknownShipping], { productId: otherProduct.productId, targetGrams: 500 });
  assert.equal(board500.best.key, 'other-single');
  assert.equal(board500.best.totalIls, 99, '2 × ₪37 + ₪25');
  assert.equal(board500.best.ilsPerKg, 198);
  assert.ok(board500.unknown.some(item => item.key === 'other-pucks'), 'cheaper item with unknown shipping cannot win');

  const board1000 = quote([single, fourPack, unknownShipping], { productId: otherProduct.productId, targetGrams: 1000 });
  assert.equal(board1000.best.key, 'other-4pack');
  assert.equal(board1000.best.totalIls, 150, '₪125 + ₪25');
  assert.equal(board1000.ranked.find(item => item.key === 'other-single').totalIls, 173, '4 × ₪37 + ₪25');
});

test('a price change since the previous check is reported in ILS and keeps the delivered math unchanged', () => {
  const dropped = observation({
    key: 'dropped:1',
    price: { amount: 36 },
    previous: {
      observedAt: '2026-10-12T06:00:00.000Z',
      price: { amount: 40, currency: 'ILS' },
      availability: 'in_stock',
      totalGrams: 250
    }
  });
  const board = quote([dropped]);
  assert.equal(board.best.totalIls, 92, '2 × ₪36 + ₪20 shipping');
  assert.equal(board.best.priceChange.comparable, true);
  assert.equal(board.best.priceChange.direction, 'down');
  assert.equal(board.best.priceChange.deltaIls, 4);
  assert.equal(board.best.priceChange.previousObservedAt, '2026-10-12T06:00:00.000Z');
  assert.equal(board.best.previous.priceAmount, 40);
  assert.equal(board.best.previous.priceCurrency, 'ILS');
  assert.equal(board.best.previous.availabilityLabel, 'In stock (observed)');
});

test('an unchanged or higher price is reported without inventing a discount', () => {
  const previous = {
    observedAt: '2026-10-12T06:00:00.000Z',
    price: { amount: 40, currency: 'ILS' },
    availability: 'in_stock',
    totalGrams: 250
  };
  const same = quote([observation({ key: 'same:1', previous })]);
  assert.equal(same.best.priceChange.comparable, true);
  assert.equal(same.best.priceChange.direction, 'same');
  assert.equal(same.best.priceChange.deltaIls, 0);

  const higher = quote([observation({ key: 'higher:1', price: { amount: 44 }, previous })]);
  assert.equal(higher.best.priceChange.direction, 'up');
  assert.equal(higher.best.priceChange.deltaIls, 4);
  assert.equal(higher.best.priceChange.previousIls, 40);
});

test('a previous price in another currency needs a stored rate and is never treated as no change', () => {
  const previous = {
    observedAt: '2026-10-12T06:00:00.000Z',
    price: { amount: 9, currency: 'USD' },
    availability: 'in_stock',
    totalGrams: 250
  };
  const withoutFx = quote([observation({ key: 'usd:1', price: { amount: 10, currency: 'USD' }, previous })]);
  const blocked = withoutFx.unrankable.find(item => item.key === 'usd:1');
  assert.equal(blocked.priceChange.comparable, false);
  assert.match(blocked.priceChange.reason, /exchange rate/);

  const fx = { asOf: '2026-10-09', base: 'ILS', rates: { USD: { rate: 3, unit: 1 } }, source: { name: 'test' } };
  const withFx = quote([observation({ key: 'usd:1', price: { amount: 10, currency: 'USD' }, previous })], { fx });
  assert.equal(withFx.best.priceChange.comparable, true);
  assert.equal(withFx.best.priceChange.direction, 'up');
  assert.equal(withFx.best.priceChange.deltaIls, 3, 'US$1 × 3.00 reference rate');
  assert.equal(withFx.best.totalIls, 80, '2 × US$10 × 3 + ₪20 shipping');
});

test('a pack-size change blocks the price comparison instead of showing a false delta', () => {
  const board = quote([observation({
    key: 'resized:1',
    previous: {
      observedAt: '2026-10-12T06:00:00.000Z',
      price: { amount: 40, currency: 'ILS' },
      availability: 'in_stock',
      totalGrams: 500
    }
  })]);
  assert.equal(board.best.priceChange.comparable, false);
  assert.match(board.best.priceChange.reason, /pack size changed/);
  assert.equal(board.best.priceChange.previousAmount, 40);
});

test('previous availability is exposed for stock-change labels', () => {
  const board = quote([observation({
    key: 'restocked:1',
    previous: {
      observedAt: '2026-10-12T06:00:00.000Z',
      price: { amount: 40, currency: 'ILS' },
      availability: 'out_of_stock',
      totalGrams: 250
    }
  })]);
  assert.equal(board.best.previous.availability, 'out_of_stock');
  assert.equal(board.best.previous.availabilityLabel, 'Out of stock (observed)');
  assert.equal(board.best.priceChange.comparable, true, 'the price is still comparable across a stock change');
});

test('the cheapest per-kilogram offer is reported separately from the cheapest delivered total', () => {
  const single = observation({
    key: 'single:1',
    price: { amount: 33 },
    shipping: { certainty: 'verified', amount: { amount: 25, currency: 'ILS' } }
  });
  const fourPack = observation({
    key: 'four:1',
    product: { packGrams: 250, packCount: 4, totalGrams: 1000 },
    price: { amount: 124 },
    shipping: { certainty: 'verified', amount: { amount: 25, currency: 'ILS' } }
  });
  const board = quote([single, fourPack], { targetGrams: 500 });
  assert.equal(board.best.key, 'single:1');
  assert.equal(board.best.totalIls, 91, '2 × ₪33 + ₪25 is the cheapest delivered total at 500 g');
  assert.equal(board.bestPerKg.key, 'four:1');
  assert.equal(board.bestPerKg.ilsPerKg, 149);
  assert.equal(board.bestPerKg.totalIls, 149);
  assert.equal(board.bestPerKg.units, 1);
  assert.equal(board.bestPerKg.orderedGrams, 1000);
});

test('the per-kilogram winner is the delivered best when no bulk offer beats it', () => {
  const only = observation({ key: 'only:1' });
  const board = quote([only]);
  assert.equal(board.bestPerKg.key, board.best.key);
  assert.equal(board.bestPerKg.ilsPerKg, board.best.ilsPerKg);
});

test('the quote names the delivery method separately from the certainty label', () => {
  const courier = observation({ key: 'courier:1', shipping: { service: 'home_delivery', certainty: 'verified', amount: { amount: 20, currency: 'ILS' } } });
  const pickupPoint = observation({
    key: 'pickup-point:1',
    vendor: { id: 'pp', name: 'Pickup point vendor' },
    shipping: { service: 'pickup_point', certainty: 'checkout_quote', amount: { amount: 15, currency: 'ILS' } }
  });
  const board = quote([courier, pickupPoint]);
  const courierQuote = board.ranked.find(item => item.key === 'courier:1');
  const pickupQuote = board.ranked.find(item => item.key === 'pickup-point:1');
  assert.equal(courierQuote.shipping.serviceLabel, 'Home delivery');
  assert.equal(courierQuote.shipping.certaintyLabel, 'Published rate (verified)');
  assert.equal(pickupQuote.shipping.serviceLabel, 'Pickup-point delivery');
  assert.equal(pickupQuote.shipping.certaintyLabel, 'Checkout rate (observed, conditional)');
});

test('an unstated delivery method says so instead of borrowing the certainty label', () => {
  const board = quote([observation({ key: 'unstated-method:1' })]);
  assert.equal(board.best.shipping.service, null);
  assert.equal(board.best.shipping.serviceLabel, 'Delivery method not stated');
  const pickupOnly = quoteBoard({
    observations: [observation({ key: 'pickup-only:1', shipping: { mode: 'pickup', certainty: 'verified', amount: null } })],
    productId: 'lavazza-crema-e-gusto-vacuum-ground',
    targetGrams: 250,
    destination: findDestination('tel-aviv'),
    now: NOW
  });
  assert.equal(pickupOnly.pickup[0].shipping.serviceLabel, 'Self-pickup');
});
