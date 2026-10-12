import test from 'node:test';
import assert from 'node:assert/strict';
import { startQaServer, fixtureObservations } from '../scripts/qa-server.mjs';

// The browser QA harness trusts this server; these checks keep the harness and
// the production quote engine aligned without needing a browser or a Worker.

test('fixture observations parse through the production adapters', async () => {
  const observations = await fixtureObservations(Date.parse('2026-10-12T11:00:00.000Z'));
  assert.equal(observations.length, 5, 'three CoffeeMan, one Pucks and one Coffee4U Crema e Gusto offer');
  assert.ok(observations.every(item => item.product.productId === 'lavazza-crema-e-gusto-vacuum-ground'), 'only the tracked line is parsed');
  const coffeeman = observations.find(item => item.vendor.id === 'coffeeman');
  assert.equal(coffeeman.product.form, 'ground');
  assert.equal(coffeeman.product.variantId, 'classico');
  assert.equal(coffeeman.product.packGrams, 250);
  assert.equal(coffeeman.price.amount, 33);
  assert.equal(coffeeman.shipping.certainty, 'verified');
  assert.equal(coffeeman.availability, 'in_stock');
  const fourPack = observations.find(item => item.vendor.id === 'coffeeman' && item.product.packCount === 4);
  assert.equal(fourPack.price.amount, 124);
  const eightPack = observations.find(item => item.vendor.id === 'coffeeman' && item.product.packCount === 8);
  assert.equal(eightPack.shipping.certainty, 'unknown', 'the 8-pack page publishes no courier price');
  const pucks = observations.find(item => item.vendor.id === 'pucks');
  assert.equal(pucks.shipping.certainty, 'unknown');
  assert.equal(pucks.product.packGrams, 250);
  const coffee4u = observations.find(item => item.vendor.id === 'coffee4u');
  assert.equal(coffee4u.product.form, 'ground');
  assert.equal(coffee4u.product.variantId, 'unspecified');
  assert.equal(coffee4u.product.packGrams, 250);
  assert.equal(coffee4u.price.amount, 38);
  assert.equal(coffee4u.availability, 'in_stock');
  assert.equal(coffee4u.shipping.certainty, 'verified');
  assert.equal(coffee4u.shipping.amount.amount, 30);
  assert.equal(coffee4u.shipping.alternatives[0].amount.amount, 15);
});

test('QA fixture server can add the labelled terms-demo offer without touching the default board', async () => {
  const plain = await startQaServer({ port: 0, now: Date.parse('2026-10-12T11:00:00.000Z') });
  const terms = await startQaServer({ port: 0, now: Date.parse('2026-10-12T11:00:00.000Z'), withTermsDemo: true });
  try {
    const plainBoard = await (await fetch(`${plain.url}/api/board?grams=2000&dest=tel-aviv&variant=classico`)).json();
    assert.equal(plainBoard.qa.demoOffers, 0);
    assert.equal(plainBoard.best.vendor.id, 'coffeeman');

    const termsBoard = await (await fetch(`${terms.url}/api/board?grams=2000&dest=tel-aviv&variant=classico`)).json();
    assert.equal(termsBoard.qa.demoOffers, 1);
    assert.equal(termsBoard.best.vendor.id, 'qa-terms-demo');
    assert.equal(termsBoard.best.totalIls, 160, '8 × ₪20 with the free-shipping threshold met');
    assert.equal(termsBoard.best.shipping.amountIls, 0);
    assert.equal(termsBoard.best.shipping.minOrder, 30);
    assert.equal(termsBoard.best.shipping.freeThreshold, 100);
    assert.equal(termsBoard.best.shipping.destination.scope, 'localities');
    assert.ok(termsBoard.best.labels.some(label => /Free shipping threshold met/.test(label)));

    const restricted = await (await fetch(`${terms.url}/api/board?grams=2000&dest=jerusalem&variant=classico`)).json();
    const demo = restricted.unrankable.find(quote => quote.vendor.id === 'qa-terms-demo');
    assert.ok(demo, 'the locality-restricted demo offer is unrankable for Jerusalem');
    assert.match(demo.reasons.join(' '), /does not include Jerusalem/);
  } finally {
    await plain.close();
    await terms.close();
  }
});

