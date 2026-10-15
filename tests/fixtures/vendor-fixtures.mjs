// Recorded vendor pages and the URL → fixture routing used by the offline tools.
//
// One source of truth for `npm run check:sources -- --fixture`,
// `npm run cron:offline`, the browser QA fixture server and the unit tests, so a
// new tracked offer cannot silently lose its fixture. Every fixture is a
// minimized excerpt of a real public product page (see docs/SOURCES.md).
//
// Only the tracked offers are mapped here: Crema e Gusto coffee listings and the
// Tiv Taam and Super Yuda cottage-cheese API responses. The retired
// Qualità Oro / Qualità Rossa / Suerte excerpts live in
// ./historical-retired/ and are never fetched or routed by the tools.

import { readFile } from 'node:fs/promises';
import { registeredVendors } from '../../src/vendors/index.js';

/** fixture file per "<vendorId>:<offerId>". */
export const FIXTURE_BY_OFFER = {
  'coffeeman:classico-250g': 'coffeeman-product.windows-1255.html',
  'coffeeman:classico-1000g-4pack': 'coffeeman-4pack-product.windows-1255.html',
  'coffeeman:classico-2000g-8pack': 'coffeeman-8pack-product.windows-1255.html',
  'pucks:classico-250g': 'pucks-product.html',
  'coffee4u:crema-e-gusto-250g-ground': 'coffee4u-product.windows-1255.html',
  'tivtaam:tnuva-cottage-5-250g': 'tivtaam-product.json',
  'yuda:tnuva-cottage-5-250g': 'yuda-product.json',
  'duchan:tnuva-cottage-5-250g': 'duchan-product.json'
};

const WINDOWS_1255 = 'text/html; charset=windows-1255';
const CONTENT_TYPE_BY_FILE = {
  'coffeeman-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-4pack-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-8pack-product.windows-1255.html': WINDOWS_1255,
  'coffeeman-product.outofstock.windows-1255.html': WINDOWS_1255,
  'pucks-product.html': 'text/html; charset=utf-8',
  'pucks-product.outofstock.html': 'text/html; charset=utf-8',
  'pucks-product.preorder.html': 'text/html; charset=utf-8',
  'coffee4u-product.windows-1255.html': WINDOWS_1255,
  'coffee4u-product.outofstock.windows-1255.html': WINDOWS_1255,
  'tivtaam-product.json': 'application/json; charset=utf-8',
  'yuda-product.json': 'application/json; charset=utf-8',
  'duchan-product.json': 'application/json; charset=utf-8'
};

export const FIXTURES_DIR = new URL('./', import.meta.url);

/** Every tracked offer together with the fixture that reproduces its page. */
export function trackedOffers() {
  const offers = [];
  for (const vendor of registeredVendors()) {
    for (const offer of vendor.offers ?? []) {
      const file = FIXTURE_BY_OFFER[`${vendor.id}:${offer.id}`] ?? null;
      offers.push({ vendorId: vendor.id, offerId: offer.id, url: offer.url, productId: offer.productId ?? null, file });
    }
  }
  return offers;
}

const urlToOffer = new Map(trackedOffers().map(offer => [offer.url, offer]));

/** Read a recorded fixture by file name. */
export async function readFixture(file) {
  const bytes = await readFile(new URL(file, FIXTURES_DIR));
  const contentType = CONTENT_TYPE_BY_FILE[file] ?? 'text/html; charset=utf-8';
  return { file, bytes, contentType, text: new TextDecoder('utf-8', { fatal: false }).decode(bytes) };
}

/** Read the fixture that corresponds to a tracked vendor URL, or null. */
export async function readFixtureForUrl(url) {
  const offer = urlToOffer.get(String(url));
  if (!offer?.file) return null;
  return { ...(await readFixture(offer.file)), offer };
}

/** Fixture fetch for the production bounded fetcher shape (returns a Response). */
export function createFixtureFetch() {
  return async (url, init = {}) => {
    const hit = await readFixtureForUrl(url);
    if (!hit) return new Response('no fixture for this URL', { status: 404 });
    void init;
    return new Response(hit.bytes, { status: 200, headers: { 'content-type': hit.contentType } });
  };
}
