import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('bootstrap makes no invented price or availability claims', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/catalog'));
  const data = await response.json();
  assert.equal(data.products[0].form, 'Vacuum-packed ground coffee');
  assert.equal(data.products[0].targetMarket, 'IL');
  assert.deepEqual(data.offers, []);
  assert.equal(data.updatedAt, null);
});

test('health route works and unknown API paths stay JSON 404s', async () => {
  assert.equal((await worker.fetch(new Request('https://example.test/health'))).status, 200);
  const response = await worker.fetch(new Request('https://example.test/api/missing'));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('website requests reach Workers static assets', async () => {
  const request = new Request('https://example.test/');
  const result = await worker.fetch(request, { ASSETS: { fetch: async value => {
    assert.equal(value, request);
    return new Response('website');
  } } });
  assert.equal(await result.text(), 'website');
});