test('QA fixture server serves the board API and static assets offline', async () => {
  const server = await startQaServer({ port: 0, now: Date.parse('2026-10-12T11:00:00.000Z') });
  try {
    const boardResponse = await fetch(`${server.url}/api/board?grams=500&dest=tel-aviv&variant=classico`);
    assert.equal(boardResponse.status, 200);
    assert.match(boardResponse.headers.get('cache-control'), /max-age=300/);
    const board = await boardResponse.json();
    assert.equal(board.qa.mode, 'fixtures');
    assert.equal(board.best.vendor.id, 'coffeeman');
    assert.equal(board.best.totalIls, 91);
    assert.equal(board.best.ilsPerKg, 182);
    assert.equal(board.ranked.length, 2);
    assert.match(board.unrankable[0].reasons.join(' '), /unknown, not free/);
    assert.equal(board.counts.excludedByVariant, 1, 'the unstated-variant listing is not merged into the Classico ranking');
    assert.deepEqual(board.counts.excludedVariants, ['unspecified']);

    const unstatedVariant = await (await fetch(`${server.url}/api/board?grams=250&dest=tel-aviv&variant=unspecified`)).json();
    assert.equal(unstatedVariant.best.vendor.id, 'coffee4u');
    assert.equal(unstatedVariant.best.totalIls, 68);
    assert.equal(unstatedVariant.best.shipping.alternatives[0].amountIls, 15, 'the pickup-point delivery shows as an alternative');

    const catalog = await (await fetch(`${server.url}/api/catalog`)).json();
    assert.deepEqual(catalog.vendors.map(vendor => vendor.id).sort(), ["coffee4u", "coffeeman", "pucks"]);
    assert.deepEqual(catalog.products.map(item => item.id), ["lavazza-crema-e-gusto-vacuum-ground"], "only the tracked Crema e Gusto product drives the UI");

    // An old shared URL that still names a retired line must fall back to the
    // tracked product and say so instead of reviving the retired board.
    const retiredBoard = await (await fetch(`${server.url}/api/board?product=lavazza-qualita-oro-vacuum-ground&grams=1000&dest=tel-aviv`)).json();
    assert.equal(retiredBoard.product.id, "lavazza-crema-e-gusto-vacuum-ground");
    assert.deepEqual(retiredBoard.requestedRetiredProduct, { id: "lavazza-qualita-oro-vacuum-ground", line: "Qualità Oro" });
    assert.equal(retiredBoard.variantId, "classico", "the fallback uses the tracked product's own default variant");
    assert.equal(retiredBoard.best.totalIls, 149, "₪124 four-pack + ₪25 verified courier");
    assert.ok(!JSON.stringify(retiredBoard.ranked).match(/Qualità Oro|Qualità Rossa|Suerte/), "no retired line is compared");
    assert.equal(board.freshness.stale, false, 'a server whose refresh just completed is fresh');

    const staleServer = await startQaServer({ port: 0, now: Date.parse('2026-10-12T11:00:00.000Z'), staleRefresh: true });
    try {
      const stale = await (await fetch(`${staleServer.url}/api/board?grams=500&dest=tel-aviv`)).json();
      assert.equal(stale.qa.staleRefresh, true);
      assert.equal(stale.freshness.stale, true);
      assert.equal(stale.freshness.ageHours, 30);
      assert.equal(stale.freshness.lastRefreshAt, '2026-10-11T05:00:00.000Z');
    } finally {
      await staleServer.close();
    }
    assert.ok(catalog.destinations.length >= 5);

    const index = await fetch(`${server.url}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /Attention shoppers/);

    const missing = await fetch(`${server.url}/../package.json`);
    assert.equal(missing.status, 404);
    const apiMissing = await fetch(`${server.url}/api/nope`);
    assert.equal(apiMissing.status, 404);
    assert.deepEqual(await apiMissing.json(), { error: 'Not found' });

    // The offline harness must resolve variants exactly like the Worker, or the
    // browser QA would verify different behaviour from production.
    const bogusVariant = await (await fetch(`${server.url}/api/board?grams=500&dest=tel-aviv&variant=nope`)).json();
    assert.equal(bogusVariant.variantId, 'classico');
    assert.ok(bogusVariant.ranked.length > 0, 'an unknown variant id falls back to the product default');
  } finally {
    await server.close();
  }
});
