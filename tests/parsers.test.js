import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBuffer, decodeEntities, decodeHtml } from '../src/lib/text.js';
import { parseCoffeemanProduct, parseShippingOptions } from '../src/vendors/coffeeman.js';
import { parsePucksProduct } from '../src/vendors/pucks.js';
import { parseCoffee4uProduct, parseCoffee4uShipping } from '../src/vendors/coffee4u.js';
import { parseTivtaamProduct, selectTivtaamProduct } from '../src/vendors/tivtaam.js';
import { parseYudaProduct, selectYudaProduct, classifyYudaNames } from '../src/vendors/yuda.js';
import { parseDuchanProduct, selectDuchanProduct, classifyDuchanNames } from '../src/vendors/duchan.js';
import { readFixtureForUrl } from './fixtures/vendor-fixtures.mjs';
import { classifyListing, isRetiredProductId, resolveProductRequest } from '../src/catalog.js';
import { coffeemanEightPackPolicy, coffeemanSingleFourPackPolicy, coffee4uHomeDeliveryPolicy } from '../src/lib/policies.js';

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
  assert.match(observation.shipping.destination.caveat, /closed 264-locality select/, 'the observed checkout locality-list shape is disclosed');
  assert.equal(observation.shipping.destination.observed.homeDeliveryLocalities, 264);
  assert.deepEqual(observation.shipping.destination.observed.verifiedLocalities, ['תל אביב - יפו', 'ירושלים', 'חיפה', 'באר שבע', 'אילת']);
  assert.match(observation.shipping.destination.observed.evidence, /2026-10-13-coffeeman-home-delivery-locality-coverage\.json/);
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
  assert.equal(eight.shipping.evidence.retrievedAt, '2026-10-13T08:52:00Z', 'shipping evidence keeps the latest research retrieval time');
  assert.equal(eight.shipping.policy.id, coffeemanEightPackPolicy.id, 'the parsed row names the validated policy it came from');
  assert.equal(eight.shipping.policy.version, coffeemanEightPackPolicy.version);
  assert.equal(eight.shipping.policy.reviewBy, coffeemanEightPackPolicy.reviewBy);
  assert.equal(eight.availability, 'in_stock');
  assert.match(eight.shipping.destination.caveat, /home-delivery list/, 'even an unrankable offer keeps the documented coverage caveat');
});

