import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBuffer, decodeHtml } from '../src/lib/text.js';
import { parseCoffeemanProduct, parseShippingOptions } from '../src/vendors/coffeeman.js';
import { parsePucksProduct } from '../src/vendors/pucks.js';
import { classifyListing } from '../src/catalog.js';

const fixtures = new URL('./fixtures/', import.meta.url);
const read = name => readFileSync(new URL(name, fixtures));
const now = Date.parse('2026-10-12T10:45:00.000Z');

test('coffeeman fixture decodes windows-1255 and keeps Hebrew readable', () => {
  const bytes = read('coffeeman-product.windows-1255.html');
  const html = decodeHtml(bytes);
  assert.match(html, /קפה טחון/);
  assert.match(html, /איסוף עצמי בחינם/);
  assert.equal(decodeBuffer(bytes, 'utf-8').includes('�'), true, 'raw utf-8 decode is expected to be lossy');
});

test('coffeeman parser observes price, currency, availability and published delivery', () => {
  const html = decodeHtml(read('coffeeman-product.windows-1255.html'));
  const observation = parseCoffeemanProduct(html, { now });
  assert.equal(observation.product.productId, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(observation.product.variantId, 'classico');
  assert.equal(observation.product.form, 'ground');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.product.packCount, 1);
  assert.equal(observation.product.totalGrams, 250);
  assert.equal(observation.price.amount, 33);
  assert.equal(observation.price.currency, 'ILS');
  assert.equal(observation.availability, 'in_stock');
  assert.equal(observation.shipping.certainty, 'verified');
  assert.equal(observation.shipping.amount.amount, 25);
  assert.equal(observation.shipping.pickup.available, true);
  assert.match(observation.shipping.note, /distribution-center/);
  assert.equal(observation.observedAt, new Date(now).toISOString());
  assert.equal(observation.evidence[0].url, observation.itemUrl);
});

test('coffeeman out-of-stock fixture is not reported as available', () => {
  const html = decodeHtml(read('coffeeman-product.outofstock.windows-1255.html'));
  const observation = parseCoffeemanProduct(html, { now });
  assert.equal(observation.availability, 'out_of_stock');
});

test('pucks parser reads the product JSON-LD and leaves shipping unknown', () => {
  const observation = parsePucksProduct(read('pucks-product.html').toString('utf8'), { now });
  assert.equal(observation.product.variantId, 'classico');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.price.amount, 30);
  assert.equal(observation.price.currency, 'ILS');
  assert.equal(observation.availability, 'in_stock');
  assert.equal(observation.shipping.certainty, 'unknown');
  assert.equal(observation.shipping.amount, null);
  assert.match(observation.shipping.note, /checkout/);
});

test('pucks derived fixtures map out-of-stock and unlisted availability honestly', () => {
  const oos = parsePucksProduct(read('pucks-product.outofstock.html').toString('utf8'), { now });
  assert.equal(oos.availability, 'out_of_stock');
  const pre = parsePucksProduct(read('pucks-product.preorder.html').toString('utf8'), { now });
  assert.equal(pre.availability, 'unknown');
});

test('parser rejects listings that are not the tracked ground vacuum brick', () => {
  const beanFixture = `<!DOCTYPE html><html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: 'Lavazza Crema e Gusto whole beans 1 kg',
    offers: { price: '59.00', priceCurrency: 'ILS', availability: 'https://schema.org/InStock' }
  })}</script></head><body></body></html>`;
  assert.throws(() => parsePucksProduct(beanFixture, { now }), /does not match/);
  const capsuleFixture = beanFixture.replace('whole beans 1 kg', 'capsules 10 pcs');
  assert.throws(() => parsePucksProduct(capsuleFixture, { now }), /does not match/);
});

test('shipping option parser tolerates a missing delivery list', () => {
  const result = parseShippingOptions('<html><body>no delivery block here</body></html>');
  assert.equal(result.deliveryCents, null);
  assert.equal(result.pickupFree, false);
  assert.match(result.note, /unknown/);
});

test('variant classification keeps Forte separate from Classico', () => {
  const classico = classifyListing('250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7');
  const forte = classifyListing('250 גרם לוואצה קרמה גוסטו פורטה טחון');
  assert.equal(classico.variantId, 'classico');
  assert.equal(forte.variantId, 'forte');
  assert.notEqual(classico.variantId, forte.variantId);
  const beans = classifyListing('פולי קפה Lavazza Crema e Gusto 1 ק"ג');
  assert.equal(beans.matched, false);
});
