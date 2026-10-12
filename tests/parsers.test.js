import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBuffer, decodeEntities, decodeHtml } from '../src/lib/text.js';
import { parseCoffeemanProduct, parseShippingOptions } from '../src/vendors/coffeeman.js';
import { parsePucksProduct } from '../src/vendors/pucks.js';
import { parseCoffee4uProduct, parseCoffee4uShipping } from '../src/vendors/coffee4u.js';
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

test('coffeeman 4-pack and 8-pack fixtures keep pack count, price and shipping separate', () => {
  const four = parseCoffeemanProduct(decodeHtml(read('coffeeman-4pack-product.windows-1255.html')), { now, url: 'https://example.test/4pack' });
  assert.equal(four.product.packCount, 4);
  assert.equal(four.product.packGrams, 250);
  assert.equal(four.product.totalGrams, 1000);
  assert.equal(four.product.sku, '930334');
  assert.equal(four.price.amount, 124);
  assert.equal(four.shipping.certainty, 'verified');
  assert.equal(four.shipping.amount.amount, 25);
  assert.equal(four.itemUrl, 'https://example.test/4pack');

  const eight = parseCoffeemanProduct(decodeHtml(read('coffeeman-8pack-product.windows-1255.html')), { now, url: 'https://example.test/8pack' });
  assert.equal(eight.product.packCount, 8);
  assert.equal(eight.product.totalGrams, 2000);
  assert.equal(eight.product.sku, '930335');
  assert.equal(eight.price.amount, 240);
  assert.equal(eight.shipping.certainty, 'unknown', 'the 8-pack page publishes no courier price');
  assert.equal(eight.shipping.amount, null);
  assert.equal(eight.availability, 'in_stock');
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

test('coffee4u fixture decodes windows-1255 and parses price, stock, SKU and delivery options', () => {
  const bytes = read('coffee4u-product.windows-1255.html');
  const html = decodeHtml(bytes);
  assert.match(html, /Lavazza Crema e gusto/);
  assert.match(html, /טחון בוואקום/);

  const observation = parseCoffee4uProduct(html, { now });
  assert.equal(observation.product.productId, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(observation.product.form, 'ground');
  assert.equal(observation.product.variantId, 'unspecified', 'the vendor does not state Classico, Forte or another blend variant');
  assert.equal(observation.product.variantLabel, 'Variant not stated');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.product.packCount, 1);
  assert.equal(observation.product.totalGrams, 250);
  assert.equal(observation.product.sku, '2010561');
  assert.equal(observation.price.amount, 38);
  assert.equal(observation.price.currency, 'ILS');
  assert.equal(observation.availability, 'in_stock');
  assert.equal(observation.shipping.certainty, 'verified');
  assert.equal(observation.shipping.amount.amount, 30, 'ranked shipping is the published door-to-door courier rate');
  assert.equal(observation.shipping.alternatives[0].amount.amount, 15, 'the pickup-point delivery is an alternative, never the ranked rate');
  assert.equal(observation.shipping.pickup.available, true);
  assert.equal(observation.shipping.pickup.amount.amount, 0);
  assert.match(observation.shipping.note, /₪30\.00/);
  assert.match(observation.shipping.note, /₪15\.00/);
  assert.equal(observation.observedAt, new Date(now).toISOString());
  assert.equal(observation.evidence[0].url, observation.itemUrl);
});

test('coffee4u out-of-stock fixture never claims availability', () => {
  const html = decodeHtml(read('coffee4u-product.outofstock.windows-1255.html'));
  const observation = parseCoffee4uProduct(html, { now });
  assert.equal(observation.availability, 'out_of_stock');
  assert.equal(observation.price.amount, 38, 'the price is still observed; availability is what changed');
});

test('coffee4u parser refuses a page without a courier rate instead of guessing zero', () => {
  const html = decodeHtml(read('coffee4u-product.windows-1255.html')).replace(/<li[^>]*>[\s\S]*?שליחות[\s\S]*?<\/li>/, '');
  const observation = parseCoffee4uProduct(html, { now });
  assert.equal(observation.shipping.certainty, 'unknown');
  assert.equal(observation.shipping.amount, null);
});

test('coffee4u shipping parser reports self-pickup and the pickup-point option separately', () => {
  const html = decodeHtml(read('coffee4u-product.windows-1255.html'));
  const parsed = parseCoffee4uShipping(html);
  assert.equal(parsed.courierAmount, 30);
  assert.equal(parsed.pickupPointAmount, 15);
  assert.equal(parsed.selfPickup, true);
  assert.match(parsed.deliveryTime, /ימי עסקים/);
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

test('coffeeman Qualità Oro fixtures keep the second product, its pack sizes and its published shipping', () => {
  const single = parseCoffeemanProduct(decodeHtml(read('coffeeman-qualita-oro-product.windows-1255.html')), { now, productId: 'lavazza-qualita-oro-vacuum-ground' });
  assert.equal(single.product.productId, 'lavazza-qualita-oro-vacuum-ground');
  assert.equal(single.product.variantId, 'unspecified', 'the Qualità Oro page states no blend variant');
  assert.equal(single.product.packGrams, 250);
  assert.equal(single.product.packCount, 1);
  assert.equal(single.product.sku, '930339');
  assert.equal(single.price.amount, 37);
  assert.equal(single.price.currency, 'ILS');
  assert.equal(single.availability, 'in_stock');
  assert.equal(single.shipping.certainty, 'verified');
  assert.equal(single.shipping.amount.amount, 25);

  const four = parseCoffeemanProduct(decodeHtml(read('coffeeman-qualita-oro-4pack-product.windows-1255.html')), { now, productId: 'lavazza-qualita-oro-vacuum-ground' });
  // The page publishes the name as "Lavazza Qualit&#224; Oro": the entity must be decoded
  // or the listing would not match the tracked product line at all.
  assert.match(four.product.name, /Qualità Oro/);
  assert.equal(four.product.packCount, 4);
  assert.equal(four.product.totalGrams, 1000);
  assert.equal(four.product.sku, '930340');
  assert.equal(four.price.amount, 125);
  assert.equal(four.shipping.certainty, 'verified');

  const eight = parseCoffeemanProduct(decodeHtml(read('coffeeman-qualita-oro-8pack-product.windows-1255.html')), { now, productId: 'lavazza-qualita-oro-vacuum-ground' });
  assert.equal(eight.product.packCount, 8);
  assert.equal(eight.product.totalGrams, 2000);
  assert.equal(eight.price.amount, 239);
  assert.equal(eight.shipping.certainty, 'unknown', 'the 8-pack page publishes no courier price');
  assert.equal(eight.shipping.amount, null);
});

test('pucks Qualità Oro fixture is observed with its own SKU, GTIN and unknown shipping', () => {
  const observation = parsePucksProduct(read('pucks-qualita-oro-product.html').toString('utf8'), { now, url: 'https://pucks.co.il/product/lavazza-qualita-oro-ground-coffee-250gr', productId: 'lavazza-qualita-oro-vacuum-ground' });
  assert.equal(observation.product.productId, 'lavazza-qualita-oro-vacuum-ground');
  assert.equal(observation.product.variantId, 'unspecified');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.product.sku, 'lav11');
  assert.equal(observation.product.gtin, '8000070019911');
  assert.equal(observation.price.amount, 35);
  assert.equal(observation.availability, 'in_stock');
  assert.equal(observation.shipping.certainty, 'unknown');
  assert.match(observation.shipping.note, /checkout/);
  assert.equal(observation.itemUrl, 'https://pucks.co.il/product/lavazza-qualita-oro-ground-coffee-250gr');
});

test('coffeeman Qualità Rossa fixture parses the third product with its published courier rate', () => {
  const single = parseCoffeemanProduct(decodeHtml(read('coffeeman-qualita-rossa-product.windows-1255.html')), { now, productId: 'lavazza-qualita-rossa-vacuum-ground' });
  assert.equal(single.product.productId, 'lavazza-qualita-rossa-vacuum-ground');
  assert.equal(single.product.variantId, 'unspecified', 'the Qualità Rossa page states no blend variant');
  assert.equal(single.product.form, 'ground');
  assert.equal(single.product.packGrams, 250);
  assert.equal(single.product.packCount, 1);
  assert.equal(single.product.sku, '930336');
  assert.equal(single.price.amount, 33);
  assert.equal(single.price.currency, 'ILS');
  assert.equal(single.availability, 'in_stock');
  assert.equal(single.shipping.certainty, 'verified');
  assert.equal(single.shipping.amount.amount, 25);
  assert.equal(single.shipping.pickup.available, true);
});

test('pucks Qualità Rossa fixtures keep the in-stock and out-of-stock listings apart', () => {
  const inStock = parsePucksProduct(read('pucks-qualita-rossa-product.html').toString('utf8'), {
    now,
    url: 'https://pucks.co.il/product/lavazza-qualita-rossa-ground-coffee-250g',
    productId: 'lavazza-qualita-rossa-vacuum-ground'
  });
  assert.equal(inStock.product.productId, 'lavazza-qualita-rossa-vacuum-ground');
  assert.equal(inStock.product.variantId, 'unspecified');
  assert.equal(inStock.product.packGrams, 250);
  assert.equal(inStock.product.sku, 'Lav80');
  assert.equal(inStock.product.gtin, '8000070035980');
  assert.equal(inStock.price.amount, 30);
  assert.equal(inStock.availability, 'in_stock');
  assert.equal(inStock.shipping.certainty, 'unknown');

  const outOfStock = parsePucksProduct(read('pucks-qualita-rossa-outofstock-product.html').toString('utf8'), {
    now,
    url: 'https://pucks.co.il/product/lavazza-qualita-rossa-ground-coffee-powder-250g',
    productId: 'lavazza-qualita-rossa-vacuum-ground'
  });
  assert.equal(outOfStock.product.sku, 'Lav35');
  assert.equal(outOfStock.product.gtin, '8000070035935');
  assert.equal(outOfStock.price.amount, 35, 'the price is still observed; only availability changed');
  assert.equal(outOfStock.availability, 'out_of_stock');
});

test('Qualità Rossa is classified as its own tracked line, never as Oro or Crema e Gusto', () => {
  const rossa = classifyListing('250 גרם קפה טחון Lavazza Qualita Rossa- חוזק 5');
  assert.equal(rossa.matched, true);
  assert.equal(rossa.productId, 'lavazza-qualita-rossa-vacuum-ground');
  assert.equal(rossa.variantId, 'unspecified');
  assert.equal(rossa.packGrams, 250);
  const hebrew = classifyListing('Lavazza Qualita Rossa- לווצה רוסה 250 גרם קפה טחון');
  assert.equal(hebrew.productId, 'lavazza-qualita-rossa-vacuum-ground');
  const entity = classifyListing('Lavazza Qualit&#224; Rossa 250 גרם טחון');
  assert.equal(entity.productId, 'lavazza-qualita-rossa-vacuum-ground');
  assert.equal(entity.packGrams, 250, 'the entity-encoded name still parses the pack weight');

  const scoped = classifyListing('Lavazza Qualita Rossa-250 גרם קפה טחון', { productId: 'lavazza-qualita-oro-vacuum-ground' });
  assert.equal(scoped.matched, false, 'a Rossa listing never matches the Qualità Oro adapter');
  assert.match(scoped.reasons.join(' '), /Qualità Oro/);
  const rossaBeans = classifyListing('Lavazza Qualita Rossa פולי קפה 1 ק"ג');
  assert.equal(rossaBeans.matched, false);
  assert.match(rossaBeans.reasons.join(' '), /whole beans/);
});

test('coffeeman Suerte fixture parses the fourth product with its published courier rate', () => {
  const single = parseCoffeemanProduct(decodeHtml(read('coffeeman-suerte-product.windows-1255.html')), { now, productId: 'lavazza-suerte-ground' });
  assert.equal(single.product.productId, 'lavazza-suerte-ground');
  assert.equal(single.product.variantId, 'unspecified', 'the Suerte page states no blend variant');
  assert.equal(single.product.form, 'ground');
  assert.equal(single.product.packGrams, 250);
  assert.equal(single.product.packCount, 1);
  assert.equal(single.product.sku, '930661');
  assert.equal(single.price.amount, 33);
  assert.equal(single.price.currency, 'ILS');
  assert.equal(single.availability, 'in_stock');
  assert.equal(single.shipping.certainty, 'verified');
  assert.equal(single.shipping.amount.amount, 25);
  assert.equal(single.shipping.pickup.available, true);
});

test('pucks Suerte fixture parses its own SKU, GTIN and unknown shipping', () => {
  const observation = parsePucksProduct(read('pucks-suerte-product.html').toString('utf8'), {
    now,
    url: 'https://pucks.co.il/product/lavazza-suerte-ground-coffee-250g',
    productId: 'lavazza-suerte-ground'
  });
  assert.equal(observation.product.productId, 'lavazza-suerte-ground');
  assert.equal(observation.product.variantId, 'unspecified');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.product.sku, 'Lav03');
  assert.equal(observation.product.gtin, '8000070083103');
  assert.equal(observation.price.amount, 35);
  assert.equal(observation.availability, 'in_stock');
  assert.equal(observation.shipping.certainty, 'unknown');
});

test('Suerte is classified as its own tracked line and never merged with the other products', () => {
  const suerte = classifyListing('250 גרם קפה טחון LAVAZZA SUERTE חוזק 10');
  assert.equal(suerte.matched, true);
  assert.equal(suerte.productId, 'lavazza-suerte-ground');
  assert.equal(suerte.variantId, 'unspecified');
  assert.equal(suerte.packGrams, 250);
  const hebrew = classifyListing('Lavazza Suerte- לווצה סוארטה 250 גרם קפה טחון');
  assert.equal(hebrew.productId, 'lavazza-suerte-ground');
  const scoped = classifyListing('Lavazza Suerte-250 גרם קפה טחון', { productId: 'lavazza-qualita-rossa-vacuum-ground' });
  assert.equal(scoped.matched, false, 'a Suerte listing never matches the Qualità Rossa adapter');
  assert.match(scoped.reasons.join(' '), /Qualità Rossa/);
});

test('a listing is refused when it belongs to another tracked line', () => {
  const html = decodeHtml(read('coffeeman-qualita-oro-product.windows-1255.html'));
  assert.throws(
    () => parseCoffeemanProduct(html, { now, productId: 'lavazza-crema-e-gusto-vacuum-ground' }),
    /does not match the tracked product/
  );
  const other = decodeHtml(read('coffeeman-product.windows-1255.html'));
  assert.throws(
    () => parseCoffeemanProduct(other, { now, productId: 'lavazza-qualita-oro-vacuum-ground' }),
    /does not match the tracked product/
  );
});

test('classification picks the tracked line from the listing name and keeps forms apart', () => {
  const oro = classifyListing('Lavazza Qualita Oro ground 250 gr - קפה טחון');
  assert.equal(oro.matched, true);
  assert.equal(oro.productId, 'lavazza-qualita-oro-vacuum-ground');
  assert.equal(oro.variantId, 'unspecified');
  const oroEntity = classifyListing('8 אריזות 250 גרם Lavazza Qualit&#224; Oro קפה טחון');
  assert.equal(oroEntity.productId, 'lavazza-qualita-oro-vacuum-ground');
  assert.equal(oroEntity.packCount, 8);

  const oroBeans = classifyListing('Lavazza Qualità Oro 1 kg פולי קפה');
  assert.equal(oroBeans.matched, false);
  assert.match(oroBeans.reasons.join(' '), /whole beans/);
  const oroPods = classifyListing('Lavazza Qualità Oro capsules 100 אלומיניום');
  assert.equal(oroPods.matched, false);
  assert.match(oroPods.reasons.join(' '), /capsules or pods/);

  const crema = classifyListing('250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7');
  assert.equal(crema.productId, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(crema.variantId, 'classico');
  const unrelated = classifyListing('Lavazza Tierra ground coffee 250 g');
  assert.equal(unrelated.matched, false);
  assert.match(unrelated.reasons.join(' '), /tracked Lavazza product line/);
});

test('html entities are decoded without touching anything else', () => {
  assert.equal(decodeEntities('Lavazza Qualit&#224; Oro'), 'Lavazza Qualità Oro');
  assert.equal(decodeEntities('Qualit&agrave; Oro'), 'Qualità Oro');
  assert.equal(decodeEntities('100 &#8362; &amp; more'), '100 ₪ & more');
  assert.equal(decodeEntities('plain text'), 'plain text');
  assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;');
  assert.equal(decodeEntities(null), '');
});