test('coffeeman cart research adds the distribution-center alternative and the observed free cart conditions at their scope', () => {
  const single = parseCoffeemanProduct(decodeHtml(read('coffeeman-product.windows-1255.html')), { now });
  assert.equal(single.shipping.amount.amount, 25, 'the ranked base amount stays the published courier rate');
  assert.equal(single.shipping.certainty, 'verified', 'the ranked rate is still the published one, not a cart quote');
  assert.equal(single.shipping.alternatives.length, 1);
  assert.equal(single.shipping.alternatives[0].id, 'distribution-center');
  assert.equal(single.shipping.alternatives[0].amount.amount, 15);
  assert.match(single.shipping.alternatives[0].label, /cart-observed for 0\.5–1 kg carts/);
  assert.match(single.shipping.alternatives[0].note, /Free home courier was observed only on the exact/);
  assert.match(single.shipping.note, /distribution-center/);
  assert.equal(single.shipping.policy.id, coffeemanSingleFourPackPolicy.id, 'the parsed row names the validated single/4-pack policy');
  assert.equal(single.shipping.policy.version, coffeemanSingleFourPackPolicy.version);
  assert.equal(single.shipping.policy.origin, 'published');
  // The free observations are exact anonymous-cart conditions, never a
  // published or inferred threshold.
  assert.equal(single.shipping.freeThreshold ?? null, null, 'no monotone threshold is recorded');
  assert.deepEqual(single.shipping.freeCartConditions.map(condition => condition.id), ['singles-7', 'singles-8', 'fourpack-2']);
  assert.equal(single.shipping.freeCartConditions[0].itemSubtotalIls, 231);
  assert.equal(single.shipping.freeCartConditions[0].units, 7);
  assert.equal(single.shipping.freeCartConditions[1].discountPercent, 10, 'the 8-singles condition records the automatic 10% discount');
  assert.equal(single.shipping.freeCartConditions[1].paidItemTotalIls, 237.6);
  assert.match(single.shipping.freeCartConditions[0].evidence.url, /coffeeman\.co\.il\/checkout\.asp/);
  assert.equal(single.shipping.freeCartConditions[0].observedAt, '2026-10-12T20:09:00Z');

  const four = parseCoffeemanProduct(decodeHtml(read('coffeeman-4pack-product.windows-1255.html')), { now, url: 'https://example.test/4pack' });
  assert.equal(four.shipping.amount.amount, 25, 'the 4-pack ranked base rate is unchanged');
  assert.equal(four.shipping.alternatives[0].amount.amount, 15, 'the 4-pack cart observation resolves by pack shape too');
  assert.match(four.shipping.alternatives[0].label, /cart-observed for 0\.5–1 kg carts/);
  assert.equal(four.shipping.policy.id, coffeemanSingleFourPackPolicy.id, 'the 4-pack row names the same validated policy');
  assert.deepEqual(four.shipping.freeCartConditions.map(condition => condition.id), ['singles-7', 'singles-8', 'fourpack-2'], 'the 4-pack listing shares the observed free cart conditions');

  const eight = parseCoffeemanProduct(decodeHtml(read('coffeeman-8pack-product.windows-1255.html')), { now, url: 'https://example.test/8pack' });
  assert.equal(eight.shipping.amount.amount, 20, 'the 8-pack cart quote is unchanged');
  assert.equal(eight.shipping.alternatives[0].amount.amount, 20, 'the 8-pack distribution-center alternative carries the observed amount');
  assert.match(eight.shipping.alternatives[0].label, /the 2 kg cart/);
  assert.equal(eight.shipping.freeThreshold ?? null, null, 'the ₪240 8-pack SKU keeps its own ₪20 quote, never the single/4-pack free condition');
  assert.ok(eight.shipping.freeCartConditions == null, 'the 8-pack SKU never carries the single/4-pack free conditions');
  assert.equal(eight.shipping.evidence.retrievedAt, '2026-10-13T08:52:00Z', 'the re-check time is kept as shipping evidence');
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
  assert.match(observation.shipping.destination.caveat, /Haifa \/ 3100000/, 'the 2026-10-13 destination checks are part of the caveat evidence');
  assert.equal(observation.shipping.evidence.retrievedAt, '2026-10-13T01:41:10Z', 'shipping evidence keeps the research retrieval time, not the fetch time');
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
  assert.equal(observation.shipping.alternatives[0].id, 'pickup-point');
  assert.equal(observation.shipping.alternatives[0].maxTotalGrams, 5000);
  assert.equal(observation.shipping.policy.id, coffee4uHomeDeliveryPolicy.id, 'the parsed row names the validated Coffee4U policy');
  assert.equal(observation.shipping.policy.origin, 'published');
  assert.equal(observation.shipping.pickup.available, true);
  assert.equal(observation.shipping.pickup.amount.amount, 0);
  assert.match(observation.shipping.note, /₪30\.00/);
  assert.match(observation.shipping.note, /₪15\.00/);
  assert.match(observation.shipping.destination.caveat, /home-delivery list/, 'the terms-page locality-list restriction is structured, not hidden in a note');
  assert.match(observation.shipping.destination.caveat, /closed list of 1,269/, 'the rendered-checkout coverage shape is disclosed, not just the terms caveat');
  assert.match(observation.shipping.destination.caveatSource, /coffee4u\.co\.il/);
  assert.equal(observation.shipping.destination.observed.courierLocalities, 1269);
  assert.equal(observation.shipping.destination.observed.pickupPointLocalities, 426);
  assert.deepEqual(observation.shipping.destination.observed.pickupPointVerifiedLocalities, ['תל אביב - יפו', 'ירושלים', 'חיפה', 'באר שבע', 'אילת']);
  assert.equal(observation.shipping.destination.observed.pickupPointSpotCounts['באר שבע'], 34);
  assert.match(observation.shipping.destination.observed.pickupPointEvidence, /2026-10-13-coffee4u-pickup-point-coverage\.json/);
  assert.deepEqual(observation.shipping.destination.observed.verifiedLocalities, ['תל אביב - יפו', 'אילת', 'ירושלים', 'חיפה', 'באר שבע']);
  assert.match(observation.shipping.destination.observed.evidence, /2026-10-13-coffee4u-destination-extension\.json/);
  assert.match(observation.shipping.alternatives[0].note, /426 localities with pickup spots/);
  assert.match(observation.shipping.alternatives[0].note, /₪76 \+ ₪15 = ₪91/);
  assert.match(observation.shipping.note, /closed list of 1,269/, 'the shipping terms keep the observed coverage detail');
  for (const locality of ['תל אביב - יפו', 'אילת', 'ירושלים', 'חיפה', 'באר שבע']) {
    assert.ok(observation.shipping.note.includes(locality), `the parsed note names every verified locality (${locality})`);
  }
  assert.match(observation.shipping.evidence.note, /2026-10-13-coffee4u-destination-extension\.json/, 'the coverage evidence path stays reachable');
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

// Tiv Taam cottage cheese (2026-10-15 owner addition). The fixture is the real
// public store API response for catalogProductId 12053 (branch 924) recorded
// from the GitHub Actions runner on 2026-10-15; the delivery terms are the
// checked-in policy, not the product response.
test('tivtaam fixture selects the active branch row and keeps the cottage-cheese identity', () => {
  const json = read('tivtaam-product.json').toString('utf8');
  const observation = parseTivtaamProduct(json, { now });
  assert.equal(observation.vendor.id, 'tivtaam');
  assert.equal(observation.product.productId, 'tnuva-cottage-cheese-5-percent');
  assert.equal(observation.product.form, 'cottage_cheese');
  assert.equal(observation.product.sku, '12053');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.product.packCount, 1);
  assert.equal(observation.product.totalGrams, 250);
  assert.equal(observation.price.amount, 6.1);
  assert.equal(observation.price.currency, 'ILS');
  assert.equal(observation.availability, 'in_stock');
  assert.match(observation.availabilityEvidence.value, /isActive=true/);
  assert.match(observation.availabilityEvidence.note, /never priced/);
  assert.equal(observation.shipping.service, 'home_delivery');
  assert.equal(observation.shipping.amount.amount, 29.9);
  assert.equal(observation.shipping.minOrder.amount, 300);
  assert.equal(observation.shipping.certainty, 'verified');
  assert.deepEqual(observation.shipping.destination.localities, ['tel-aviv']);
  assert.match(observation.shipping.destination.caveat, /minimum order/);
  assert.equal(observation.itemUrl, 'https://www.tivtaam.co.il/?catalogProduct=12053');
});

test('tivtaam parser never prices the retired hidden row and maps stock flags honestly', () => {
  const base = {
    productId: 12053,
    weight: 250,
    names: { '1': { long: "קוטג' 5% מהדרין" }, '2': { long: 'Cottage Tnuva (5%) 250 g' } },
    branch: { regularPrice: 6.1, isActive: true, isVisible: true, isOutOfStock: false, aisleName: 'מוצרי חלב' }
  };
  const hidden = { ...base, productId: 12053, branch: { regularPrice: 5.7, isActive: false, isVisible: false, isOutOfStock: false } };
  assert.equal(selectTivtaamProduct([hidden, base]).branch.regularPrice, 6.1, 'the active row is selected, not the cheaper hidden one');
  assert.equal(selectTivtaamProduct([hidden]).branch.regularPrice, 5.7, 'a hidden row is still the only evidence when nothing is sellable');
  assert.equal(selectTivtaamProduct([]), null);

  const oos = parseTivtaamProduct(JSON.stringify({ total: 1, products: [{ ...base, branch: { ...base.branch, isOutOfStock: true } }] }), { now });
  assert.equal(oos.availability, 'out_of_stock', 'the branch out-of-stock flag is not a price-only scrape');

  assert.throws(() => parseTivtaamProduct('not json', { now }), /did not return JSON/);
  assert.throws(() => parseTivtaamProduct(JSON.stringify({ total: 0, products: [] }), { now }), /No sellable branch product/);
  assert.throws(
    () => parseTivtaamProduct(JSON.stringify({ products: [{ ...base, names: { '1': { long: 'קוטג 9%' }, '2': { long: 'Cottage Tnuva (9%) 250 g' } } }] }), { now }),
    /does not match the tracked product/,
    'a 9% listing is refused instead of being merged into the 5% comparison'
  );
});


// Super Yuda cottage cheese (2026-10-15 owner addition, second grocery source).
// The fixture is the real public store API response for catalogProductId 12053
// (branch 2481, ישעיהו Tel Aviv) recorded from the GitHub Actions runner on
// 2026-10-15; the delivery terms are the checked-in policy, not the product
// response.
test('yuda fixture selects the visible Tel Aviv branch row and keeps the cottage-cheese identity', () => {
  const json = read('yuda-product.json').toString('utf8');
  const observation = parseYudaProduct(json, { now });
  assert.equal(observation.vendor.id, 'yuda');
  assert.equal(observation.product.productId, 'tnuva-cottage-cheese-5-percent');
  assert.equal(observation.product.form, 'cottage_cheese');
  assert.equal(observation.product.sku, '12053');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.product.packCount, 1);
  assert.equal(observation.product.totalGrams, 250);
  assert.equal(observation.price.amount, 6.7);
  assert.equal(observation.price.currency, 'ILS');
  assert.equal(observation.availability, 'in_stock');
  assert.match(observation.availabilityEvidence.value, /isActive=true/);
  assert.match(observation.availabilityEvidence.value, /quantityLimit=999/);
  assert.match(observation.availabilityEvidence.note, /never priced/);
  assert.equal(observation.maxUnits, 999, 'the published per-line cap travels with the row');
  assert.equal(observation.shipping.service, 'home_delivery');
  assert.equal(observation.shipping.amount.amount, 35);
  assert.equal(observation.shipping.minOrder.amount, 150);
  assert.equal(observation.shipping.certainty, 'verified');
  assert.deepEqual(observation.shipping.destination.localities, ['tel-aviv']);
  assert.match(observation.shipping.destination.caveat, /minimum order/);
  assert.equal(observation.itemUrl, 'https://www.yuda.co.il/?catalogProduct=12053');
});

