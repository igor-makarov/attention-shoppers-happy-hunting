import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBuffer, decodeEntities, decodeHtml } from '../src/lib/text.js';
import { parseCoffeemanProduct, parseShippingOptions } from '../src/vendors/coffeeman.js';
import { parsePucksProduct } from '../src/vendors/pucks.js';
import { parseCoffee4uProduct, parseCoffee4uShipping } from '../src/vendors/coffee4u.js';
import { classifyListing, isRetiredProductId, resolveProductRequest } from '../src/catalog.js';
import { coffeemanEightPackPolicy } from '../src/lib/policies.js';

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
  assert.match(observation.shipping.destination.caveat, /home-delivery list/, 'the terms-page locality-list restriction is structured, not hidden in a note');
  assert.match(observation.shipping.destination.caveatSource, /coffeeman\.co\.il/);
  assert.equal(observation.shipping.evidence.retrievedAt, observation.observedAt, 'shipping evidence carries its retrieval time');
  assert.equal(observation.availabilityEvidence.retrievedAt, observation.observedAt, 'availability evidence carries its retrieval time');
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
  assert.equal(eight.shipping.certainty, 'checkout_quote', 'the anonymous checkout quote resolves the 8-pack rate without calling it published');
  assert.equal(eight.shipping.amount.amount, 20);
  assert.equal(eight.shipping.maxTotalGrams, 2000, 'the observed rate is limited to the 2 kg cart it was quoted on');
  assert.match(eight.shipping.note, /checkout quote/i);
  assert.equal(eight.shipping.evidence.retrievedAt, '2026-10-12T20:07:00Z', 'shipping evidence keeps the latest research retrieval time');
  assert.equal(eight.shipping.policy.id, coffeemanEightPackPolicy.id, 'the parsed row names the validated policy it came from');
  assert.equal(eight.shipping.policy.version, coffeemanEightPackPolicy.version);
  assert.equal(eight.shipping.policy.reviewBy, coffeemanEightPackPolicy.reviewBy);
  assert.equal(eight.availability, 'in_stock');
  assert.match(eight.shipping.destination.caveat, /home-delivery list/, 'even an unrankable offer keeps the documented coverage caveat');
});

test('coffeeman cart research adds the distribution-center alternative without changing the ranked rate', () => {
  const single = parseCoffeemanProduct(decodeHtml(read('coffeeman-product.windows-1255.html')), { now });
  assert.equal(single.shipping.amount.amount, 25, 'the ranked amount stays the published courier rate');
  assert.equal(single.shipping.certainty, 'verified', 'the ranked rate is still the published one, not a cart quote');
  assert.equal(single.shipping.alternatives.length, 1);
  assert.equal(single.shipping.alternatives[0].id, 'distribution-center');
  assert.equal(single.shipping.alternatives[0].amount.amount, 15);
  assert.match(single.shipping.alternatives[0].label, /cart-observed for 0\.5–1 kg carts/);
  assert.match(single.shipping.alternatives[0].note, /no free-shipping rule is published/i);
  assert.match(single.shipping.note, /distribution-center/);

  const four = parseCoffeemanProduct(decodeHtml(read('coffeeman-4pack-product.windows-1255.html')), { now, url: 'https://example.test/4pack' });
  assert.equal(four.shipping.amount.amount, 25, 'the 4-pack ranked rate is unchanged');
  assert.equal(four.shipping.alternatives[0].amount.amount, 15, 'the 4-pack cart observation resolves by pack shape too');
  assert.match(four.shipping.alternatives[0].label, /the 1 kg cart/);

  const eight = parseCoffeemanProduct(decodeHtml(read('coffeeman-8pack-product.windows-1255.html')), { now, url: 'https://example.test/8pack' });
  assert.equal(eight.shipping.amount.amount, 20, 'the 8-pack cart quote is unchanged');
  assert.equal(eight.shipping.alternatives[0].amount.amount, 20, 'the 8-pack distribution-center alternative carries the observed amount');
  assert.match(eight.shipping.alternatives[0].label, /the 2 kg cart/);
  assert.equal(eight.shipping.evidence.retrievedAt, '2026-10-12T20:07:00Z', 'the re-check time is kept as shipping evidence');
});

