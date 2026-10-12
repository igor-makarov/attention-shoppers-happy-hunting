import test from 'node:test';
import assert from 'node:assert/strict';
import { startQaServer, fixtureObservations } from '../scripts/qa-server.mjs';

// The browser QA harness trusts this server; these checks keep the harness and
// the production quote engine aligned without needing a browser or a Worker.

test('fixture observations parse through the production adapters', async () => {
  const observations = await fixtureObservations(Date.parse('2026-10-12T11:00:00.000Z'));
  assert.equal(observations.length, 4);
  const coffeeman = observations.find(item => item.vendor.id === 'coffeeman');
  assert.equal(coffeeman.product.form, 'ground');
  assert.equal(coffeeman.product.variantId, 'classico');
  assert.equal(coffeeman.product.packGrams, 250);
  assert.equal(coffeeman.price.amount, 33);
  assert.equal(coffeeman.shipping.certainty, 'verified');
  assert.equal(coffeeman.availability, 'in_stock');
  const pucks = observations.find(item => item.vendor.id === 'pucks');
  assert.equal(pucks.shipping.certainty, 'unknown');
  assert.equal(pucks.product.packGrams, 250);
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

    const catalog = await (await fetch(`${server.url}/api/catalog`)).json();
    assert.deepEqual(catalog.vendors.map(vendor => vendor.id).sort(), ['coffeeman', 'pucks']);
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
  } finally {
    await server.close();
  }
});