test('yuda parser classifies through the vendor name that states the brand and never prices a hidden row', () => {
  const base = {
    productId: 12053,
    weight: 250,
    quantityLimit: 999,
    names: {
      '1': { long: "קוטג' 5% מהדרין" },
      '2': { long: "קוטג‘ 5% תנובה מהדרין 250 גרם" }
    },
    branch: { id: 2481, regularPrice: 6.7, isActive: true, isVisible: true, isOutOfStock: false, aisleName: 'מוצרי חלב וביצים,' }
  };
  const hidden = { ...base, branch: { ...base.branch, id: 2441, regularPrice: 5.7, isVisible: false } };
  assert.equal(selectYudaProduct([hidden, base]).branch.regularPrice, 6.7, 'the visible row is selected, not the cheaper hidden one');
  assert.equal(selectYudaProduct([hidden]).branch.regularPrice, 5.7, 'a hidden row is still the only evidence when nothing is sellable');
  assert.equal(selectYudaProduct([]), null);
  assert.equal(classifyYudaNames(base).matched.classification.productId, 'tnuva-cottage-cheese-5-percent', 'the second name states Tnuva, 5% and 250 g');

  const oos = parseYudaProduct(JSON.stringify({ total: 1, products: [{ ...base, branch: { ...base.branch, isOutOfStock: true } }] }), { now });
  assert.equal(oos.availability, 'out_of_stock', 'the branch out-of-stock flag is not a price-only scrape');

  assert.throws(() => parseYudaProduct('not json', { now }), /did not return JSON/);
  assert.throws(() => parseYudaProduct(JSON.stringify({ total: 0, products: [] }), { now }), /No sellable branch product/);
  assert.throws(
    () => parseYudaProduct(JSON.stringify({ products: [{ ...base, names: { '1': { long: 'קוטג 9%' }, '2': { long: 'קוטג 9% תנובה 250 גרם' } } }] }), { now }),
    /does not match the tracked product/,
    'a 9% listing is refused instead of being merged into the 5% comparison'
  );
  assert.throws(
    () => parseYudaProduct(JSON.stringify({ products: [{ ...base, names: { '1': { long: 'קוטג 5% תנובה 500 גרם' }, '2': { long: 'קוטג 5% תנובה 500 גרם' } } }] }), { now }),
    /does not match the tracked product/,
    'a 500 g tub is refused instead of being merged into the 250 g comparison'
  );
});

