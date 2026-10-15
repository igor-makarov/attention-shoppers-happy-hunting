import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyListing, productById, productQuantity } from '../src/catalog.js';
import { quoteBoard, DESTINATIONS } from '../src/lib/quote.js';

const productId = 'tnuva-cottage-cheese-5-percent';
const now = Date.parse('2026-10-15T12:00:00Z');

// Synthetic arithmetic fixtures; these are not observations of real vendors.
function offer(id, price, shipping, extra = {}) {
  return {
    key: id,
    vendor: { id, name: `QA ${id}` },
    itemUrl: `https://example.invalid/${id}`,
    product: { productId, form: 'cottage_cheese', packGrams: 250, packCount: 1, totalGrams: 250 },
    price: { amount: price, currency: 'ILS' },
    availability: 'in_stock',
    observedAt: new Date(now).toISOString(),
    shipping: { mode: 'delivery', service: 'home_delivery', certainty: 'verified',
      amount: { amount: shipping, currency: 'ILS' }, destination: { scope: 'country', country: 'IL' } },
    ...extra
  };
}
const board = (observations, extra = {}) => quoteBoard({ observations, productId, now,
  destination: DESTINATIONS[0], ...extra });

test('cottage cheese identity requires Tnuva, plain 5% and 250 g tubs', () => {
  for (const name of ["Tnuva cottage cheese 5% 250 g", "קוטג׳ תנובה 5% מהדרין 250 גרם", "קוטג תנובה 250 גרם %5"]) {
    const matched = classifyListing(name);
    assert.equal(matched.matched, true, name);
    assert.equal(matched.productId, productId);
    assert.equal(matched.form, 'cottage_cheese');
    assert.equal(matched.totalGrams, 250);
    assert.equal(classifyListing(name, { productId: 'lavazza-crema-e-gusto-vacuum-ground' }).matched, false);
  }
  for (const name of [
    'Strauss cottage cheese 5% 250 g', 'Tnuva cottage cheese 9% 250 g',
    'Tnuva cottage cheese 5% 100 g', 'Tnuva cottage cheese 5% 500 g',
    'Tnuva cottage cheese 5%', 'Tnuva cottage cheese 250 g',
    'Tnuva cottage cheese with olives 5% 250 g', 'קוטג תנובה עם שום שמיר 5% 250 גרם',
    'Tnuva cottage cheese 5% or 9% 250 g'
  ]) assert.equal(classifyListing(name, { productId }).matched, false, name);
});

test('batch quantities are exact, bounded and compatible with equivalent weight links', () => {
  const product = productById(productId);
  for (const quantity of [4, 6, 8, 10]) {
    assert.deepEqual(productQuantity(product, { quantity: String(quantity) }), { targetQuantity: quantity, targetGrams: quantity * 250 });
    assert.equal(productQuantity(product, { grams: quantity * 250 }).targetQuantity, quantity);
  }
  for (const quantity of [null, '', 'abc', -4, 5, 100, 6.5]) {
    assert.equal(productQuantity(product, { quantity }).targetQuantity, 4);
  }
});

test('each batch minimizes total including shipping, with different winners as quantity changes', () => {
  const result = board([offer('low-item-price', 5, 24), offer('low-shipping', 7, 10)], { targetQuantity: 6 });
  assert.equal(result.targetQuantity, 6);
  assert.equal(result.targetGrams, 1500);
  assert.equal(result.best.vendor.id, 'low-shipping');
  assert.deepEqual(result.batchComparisons.map(batch => [batch.quantity, batch.best.vendor.id, batch.best.totalIls]), [
    [4, 'low-shipping', 38], [6, 'low-shipping', 52],
    [8, 'low-item-price', 64], [10, 'low-item-price', 74]
  ]);
  const fees = board([offer('low-item-price', 5, 24), offer('low-shipping', 7, 10, {
    mandatoryFees: [{ label: 'Mandatory service fee', amount: 20, currency: 'ILS' }]
  })]);
  assert.equal(fees.best.vendor.id, 'low-item-price', 'mandatory fees can change the winner');
});

test('delivery-only comparisons omit self-pickup and its terms without mixing coffee into dairy', () => {
  const delivered = offer('delivered', 6, 20);
  delivered.shipping.pickup = { available: true, amount: { amount: 0, currency: 'ILS' }, note: 'self-pickup terms' };
  const result = board([
    delivered,
    offer('pickup', 1, 0, { shipping: { mode: 'pickup', service: 'self_pickup' } }),
    offer('wrong-mode', 1, 0, { shipping: { ...delivered.shipping, service: 'self_pickup' } }),
    offer('coffee', 1, 0, { product: { ...delivered.product, productId: 'lavazza-crema-e-gusto-vacuum-ground', form: 'ground' } })
  ]);
  assert.equal(result.counts.observed, 1);
  assert.equal(result.best.vendor.id, 'delivered');
  assert.equal(result.best.shipping.pickup, null);
  assert.deepEqual(result.pickup, []);
});

test('unknown charges, stale stock, quantity caps and minimum orders cannot produce a batch winner', () => {
  const noRate = offer('unknown-shipping', 1, null);
  noRate.shipping.certainty = 'unknown';
  const belowMinimum = offer('minimum', 5, 10);
  belowMinimum.shipping.minOrder = { amount: 100, currency: 'ILS' };
  const result = board([
    noRate, belowMinimum,
    offer('limit-two', 1, 0, { maxUnits: 2 }),
    offer('out-of-stock', 1, 0, { availability: 'out_of_stock' }),
    offer('unknown-stock', 1, 0, { availability: 'unknown' }),
    offer('stale', 1, 0, { observedAt: '2026-10-01T00:00:00Z' })
  ]);
  assert.equal(result.best, null);
  assert.ok(result.batchComparisons.every(batch => batch.best === null));
  assert.match(result.unrankable.find(quote => quote.vendor.id === 'limit-two').reasons.join(' '), /limits this listing to 2/);
  assert.match(result.unrankable.find(quote => quote.vendor.id === 'minimum').reasons.join(' '), /minimum order/);
});

test('whole multipacks cannot silently overbuy an exact tub batch', () => {
  const multipack = offer('four-pack', 20, 10, {
    product: { productId, form: 'cottage_cheese', packGrams: 250, packCount: 4, totalGrams: 1000 }
  });
  const result = board([multipack], { targetQuantity: 6 });
  assert.equal(result.best, null);
  assert.match(result.unrankable[0].reasons.join(' '), /exact batch of 6/);
  assert.deepEqual(result.batchComparisons.map(batch => batch.best?.totalIls ?? null), [30, null, 50, null]);
});

test('a new product without observed offers keeps every delivered batch total unknown', () => {
  const result = board([]);
  assert.equal(result.targetQuantity, 4);
  assert.deepEqual(result.batchComparisons.map(batch => batch.best), [null, null, null, null]);
  assert.equal(result.counts.observed, 0);
});