test('pucks parser reads the product JSON-LD and keeps the researched checkout rate conditional', () => {
  const observation = parsePucksProduct(read('pucks-product.html').toString('utf8'), { now });
  assert.equal(observation.product.variantId, 'classico');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.price.amount, 30);
  assert.equal(observation.price.currency, 'ILS');
  assert.equal(observation.availability, 'in_stock');
  assert.equal(observation.shipping.certainty, 'checkout_quote', 'the estimator rate is recorded as a conditional checkout quote, not a published page rate');
  assert.equal(observation.shipping.amount.amount, 30);
  assert.equal(observation.shipping.freeThreshold.amount, 100);
  assert.match(observation.shipping.note, /checkout/i);
  assert.match(observation.shipping.destination.caveat, /not individually verified/, 'the observed rate keeps its coverage caveat');
  assert.equal(observation.shipping.evidence.retrievedAt, '2026-10-12T18:10:10Z', 'shipping evidence keeps the research retrieval time, not the fetch time');
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
  assert.match(observation.shipping.destination.caveat, /home-delivery list/, 'the terms-page locality-list restriction is structured, not hidden in a note');
  assert.match(observation.shipping.destination.caveat, /closed list of 1,269/, 'the rendered-checkout coverage shape is disclosed, not just the terms caveat');
  assert.match(observation.shipping.destination.caveatSource, /coffee4u\.co\.il/);
  assert.equal(observation.shipping.destination.observed.courierLocalities, 1269);
  assert.equal(observation.shipping.destination.observed.pickupPointLocalities, 420);
  assert.deepEqual(observation.shipping.destination.observed.verifiedLocalities, ['תל אביב - יפו', 'אילת']);
  assert.match(observation.shipping.destination.observed.evidence, /2026-10-12-coffee4u-coverage\.json/);
  assert.match(observation.shipping.alternatives[0].note, /420 localities with pickup spots/);
  assert.match(observation.shipping.note, /closed list of 1,269/, 'the shipping terms keep the observed coverage detail');
  assert.match(observation.shipping.evidence.note, /2026-10-12-coffee4u-coverage\.json/, 'the coverage evidence path stays reachable');
  assert.equal(observation.shipping.evidence.retrievedAt, observation.observedAt, 'shipping evidence carries its retrieval time');
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

test('raw blend wording is recorded per listing without becoming a filter', () => {
  const classico = classifyListing('250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7');
  const forte = classifyListing('250 גרם לוואצה קרמה גוסטו פורטה טחון');
  assert.equal(classico.variantId, 'classico');
  assert.equal(forte.variantId, 'forte');
  assert.notEqual(classico.variantId, forte.variantId);
  const beans = classifyListing('פולי קפה Lavazza Crema e Gusto 1 ק"ג');
  assert.equal(beans.matched, false);
});

test('retired product fixtures are refused by both adapters instead of being re-tracked', () => {
  // The Qualità Oro, Qualità Rossa and Suerte excerpts are kept in
  // tests/fixtures/historical-retired/ as historical evidence and negative inputs.
  // The 2026-10-12 owner correction retired those lines, so every adapter must
  // refuse them with an explicit reason instead of producing an observation.
  const oro = decodeHtml(read('historical-retired/coffeeman-qualita-oro-product.windows-1255.html'));
  assert.throws(
    () => parseCoffeemanProduct(oro, { now, productId: 'lavazza-qualita-oro-vacuum-ground' }),
    error => /does not match the tracked product/.test(error.message)
      && error.details.reasons.join(' ').includes('was retired'),
    'the Qualità Oro page is refused with an explicit retired-line reason'
  );
  const rossa = decodeHtml(read('historical-retired/coffeeman-qualita-rossa-product.windows-1255.html'));
  assert.throws(
    () => parseCoffeemanProduct(rossa, { now, productId: 'lavazza-qualita-rossa-vacuum-ground' }),
    /does not match the tracked product/
  );
  const suerte = decodeHtml(read('historical-retired/coffeeman-suerte-product.windows-1255.html'));
  assert.throws(
    () => parseCoffeemanProduct(suerte, { now, productId: 'lavazza-suerte-ground' }),
    /does not match the tracked product/
  );

  const pucksOro = read('historical-retired/pucks-qualita-oro-product.html').toString('utf8');
  assert.throws(
    () => parsePucksProduct(pucksOro, { now, productId: 'lavazza-qualita-oro-vacuum-ground' }),
    /does not match the tracked product/
  );
  const pucksRossaOos = read('historical-retired/pucks-qualita-rossa-outofstock-product.html').toString('utf8');
  assert.throws(
    () => parsePucksProduct(pucksRossaOos, { now, productId: 'lavazza-qualita-rossa-vacuum-ground' }),
    /does not match the tracked product/
  );
  const pucksSuerte = read('historical-retired/pucks-suerte-product.html').toString('utf8');
  assert.throws(
    () => parsePucksProduct(pucksSuerte, { now, productId: 'lavazza-suerte-ground' }),
    /does not match the tracked product/
  );
});

test('a retired line never matches, even without a scoped product id', () => {
  const cases = [
    'Lavazza Qualita Oro ground 250 gr - קפה טחון',
    '8 אריזות 250 גרם Lavazza Qualit&#224; Oro קפה טחון',
    '250 גרם קפה טחון Lavazza Qualita Rossa- חוזק 5',
    'Lavazza Qualita Rossa- לווצה רוסה 250 גרם קפה טחון',
    '250 גרם קפה טחון LAVAZZA SUERTE חוזק 10',
    'Lavazza Suerte- לווצה סוארטה 250 גרם קפה טחון'
  ];
  for (const name of cases) {
    const classification = classifyListing(name);
    assert.equal(classification.matched, false, `${name} must not match`);
    assert.ok(classification.retiredLine, `${name} is identified as a retired line`);
    assert.match(classification.reasons.join(' '), /belongs to the retired Lavazza/);
    assert.match(classification.reasons.join(' '), /only Lavazza Crema e Gusto is tracked/);
  }
  // Retired ids stay recognised so an old shared link can be explained instead
  // of silently showing a different product.
  assert.equal(isRetiredProductId('lavazza-qualita-oro-vacuum-ground'), true);
  assert.equal(isRetiredProductId('lavazza-qualita-rossa-vacuum-ground'), true);
  assert.equal(isRetiredProductId('lavazza-suerte-ground'), true);
  assert.equal(isRetiredProductId('lavazza-crema-e-gusto-vacuum-ground'), false);

  const { product, retired, known } = resolveProductRequest('lavazza-qualita-oro-vacuum-ground');
  assert.equal(product.id, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(retired.line, 'Qualità Oro');
  assert.equal(known, false, 'the retired id is not treated as a tracked product');
});

test('classification picks the one tracked line and keeps forms apart while recording blend wording', () => {
  const crema = classifyListing('250 גרם קפה טחון lavazza Crema e Gusto Classico חוזק 7');
  assert.equal(crema.matched, true);
  assert.equal(crema.productId, 'lavazza-crema-e-gusto-vacuum-ground');
  assert.equal(crema.variantId, 'classico');
  assert.equal(crema.packGrams, 250);
  const forte = classifyListing('250 גרם לוואצה קרמה גוסטו פורטה טחון');
  assert.equal(forte.matched, true, 'a Forte listing is the same tracked product and is compared in the same board');
  assert.equal(forte.variantId, 'forte');

  const beans = classifyListing('פולי קפה Lavazza Crema e Gusto 1 ק"ג');
  assert.equal(beans.matched, false);
  assert.match(beans.reasons.join(' '), /whole beans/);
  const pods = classifyListing('Lavazza Crema e Gusto capsules 100 אלומיניום');
  assert.equal(pods.matched, false);
  assert.match(pods.reasons.join(' '), /capsules or pods/);
  const unrelated = classifyListing('Lavazza Tierra ground coffee 250 g');
  assert.equal(unrelated.matched, false);
  assert.match(unrelated.reasons.join(' '), /tracked Lavazza Crema e Gusto line/);

  // A listing scoped to the tracked product still refuses another line.
  const scoped = classifyListing('Lavazza Qualita Oro ground 250 gr', { productId: 'lavazza-crema-e-gusto-vacuum-ground' });
  assert.equal(scoped.matched, false);
  assert.match(scoped.reasons.join(' '), /belongs to the retired Lavazza/);
  assert.match(scoped.reasons.join(' '), /only Lavazza Crema e Gusto is tracked/);
});

test('html entities are decoded without touching anything else', () => {
  assert.equal(decodeEntities('Lavazza Qualit&#224; Oro'), 'Lavazza Qualità Oro');
  assert.equal(decodeEntities('Qualit&agrave; Oro'), 'Qualità Oro');
  assert.equal(decodeEntities('100 &#8362; &amp; more'), '100 ₪ & more');
  assert.equal(decodeEntities('plain text'), 'plain text');
  assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;');
  assert.equal(decodeEntities(null), '');
});