test('yuda adapter routes its single offer through the recorded fixture', async () => {
  const { yuda } = await import('../src/vendors/yuda.js');
  const fetchText = async url => {
    const hit = await readFixtureForUrl(url);
    assert.ok(hit, `fixture for ${url}`);
    return { ok: true, status: 200, text: hit.text, contentType: hit.contentType };
  };
  const outcome = await yuda.observe({ fetchText, now });
  assert.equal(outcome.failures.length, 0);
  assert.equal(outcome.observations.length, 1);
  assert.equal(outcome.observations[0].price.amount, 6.7);
  assert.equal(outcome.observations[0].maxUnits, 999);
});
test('tivtaam adapter routes its single offer through the recorded fixture', async () => {
  const { tivtaam } = await import('../src/vendors/tivtaam.js');
  const fetchText = async url => {
    const hit = await readFixtureForUrl(url);
    assert.ok(hit, `fixture for ${url}`);
    return { ok: true, status: 200, text: hit.text, contentType: hit.contentType };
  };
  const outcome = await tivtaam.observe({ fetchText, now });
  assert.equal(outcome.failures.length, 0);
  assert.equal(outcome.observations.length, 1);
  assert.equal(outcome.observations[0].price.amount, 6.1);
});

// Duchan Ganei Shmuel cottage cheese (2026-10-15). The fixture is the real
// public store API response for catalogProductId 12053 (branch 2175, the
// store's only online branch) recorded from the GitHub Actions runner on
// 2026-10-15; the delivery terms and the anonymous-cart batch quotes are the
// checked-in policy, not the product response.
test('duchan fixture selects the sellable branch row and keeps the cottage-cheese identity', () => {
  const json = read('duchan-product.json').toString('utf8');
  const observation = parseDuchanProduct(json, { now });
  assert.equal(observation.vendor.id, 'duchan');
  assert.equal(observation.product.productId, 'tnuva-cottage-cheese-5-percent');
  assert.equal(observation.product.form, 'cottage_cheese');
  assert.equal(observation.product.sku, '12053');
  assert.equal(observation.product.packGrams, 250);
  assert.equal(observation.product.packCount, 1);
  assert.equal(observation.product.totalGrams, 250);
  assert.equal(observation.price.amount, 6.3);
  assert.equal(observation.price.currency, 'ILS');
  assert.equal(observation.availability, 'in_stock');
  assert.match(observation.availabilityEvidence.value, /isActive=true/);
  assert.match(observation.availabilityEvidence.value, /quantityLimit=999/);
  assert.equal(observation.maxUnits, 999, 'the published per-line cap travels with the row');
  assert.equal(observation.shipping.service, 'home_delivery');
  assert.equal(observation.shipping.amount.amount, 28);
  assert.equal(observation.shipping.minOrder, null, 'the Ganei Shmuel area publishes no minimum order');
  assert.equal(observation.shipping.freeThreshold.amount, 599);
  assert.equal(observation.shipping.freeThresholdSemantics, 'above', 'the vendor wording "above ₪599" is preserved');
  assert.equal(observation.shipping.certainty, 'verified');
  assert.deepEqual(observation.shipping.destination.localities, ['ganei-shmuel']);
  assert.match(observation.shipping.destination.caveat, /minimum order/);
  assert.equal(observation.itemUrl, 'https://www.duchan.co.il/?catalogProduct=12053');
});

test('duchan parser classifies through the English name and refuses other tub sizes or fat percentages', () => {
  const base = {
    productId: 12053,
    weight: 250,
    quantityLimit: 999,
    names: {
      '1': { long: "קוטג' 5%" },
      '2': { long: 'Cottage Tnuva (5%) 250 g' }
    },
    branch: { id: 2175, regularPrice: 6.3, isActive: true, isVisible: true, isOutOfStock: false }
  };
  const hidden = { ...base, branch: { ...base.branch, regularPrice: 5.9, isVisible: false } };
  assert.equal(selectDuchanProduct([hidden, base]).branch.regularPrice, 6.3, 'the visible row is selected, not a cheaper hidden one');
  assert.equal(selectDuchanProduct([hidden]).branch.regularPrice, 5.9, 'a hidden row is still the only evidence when nothing is sellable');
  assert.equal(selectDuchanProduct([]), null);
  assert.equal(classifyDuchanNames(base).matched.classification.productId, 'tnuva-cottage-cheese-5-percent', 'the English name states Tnuva, 5% and 250 g');

  const oos = parseDuchanProduct(JSON.stringify({ total: 1, products: [{ ...base, branch: { ...base.branch, isOutOfStock: true } }] }), { now });
  assert.equal(oos.availability, 'out_of_stock', 'the branch out-of-stock flag is not a price-only scrape');

  assert.throws(() => parseDuchanProduct('not json', { now }), /did not return JSON/);
  assert.throws(() => parseDuchanProduct(JSON.stringify({ total: 0, products: [] }), { now }), /No sellable branch product/);
  assert.throws(
    () => parseDuchanProduct(JSON.stringify({ products: [{ ...base, names: { '1': { long: 'קוטג 9%' }, '2': { long: 'Cottage Tnuva (9%) 250 g' } } }] }), { now }),
    /does not match the tracked product/,
    'a 9% listing is refused instead of being merged into the 5% comparison'
  );
  assert.throws(
    () => parseDuchanProduct(JSON.stringify({ products: [{ ...base, names: { '1': { long: 'קוטג 5% 500 גרם' }, '2': { long: 'Cottage Tnuva (5%) 500 g' } } }] }), { now }),
    /does not match the tracked product/,
    'a 500 g tub is refused instead of being merged into the 250 g comparison'
  );
});

test('archived Duchan adapter still parses its recorded evidence without re-registering it', async () => {
  const { duchan } = await import('../src/vendors/duchan.js');
  const fetchText = async url => {
    assert.equal(url, duchan.offers[0].url);
    const hit = { text: read('duchan-product.json').toString('utf8'), contentType: 'application/json' };
    assert.ok(hit, `fixture for ${url}`);
    return { ok: true, status: 200, text: hit.text, contentType: hit.contentType };
  };
  const outcome = await duchan.observe({ fetchText, now });
  assert.equal(outcome.failures.length, 0);
  assert.equal(outcome.observations.length, 1);
  assert.equal(outcome.observations[0].price.amount, 6.3);
  assert.equal(outcome.observations[0].maxUnits, 999);
});
